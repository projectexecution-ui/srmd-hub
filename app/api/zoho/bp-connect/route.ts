// Initiates the Zoho OAuth flow for the Bills Pipeline module.
// Admin visits this URL → gets redirected to Zoho consent screen.
// After consent Zoho redirects to /api/zoho/bp-callback.

import { redirect } from 'next/navigation'
import { NextResponse } from 'next/server'
import { getMyPermissions, can } from '@/lib/auth'

const DC = process.env.ZOHO_DC ?? 'in'
const CALLBACK = 'https://ct-hub.vercel.app/api/zoho/bp-callback'
const SCOPES   = 'ZohoProjects.projects.READ,ZohoProjects.tasks.READ'

export const dynamic = 'force-dynamic'

export async function GET() {
  const perms = await getMyPermissions()
  if (!can(perms, 'bills-pipeline', 'admin')) {
    return NextResponse.json({ ok: false, reason: 'Forbidden — bills-pipeline admin required' }, { status: 403 })
  }

  const clientId = process.env.ZOHO_BP_CLIENT_ID
  if (!clientId) {
    return new NextResponse(
      '<h1>Zoho not configured</h1><p>Set <code>ZOHO_BP_CLIENT_ID</code> in Vercel environment variables, then redeploy.</p>',
      { status: 503, headers: { 'Content-Type': 'text/html' } },
    )
  }

  const domain = DC === 'com' ? 'accounts.zoho.com' : 'accounts.zoho.in'
  const params = new URLSearchParams({
    response_type: 'code',
    client_id:     clientId,
    redirect_uri:  CALLBACK,
    scope:         SCOPES,
    access_type:   'offline',
    prompt:        'consent',
  })

  redirect(`https://${domain}/oauth/v2/auth?${params.toString()}`)
}
