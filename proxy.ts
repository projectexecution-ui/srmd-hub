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
// assets only. The embedded HTML shells (budget-hub.html, indent-tracker.html)
// used to be excluded too, back when their data lived in the visitor's
// browser. They are server-backed now (/api/budget-hub/state), and the budget
// hub is the full ERP budget - so the shell itself needs a signed-in session
// like every other page. ~100 ms per iframe load is not worth an
// unauthenticated copy of the budget UI.
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icons|manifest\\.json|manifest\\.webmanifest|srmd-icon\\.png|srmd-logo\\.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff|woff2|ttf|map)$).*)',
  ],
}
