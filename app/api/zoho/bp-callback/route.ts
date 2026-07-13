// Receives the authorization code from Zoho after the user consents.
// Exchanges it for a refresh_token, stores in app_settings, redirects to dashboard.

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

const DC       = process.env.ZOHO_DC ?? 'in'
const CALLBACK = 'https://ct-hub.vercel.app/api/zoho/bp-callback'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const code  = req.nextUrl.searchParams.get('code')
  const error = req.nextUrl.searchParams.get('error')

  if (error || !code) {
    const reason = encodeURIComponent(error ?? 'No authorization code received')
    return NextResponse.redirect(
      new URL(`/bills-pipeline?zoho=error&reason=${reason}`, req.url),
    )
  }

  try {
    const domain = DC === 'com' ? 'accounts.zoho.com' : 'accounts.zoho.in'
    const params = new URLSearchParams({
      grant_type:    'authorization_code',
      code,
      client_id:     process.env.ZOHO_BP_CLIENT_ID     ?? '',
      client_secret: process.env.ZOHO_BP_CLIENT_SECRET ?? '',
      redirect_uri:  CALLBACK,
    })

    const tokenRes = await fetch(`https://${domain}/oauth/v2/token`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    params.toString(),
    })

    const json = await tokenRes.json()
    if (!json.refresh_token) {
      const reason = encodeURIComponent(json.error ?? 'No refresh_token in response')
      return NextResponse.redirect(
        new URL(`/bills-pipeline?zoho=error&reason=${reason}`, req.url),
      )
    }

    // Store in app_settings using service-role client — no user session on this callback
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')

    const supabase = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceKey,
      { auth: { persistSession: false } },
    )

    const { error: upsertErr } = await supabase
      .from('app_settings')
      .upsert({ key: 'zoho_bp_refresh_token', value: json.refresh_token }, { onConflict: 'key' })

    if (upsertErr) {
      const reason = encodeURIComponent(`DB write failed: ${upsertErr.message}`)
      return NextResponse.redirect(
        new URL(`/bills-pipeline?zoho=error&reason=${reason}`, req.url),
      )
    }

    return NextResponse.redirect(new URL('/bills-pipeline?zoho=connected', req.url))
  } catch (e) {
    const reason = encodeURIComponent(e instanceof Error ? e.message : 'Unexpected error')
    return NextResponse.redirect(
      new URL(`/bills-pipeline?zoho=error&reason=${reason}`, req.url),
    )
  }
}
