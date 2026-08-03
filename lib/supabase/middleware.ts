import { createServerClient } from '@supabase/ssr'
import { type NextRequest, NextResponse } from 'next/server'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname

  // Public (un-gated) paths. /api/email/send + /api/push/send are called
  // server-to-server by the database (pg_net) with no auth cookie — they
  // authenticate with the NOTIFY_INTERNAL_SECRET header, so they must skip the
  // login redirect here. (/api/push/subscribe stays gated — it's called by the
  // signed-in user's own browser, which carries the session cookie.)
  const publicRoutes = ['/login', '/auth/callback', '/api/email/send', '/api/push/send']
  const isPublic = publicRoutes.some(r => pathname.startsWith(r))

  if (!user && !isPublic) {
    const url = request.nextUrl.clone()
    // Remember where they were headed (path + query) so login drops them right
    // there — clicking a deep link (e.g. an email notification) never dumps you
    // on the dashboard or makes you navigate again.
    const dest = pathname + (request.nextUrl.search || '')
    url.pathname = '/login'
    url.search = ''
    if (dest && dest !== '/' && !dest.startsWith('/login')) {
      url.searchParams.set('redirect', dest)
    }
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
