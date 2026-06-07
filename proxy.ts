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
// assets and the embedded vendor HTML files. Those HTMLs are public shells —
// any user data lives in the visitor's browser (localStorage / drop-zone),
// not on our server, so it's safe to serve them without auth gating and we
// save ~50–200 ms per nested iframe load.
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icons|manifest\\.json|manifest\\.webmanifest|indent-tracker\\.html|budget-hub\\.html|srmd-icon\\.png|srmd-logo\\.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff|woff2|ttf|map)$).*)',
  ],
}
