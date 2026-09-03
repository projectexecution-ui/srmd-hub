import { type NextRequest, NextResponse } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function proxy(request: NextRequest) {
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
