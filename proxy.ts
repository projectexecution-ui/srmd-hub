import { type NextRequest, NextResponse } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'
import { IS_DEMO, DEMO_BLOCKED_MESSAGE } from '@/lib/demo-mode'

/** Anything that is not one of these can change data. Server Actions arrive as
 *  POST, so refusing non-GET stops every action and form submit in one place. */
const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export async function proxy(request: NextRequest) {
  // ── Trial-site guard (preview deployments only; never the live site) ──
  // Layer 1 of 3 — see lib/demo-mode.ts. Sits before updateSession so a
  // blocked request never even refreshes the session.
  if (IS_DEMO) {
    const { method, nextUrl } = request

    // Scheduled jobs send email / Telegram and write snapshots. They are GETs,
    // so the method check alone would let them through if someone opened the
    // URL. Block the whole family. (Vercel only *schedules* crons on
    // production, but the routes still exist and are reachable on a preview.)
    if (nextUrl.pathname.startsWith('/api/cron/')) {
      return NextResponse.json(
        { ok: false, error: DEMO_BLOCKED_MESSAGE, demo: true },
        { status: 403 },
      )
    }

    if (!READ_ONLY_METHODS.has(method)) {
      // Server Actions expect a response they can parse; JSON with a clear
      // message surfaces in the app's existing error handling rather than
      // failing silently or looking like a crash.
      return NextResponse.json(
        { ok: false, error: DEMO_BLOCKED_MESSAGE, demo: true },
        { status: 403 },
      )
    }
  }

  try {
    return await updateSession(request)
  } catch (err) {
    console.error('[proxy] updateSession error:', err)
    return NextResponse.next({ request })
  }
}

// Skip the proxy (and the Supabase auth round-trip it triggers) for static
// assets and the embedded vendor HTML files. Those HTMLs are public shells —
// any user data lives in the visitor's browser (localStorage / drop-zone),
// not on our server, so it's safe to serve them without auth gating and we
// save ~50–200 ms per nested iframe load.
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icons|manifest\\.json|manifest\\.webmanifest|indent-tracker\\.html|budget-hub\\.html|srmd-icon\\.png|srmd-logo\\.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff|woff2|ttf|map)$).*)',
  ],
}
