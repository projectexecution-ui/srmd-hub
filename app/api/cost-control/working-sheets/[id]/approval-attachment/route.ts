// Approver "record" attachments for a working sheet (Internal Estimate).
//
//   POST   (CC reviewer) → attach one or more files for record while reviewing/
//          approving a sheet, EVEN after it's submitted (the owner-only
//          WorkingEvidence panel can't do this). Stored as kind='approval_record'.
//   DELETE (uploader or admin) → remove one such record.
//
// Runs with the SERVICE role after a checkIsCcReviewer() gate: an Atm Head is an
// approver, not necessarily a cc-edit member, so the normal cc-sheets storage +
// cc_ws_attachments RLS (owner + draft/returned only) would block them. The
// reviewer check is the authorization; the service client does the write.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getMyPermissions, can, getMyUser, getMyProfile } from '@/lib/auth'
import { checkIsCcReviewer } from '@/components/cost-control/ws-actions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const BUCKET = 'cc-sheets'
const MAX_BYTES = 25 * 1024 * 1024

function svc() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const perms = await getMyPermissions()
  if (!can(perms, 'cost-control', 'view')) return NextResponse.json({ ok: false, error: 'Not allowed.' }, { status: 403 })
  if (!(await checkIsCcReviewer())) {
    return NextResponse.json({ ok: false, error: 'Only approvers can attach approval records.' }, { status: 403 })
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ ok: false, error: 'Server not configured for uploads.' }, { status: 503 })
  }
  const { id } = await params
  const me = await getMyUser()
  const uid = me?.id
  if (!uid) return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 })

  // Resolve the sheet's project (folder) with the caller's session client — this
  // also confirms the sheet is one they're allowed to see.
  const session = await createClient()
  const { data: ws, error: wsErr } = await session
    .from('cc_working_sheets').select('id, project_id').eq('id', id).maybeSingle()
  if (wsErr || !ws?.project_id) {
    return NextResponse.json({ ok: false, error: 'Working sheet not found.' }, { status: 404 })
  }

  const form = await req.formData().catch(() => null)
  const files = form ? form.getAll('files').filter((f): f is File => f instanceof File) : []
  if (files.length === 0) return NextResponse.json({ ok: false, error: 'No file provided.' }, { status: 400 })

  const admin = svc()
  const saved: Array<{ id: string; name: string }> = []
  for (const f of files) {
    if (f.size > MAX_BYTES) return NextResponse.json({ ok: false, error: `${f.name} is over 25 MB.` }, { status: 400 })
    const ts = Date.now()
    const safe = f.name.replace(/[^A-Za-z0-9._-]/g, '_')
    const path = `${ws.project_id}/approval-${ts}-${safe}`
    const buf = Buffer.from(await f.arrayBuffer())
    const { error: upErr } = await admin.storage.from(BUCKET).upload(path, buf, {
      cacheControl: '3600', upsert: false, contentType: f.type || 'application/octet-stream',
    })
    if (upErr) return NextResponse.json({ ok: false, error: `Upload failed: ${upErr.message}` }, { status: 500 })
    const { data: row, error: insErr } = await admin.from('cc_ws_attachments')
      .insert({ working_sheet_id: id, path, name: f.name, kind: 'approval_record', uploaded_by: uid })
      .select('id, name').single()
    if (insErr) {
      await admin.storage.from(BUCKET).remove([path]) // don't orphan the object
      return NextResponse.json({ ok: false, error: `Save failed: ${insErr.message}` }, { status: 500 })
    }
    saved.push({ id: row.id as string, name: row.name as string })
  }
  return NextResponse.json({ ok: true, saved })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const perms = await getMyPermissions()
  if (!can(perms, 'cost-control', 'view')) return NextResponse.json({ ok: false, error: 'Not allowed.' }, { status: 403 })
  if (!(await checkIsCcReviewer())) {
    return NextResponse.json({ ok: false, error: 'Not allowed.' }, { status: 403 })
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ ok: false, error: 'Server not configured.' }, { status: 503 })
  }
  const { id } = await params
  const me = await getMyUser()
  const uid = me?.id
  const profile = await getMyProfile()
  const isAdmin = profile?.role === 'admin'
  const attId = new URL(req.url).searchParams.get('attId')
  if (!attId) return NextResponse.json({ ok: false, error: 'Missing attachment id.' }, { status: 400 })

  const admin = svc()
  const { data: att } = await admin.from('cc_ws_attachments')
    .select('id, path, kind, uploaded_by, working_sheet_id').eq('id', attId).maybeSingle()
  if (!att || att.working_sheet_id !== id || att.kind !== 'approval_record') {
    return NextResponse.json({ ok: false, error: 'Record not found.' }, { status: 404 })
  }
  // Uploader or an admin may remove it.
  if (att.uploaded_by !== uid && !isAdmin) {
    return NextResponse.json({ ok: false, error: 'Only the person who attached it (or an admin) can remove it.' }, { status: 403 })
  }
  await admin.storage.from(BUCKET).remove([att.path as string])
  const { error: delErr } = await admin.from('cc_ws_attachments').delete().eq('id', attId)
  if (delErr) return NextResponse.json({ ok: false, error: delErr.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
