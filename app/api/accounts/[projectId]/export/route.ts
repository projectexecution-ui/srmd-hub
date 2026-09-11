// GET — plain exports of what the Accounts tab shows.
//   ?what=payments&fy=2026-27&format=xlsx|pdf&raw=1
//   ?what=ledger&party=<name>&fy=2026-27&format=xlsx|pdf

import { NextResponse } from 'next/server'
import { requireAccounts, fileSlug } from '@/lib/accounts/access'
import { loadAccounts } from '@/lib/accounts/load'
import { fyOf, buildPartyLedger } from '@/lib/accounts/payments'
import { buildPaymentsWorkbook, buildLedgerWorkbook } from '@/lib/accounts/excel'
import { buildPaymentsPdf, buildLedgerPdf } from '@/lib/accounts/pdf'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const gate = await requireAccounts(projectId)
  if (!gate.ok) return NextResponse.json({ ok: false, reason: gate.reason }, { status: gate.status })

  const q = new URL(req.url).searchParams
  const what = q.get('what') ?? 'payments'
  const fy = q.get('fy') || null
  const format = q.get('format') === 'pdf' ? 'pdf' : 'xlsx'
  const acc = await loadAccounts(projectId, { raw: q.get('raw') === '1' })
  if (acc.error) return NextResponse.json({ ok: false, reason: acc.error }, { status: 500 })

  const tag = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10)
  let body: Uint8Array, name: string
  if (what === 'ledger') {
    const party = q.get('party') ?? ''
    if (!party) return NextResponse.json({ ok: false, reason: 'Which party?' }, { status: 400 })
    const ledger = buildPartyLedger(acc.book.bills, party, fy, acc.book.duplicates.filter(d => d.kept.party === party).length)
    name = `${fileSlug(gate.project.label)}_Ledger_${fileSlug(party)}${fy ? `_FY${fy}` : ''}_${tag}.${format}`
    body = format === 'pdf' ? buildLedgerPdf(gate.project, ledger) : new Uint8Array(buildLedgerWorkbook(gate.project, ledger))
  } else {
    const rows = fy ? acc.book.payments.filter(p => fyOf(p.date) === fy) : acc.book.payments
    const title = fy ? `Payments FY ${fy}` : 'All payments'
    name = `${fileSlug(gate.project.label)}_Payments${fy ? `_FY${fy}` : ''}_${tag}.${format}`
    body = format === 'pdf' ? buildPaymentsPdf(gate.project, rows, title) : new Uint8Array(buildPaymentsWorkbook(gate.project, rows, title))
  }
  return new NextResponse(new Blob([body as BlobPart]), {
    headers: {
      'content-type': format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="${name}"`,
      'cache-control': 'no-store',
    },
  })
}
