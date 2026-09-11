// POST multipart {file} — the Trust's filled-in statement. Read by CT Hub ID;
// each row becomes (or updates) a confirmation. A row marked "Matches" whose
// amount in books differs from IN4 by more than a rupee is recorded as
// "differs", because the Trust's own number says so.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAccounts } from '@/lib/accounts/access'
import { loadAccounts } from '@/lib/accounts/load'
import { parseReplyWorkbook } from '@/lib/accounts/excel'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const gate = await requireAccounts(projectId)
  if (!gate.ok) return NextResponse.json({ ok: false, reason: gate.reason }, { status: gate.status })

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof Blob)) return NextResponse.json({ ok: false, reason: 'No file received.' }, { status: 400 })
  if (file.size > 10 * 1024 * 1024) return NextResponse.json({ ok: false, reason: 'File is over 10 MB.' }, { status: 413 })

  let parsed
  try { parsed = parseReplyWorkbook(Buffer.from(await file.arrayBuffer())) }
  catch (e) { return NextResponse.json({ ok: false, reason: `Could not read the file: ${e instanceof Error ? e.message : 'unknown error'}` }, { status: 400 }) }
  if (parsed.rows.length === 0) return NextResponse.json({ ok: false, reason: 'No filled-in rows with a CT Hub ID were found. Was this the file CT Hub prepared?' }, { status: 400 })

  const acc = await loadAccounts(projectId, { raw: true })
  if (acc.error) return NextResponse.json({ ok: false, reason: acc.error }, { status: 500 })
  const byId = new Map(acc.book.bills.map(b => [b.id, b]))

  const now = new Date().toISOString()
  const upserts = []
  let unknown = 0, confirmed = 0, notFound = 0, differs = 0
  for (const r of parsed.rows) {
    const bill = byId.get(r.id)
    if (!bill) { unknown++; continue }
    let status = r.status ?? (r.bankDate ? 'confirmed' : null)
    if (!status) continue
    if (status === 'confirmed' && r.amountInBooks != null && Math.abs(r.amountInBooks - bill.paid) > 1) status = 'differs'
    if (status === 'confirmed') confirmed++; else if (status === 'not_found') notFound++; else if (status === 'differs') differs++
    upserts.push({
      project_id: projectId, source: r.source, certificate_id: r.certificateId,
      bank_date: r.bankDate, bank_ref: r.bankRef, amount_in_books: r.amountInBooks, status, remark: r.remark,
      updated_at: now, updated_by: gate.userId,
    })
  }
  const supabase = await createClient()
  if (upserts.length) {
    const { error } = await supabase.from('accounts_payment_confirmations').upsert(upserts, { onConflict: 'source,certificate_id' })
    if (error) return NextResponse.json({ ok: false, reason: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true, read: parsed.rows.length, confirmed, notFound, differs, unknown, skipped: parsed.skipped, notInIn4: parsed.notInIn4 })
}
