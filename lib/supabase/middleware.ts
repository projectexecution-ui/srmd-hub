import { createServerClient } from '@supabase/ssr'
import { type NextRequest, NextResponse } from 'next/server'
import { getUserResilient } from './auth-retry'

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

  // Retries transient auth faults, and distinguishes "signed out" from "auth
  // never answered". See lib/supabase/auth-retry.
  const { user, unavailable } = await getUserResilient(supabase)

  const pathname = request.nextUrl.pathname

  // Public (un-gated) paths. /api/email/send + /api/push/send are called
  // server-to-server by the database (pg_net) with no auth cookie — they
  // authenticate with the NOTIFY_INTERNAL_SECRET header, so they must skip the
  // login redirect here. (/api/push/subscribe stays gated — it's called by the
  // signed-in user's own browser, which carries the session cookie.)
  //
  // Scheduled-job (cron) endpoints likewise carry NO login cookie — Vercel Cron
  // calls them with only an `Authorization: Bearer CRON_SECRET` header, and the
  // dispatcher fans out to them server-to-server the same way. Without these in
  // the allowlist the proxy bounced every cron call to /login, so NOTHING
  // scheduled ever ran. Each route still enforces CRON_SECRET itself.
  const publicRoutes = [
    '/login', '/auth/callback', '/api/email/send', '/api/push/send',
    // Telegram: the bot webhook is called by Telegram's servers (verified by a
    // secret-token header) and /api/telegram/send by the database (pg_net, via
    // the NOTIFY_INTERNAL_SECRET header) — neither carries a login cookie, so
    // they must skip the redirect. /api/telegram/setup enforces admin itself.
    '/api/telegram',
    '/api/cron',                      // dispatcher + all fan-out jobs under /api/cron/*
    '/api/jmr/weekly-report',         // cron
    '/api/cost-control/backup',       // cron
    '/api/cost-control/in4-followup', // cron
  ]
  const isPublic = publicRoutes.some(r => pathname.startsWith(r))

  // Redirect ONLY when auth definitively says there is no user. During the
  // Supabase auth incident a 504 produced user=null here and every signed-in
  // person was bounced to /login mid-task. An outage is not a logout, so we let
  // the request through and leave the decision to the page's own
  // requirePermission — which still refuses anyone who is genuinely not signed
  // in, so nothing is opened up.
  if (unavailable) return supabaseResponse

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
