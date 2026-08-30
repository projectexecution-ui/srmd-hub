import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// IS_DEMO is read from env at module load, so each case re-imports the module
// with the env it wants. Without resetModules the first import would be cached
// and every later case would silently test the same flag.
async function loadWith(env: Record<string, string | undefined>) {
  vi.resetModules()
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) vi.stubEnv(k, '')
    else vi.stubEnv(k, v)
  }
  return await import('./demo-mode')
}

/** What a Supabase call resolves to. The fake builder is typed as thenable so
 *  the tests can `await` a blocked write and read `{ data, error }` off it —
 *  the guard replaces the builder with one that really is thenable. */
type Res = { data: unknown; error: { code: string; message: string; details: string } | null }
type FakeBuilder = Record<'select' | 'eq' | 'order' | 'insert' | 'update' | 'upsert' | 'delete',
  (...a: unknown[]) => FakeBuilder> & PromiseLike<Res>

/** Minimal stand-in for a Supabase client: enough surface to prove the proxy
 *  blocks writes, allows reads, and survives chaining. */
function fakeClient() {
  const calls: string[] = []
  const builder = {
    select: (..._a: unknown[]) => { calls.push('select'); return builder },
    eq:     (..._a: unknown[]) => { calls.push('eq'); return builder },
    order:  (..._a: unknown[]) => { calls.push('order'); return builder },
    insert: (..._a: unknown[]) => { calls.push('insert'); return builder },
    update: (..._a: unknown[]) => { calls.push('update'); return builder },
    upsert: (..._a: unknown[]) => { calls.push('upsert'); return builder },
    delete: (..._a: unknown[]) => { calls.push('delete'); return builder },
  } as unknown as FakeBuilder
  return {
    calls,
    client: {
      // Signing in must keep working on the trial site — it is the same
      // database, so people log in with their normal account. auth.* talks to
      // supabase.co directly and writes no application data.
      auth: {
        signInWithPassword: (..._a: unknown[]) => { calls.push('signInWithPassword'); return Promise.resolve({ error: null }) },
        signInWithOAuth: (..._a: unknown[]) => { calls.push('signInWithOAuth'); return Promise.resolve({ error: null }) },
        exchangeCodeForSession: (..._a: unknown[]) => { calls.push('exchangeCodeForSession'); return Promise.resolve({ error: null }) },
        getUser: (..._a: unknown[]) => { calls.push('getUser'); return Promise.resolve({ data: { user: null } }) },
        signOut: (..._a: unknown[]) => { calls.push('signOut'); return Promise.resolve({ error: null }) },
      },
      from: (_t: string) => builder,
      rpc: (..._a: unknown[]) => { calls.push('rpc'); return Promise.resolve({ data: null }) },
      storage: {
        from: (_b: string) => ({
          upload: (..._a: unknown[]) => { calls.push('upload'); return Promise.resolve({} as Res) },
          download: (..._a: unknown[]) => { calls.push('download'); return Promise.resolve({}) },
        }),
      },
    },
  }
}

afterEach(() => { vi.unstubAllEnvs() })

describe('demo mode — the live site', () => {
  beforeEach(() => { vi.unstubAllEnvs() })

  it('is OFF when VERCEL_ENV is production', async () => {
    const m = await loadWith({ VERCEL_ENV: 'production', NEXT_PUBLIC_DEMO_MODE: '' })
    expect(m.IS_DEMO).toBe(false)
  })

  it('is OFF when nothing is set at all (local dev, self-hosting)', async () => {
    const m = await loadWith({ VERCEL_ENV: '', NEXT_PUBLIC_DEMO_MODE: '' })
    expect(m.IS_DEMO).toBe(false)
  })

  it('returns the client untouched, so writes still work', async () => {
    const m = await loadWith({ VERCEL_ENV: 'production', NEXT_PUBLIC_DEMO_MODE: '' })
    const { client, calls } = fakeClient()
    const guarded = m.guardSupabaseClient(client)
    expect(guarded).toBe(client)          // literally the same object — no proxy
    guarded.from('projects').insert({})
    guarded.rpc('my_permissions')
    expect(calls).toContain('insert')
    expect(calls).toContain('rpc')
  })
})

describe('demo mode — the trial site', () => {
  beforeEach(() => { vi.unstubAllEnvs() })

  it('is ON for a Vercel preview deployment', async () => {
    const m = await loadWith({ VERCEL_ENV: 'preview' })
    expect(m.IS_DEMO).toBe(true)
  })

  it('is ON when the public build flag is set', async () => {
    const m = await loadWith({ VERCEL_ENV: '', NEXT_PUBLIC_DEMO_MODE: '1' })
    expect(m.IS_DEMO).toBe(true)
  })

  it.each(['insert', 'update', 'upsert', 'delete'] as const)(
    'blocks .%s() and never reaches the database', async (method) => {
      const m = await loadWith({ VERCEL_ENV: 'preview' })
      const { client, calls } = fakeClient()
      const guarded = m.guardSupabaseClient(client)
      const { data, error } = await guarded.from('projects')[method]({})
      expect(data).toBeNull()
      expect(error?.code).toBe('DEMO_READ_ONLY')
      expect(calls).not.toContain(method)   // the real method was never invoked
    },
  )

  // Regression: a blocked write must RESOLVE, not throw. Server components
  // write during render, and a throw there 500s the whole page — which is
  // exactly how the first trial deployment broke.
  it('resolves a blocked write instead of throwing, so a page cannot 500', async () => {
    const m = await loadWith({ VERCEL_ENV: 'preview' })
    const { client } = fakeClient()
    await expect(m.guardSupabaseClient(client).from('app_settings').upsert({})).resolves.toBeDefined()
  })

  it('stays chainable after the blocked call, and still resolves to the error', async () => {
    const m = await loadWith({ VERCEL_ENV: 'preview' })
    const { client, calls } = fakeClient()
    const { error } = await m.guardSupabaseClient(client)
      .from('projects').update({ name: 'x' }).eq('id', '1').select()
    expect(error?.code).toBe('DEMO_READ_ONLY')
    expect(calls).toEqual([])
  })

  // Regression: blocking rpc() wholesale 500'd every page — my_permissions()
  // and friends are read-only RPCs the app calls on every render.
  it('ALLOWS rpc() — the permission system runs on it', async () => {
    const m = await loadWith({ VERCEL_ENV: 'preview' })
    const { client, calls } = fakeClient()
    await m.guardSupabaseClient(client).rpc('my_permissions')
    expect(calls).toContain('rpc')
  })

  it('blocks storage uploads but still allows downloads', async () => {
    const m = await loadWith({ VERCEL_ENV: 'preview' })
    const { client, calls } = fakeClient()
    const guarded = m.guardSupabaseClient(client)
    const { error } = await guarded.storage.from('cc-sheets').upload('a.xlsx', new Blob())
    expect(error?.code).toBe('DEMO_READ_ONLY')
    guarded.storage.from('cc-sheets').download('a.xlsx')
    expect(calls).toEqual(['download'])
  })

  // Regression guard: an over-broad block here would make the trial site
  // impossible to enter at all, which is exactly how it first went wrong.
  it.each(['signInWithPassword', 'signInWithOAuth', 'exchangeCodeForSession', 'getUser', 'signOut'] as const)(
    'lets auth.%s() through so people can actually sign in', async (method) => {
      const m = await loadWith({ VERCEL_ENV: 'preview' })
      const { client, calls } = fakeClient()
      const guarded = m.guardSupabaseClient(client)
      await expect(guarded.auth[method]('a@b.c')).resolves.toBeDefined()
      expect(calls).toContain(method)
    },
  )

  it('still allows reads — the whole point of the trial site', async () => {
    const m = await loadWith({ VERCEL_ENV: 'preview' })
    const { client, calls } = fakeClient()
    m.guardSupabaseClient(client).from('projects').select('id')
    expect(calls).toEqual(['select'])
  })

  it('keeps the guard on through a chain, so a late .delete() is still caught', async () => {
    const m = await loadWith({ VERCEL_ENV: 'preview' })
    const { client, calls } = fakeClient()
    const chained = m.guardSupabaseClient(client).from('projects').select('id').eq('id', '1')
    const { error } = await (chained as unknown as { delete: () => Promise<{ error: { code: string } }> }).delete()
    expect(error.code).toBe('DEMO_READ_ONLY')
    expect(calls).toEqual(['select', 'eq'])
  })

  it('names the blocked operation and says nothing is saved', async () => {
    const m = await loadWith({ VERCEL_ENV: 'preview' })
    const { client } = fakeClient()
    const { error } = await m.guardSupabaseClient(client).from('projects').update({})
    expect(error?.message).toContain('nothing is saved here')
    expect(error?.details).toContain('update')
  })
})
