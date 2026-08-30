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
  }
  return {
    calls,
    client: {
      from: (_t: string) => builder,
      rpc: (..._a: unknown[]) => { calls.push('rpc'); return Promise.resolve({ data: null }) },
      storage: {
        from: (_b: string) => ({
          upload: (..._a: unknown[]) => { calls.push('upload'); return Promise.resolve({}) },
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
    expect(calls).toContain('insert')
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
      expect(() => guarded.from('projects')[method]({})).toThrow(m.DemoModeError)
      expect(calls).not.toContain(method)   // the real method was never invoked
    },
  )

  it('blocks rpc() — several RPCs write', async () => {
    const m = await loadWith({ VERCEL_ENV: 'preview' })
    const { client, calls } = fakeClient()
    expect(() => m.guardSupabaseClient(client).rpc('recycle_restore')).toThrow(m.DemoModeError)
    expect(calls).not.toContain('rpc')
  })

  it('blocks storage uploads but still allows downloads', async () => {
    const m = await loadWith({ VERCEL_ENV: 'preview' })
    const { client, calls } = fakeClient()
    const guarded = m.guardSupabaseClient(client)
    expect(() => guarded.storage.from('cc-sheets').upload('a.xlsx', new Blob())).toThrow(m.DemoModeError)
    guarded.storage.from('cc-sheets').download('a.xlsx')
    expect(calls).toEqual(['download'])
  })

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
    expect(() => (chained as { delete: () => unknown }).delete()).toThrow(m.DemoModeError)
    expect(calls).toEqual(['select', 'eq'])
  })

  it('names the blocked operation and says nothing is saved', async () => {
    const m = await loadWith({ VERCEL_ENV: 'preview' })
    const { client } = fakeClient()
    try {
      m.guardSupabaseClient(client).from('projects').update({})
      expect.unreachable('update should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(m.DemoModeError)
      expect((e as Error).message).toContain('nothing is saved here')
      expect((e as Error).message).toContain('update')
    }
  })
})
