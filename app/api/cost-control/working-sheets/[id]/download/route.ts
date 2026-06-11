// Download the original uploaded Excel for a working sheet. Generates a
// fresh signed URL (so links never go stale, however many days later) and
// 302-redirects to it. Lets the WS list link straight to the file without
// minting a signed URL for every row server-side.
//
// This route is hit by plain browser navigation (an <a> tag), so errors
// must NOT return JSON — that would strand the user on a raw-JSON page.
// Every failure redirects back to the WS list with ?dl=failed, which the
// list renders as a dismissible banner.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getMyPermissions, can } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const failed = () =>
    NextResponse.redirect(new URL('/cost-control/working-sheets?dl=failed', req.url), 302)

  const perms = await getMyPermissions()
  if (!can(perms, 'cost-control', 'view')) {
    // The WS list's own permission gate bounces them onward to /dashboard.
    return failed()
  }
  const { id } = await params
  const supabase = await createClient()
  const { data: ws, error: wsError } = await supabase
    .from('cc_working_sheets')
    .select('source_excel_url, source_excel_name')
    .eq('id', id)
    .single()
  if (wsError || !ws?.source_excel_url) {
    return failed()
  }
  const { data: signed, error } = await supabase.storage
    .from('cc-sheets')
    .createSignedUrl(ws.source_excel_url, 120, { download: ws.source_excel_name ?? true })
  if (error || !signed?.signedUrl) {
    return failed()
  }
  return NextResponse.redirect(signed.signedUrl)
}
