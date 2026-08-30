import { describe, it, expect, afterEach, vi } from 'vitest'

// Layer 1 of the trial-site guard (see lib/demo-mode.ts). These tests exist
// because this is the layer that stops Server Actions — a regression here
// would let the trial site write to the live database.

// updateSession does a real Supabase auth round-trip; stub it so these tests
// only exercise the guard. Returning a marker lets us assert "fell through".
vi.mock('@/lib/supabase/middleware', () => ({
  updateSession: vi.fn(async () => new Response('passed-through', { status: 200 })),
}))

async function loadProxy(vercelEnv: string) {
  vi.resetModules()
  vi.stubEnv('VERCEL_ENV', vercelEnv)
  vi.stubEnv('NEXT_PUBLIC_DEMO_MODE', '')
  const { proxy } = await import('./proxy')
  const { NextRequest } = await import('next/server')
  return { proxy, NextRequest }
}

function req(NextRequest: typeof import('next/server').NextRequest, method: string, path = '/cost-control') {
  return new NextRequest(new URL(path, 'https://example.test'), { method })
}

afterEach(() => { vi.unstubAllEnvs() })

describe('proxy — live site', () => {
  it.each(['GET', 'POST', 'DELETE'])('lets %s through untouched', async (method) => {
    const { proxy, NextRequest } = await loadProxy('production')
    const res = await proxy(req(NextRequest, method))
    expect(await res.text()).toBe('passed-through')
  })

  it('lets cron routes run', async () => {
    const { proxy, NextRequest } = await loadProxy('production')
    const res = await proxy(req(NextRequest, 'GET', '/api/cron/dispatch'))
    expect(res.status).toBe(200)
  })
})

describe('proxy — trial site', () => {
  it.each(['GET', 'HEAD'])('still allows %s, so the app is browsable', async (method) => {
    const { proxy, NextRequest } = await loadProxy('preview')
    const res = await proxy(req(NextRequest, method))
    expect(await res.text()).toBe('passed-through')
  })

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'refuses %s — this is how Server Actions are stopped', async (method) => {
      const { proxy, NextRequest } = await loadProxy('preview')
      const res = await proxy(req(NextRequest, method))
      expect(res.status).toBe(403)
      const body = await res.json()
      expect(body.demo).toBe(true)
      expect(body.error).toContain('nothing is saved here')
    },
  )

  it('refuses cron routes even on GET — they email and write snapshots', async () => {
    const { proxy, NextRequest } = await loadProxy('preview')
    const res = await proxy(req(NextRequest, 'GET', '/api/cron/bills-stuck-worklist'))
    expect(res.status).toBe(403)
    expect((await res.json()).demo).toBe(true)
  })
})
