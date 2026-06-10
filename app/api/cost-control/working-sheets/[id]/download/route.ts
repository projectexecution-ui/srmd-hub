// Download the original uploaded Excel for a working sheet. Generates a
// fresh signed URL (so links never go stale, however many days later) and
// 302-redirects to it. Lets the WS list link straight to the file without
// minting a signed URL for every row server-side.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getMyPermissions, can } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const perms = await getMyPermissions()
  if (!can(perms, 'cost-control', 'view')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { id } = await params
  const supabase = await createClient()
  const { data: ws } = await supabase
    .from('cc_working_sheets')
    .select('source_excel_url, source_excel_name')
    .eq('id', id)
    .single()
  if (!ws?.source_excel_url) {
    return NextResponse.json({ error: 'No source Excel attached to this working sheet' }, { status: 404 })
  }
  const { data: signed, error } = await supabase.storage
    .from('cc-sheets')
    .createSignedUrl(ws.source_excel_url, 120, { download: ws.source_excel_name ?? true })
  if (error || !signed?.signedUrl) {
    return NextResponse.json({ error: `Could not create download link: ${error?.message ?? 'unknown'}` }, { status: 500 })
  }
  return NextResponse.redirect(signed.signedUrl)
}
