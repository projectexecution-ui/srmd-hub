// GET — the "payments for Trust checking" Excel for one project.
//   ?range=unconfirmed (default) | all | fy:2026-27 | month:2026-08
// Records the statement so the tab can say when one was last sent.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAccounts, fileSlug } from '@/lib/accounts/access'
import { loadAccounts } from '@/lib/accounts/load'
import { fyOf } from '@/lib/accounts/payments'
import { buildStatementWorkbook } from '@/lib/accounts/excel'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const gate = await requireAccounts(projectId)
  if (!gate.ok) return NextResponse.json({ ok: false, reason: gate.reason }, { status: gate.status })

  const range = new URL(req.url).searchParams.get('range') ?? 'unconfirmed'
  const acc = await loadAccounts(projectId)
  if (acc.error) return NextResponse.json({ ok: false, reason: acc.error }, { status: 500 })

  let rows = acc.book.payments
  let label = 'every payment not yet confirmed by the Trust'
  if (range === 'all') label = 'every payment'
  else if (range.startsWith('fy:')) { const fy = range.slice(3); rows = rows.filter(p => fyOf(p.date) === fy); label = `FY ${fy}` }
  else if (range.startsWith('month:')) { const m = range.slice(6); rows = rows.filter(p => p.date?.startsWith(m)); label = `month ${m}` }
  else rows = rows.filter(p => !p.bankDate && p.confirmation?.status !== 'explained')

  const tag = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10)
  const fileName = `${fileSlug(gate.project.label)}_Payments-for-Trust-checking_${tag}.xlsx`
  const buf = buildStatementWorkbook(gate.project, rows, label)

  const supabase = await createClient()
  await supabase.from('accounts_statements').insert({ project_id: projectId, created_by: gate.userId, range_label: label, row_count: rows.length, file_name: fileName })

  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="${fileName}"`,
      'cache-control': 'no-store',
    },
  })
}
