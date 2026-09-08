// A work order's ledger as a printable page: every bill and advance in date
// order with the running "still to pay". Same A4 rules as the printed work
// order; HTML on purpose, so the browser's own print dialogue makes the PDF.
// Gated on cost-control view, like the tree it is opened from. Read-only.

import { NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth'
import { loadWoLedger } from '@/lib/revamp/orders-tree'
import { formatINR } from '@/lib/utils'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
const money = (v: number) => esc(formatINR(v))

export async function GET(_req: Request, { params }: { params: Promise<{ woId: string }> }) {
  await requirePermission('cost-control', 'view')
  const { woId: raw } = await params
  const woId = Number(raw)
  if (!Number.isInteger(woId) || woId <= 0) return new NextResponse('Not a work order id', { status: 400 })

  const d = await loadWoLedger(woId)
  if (!d) return new NextResponse('This work order is not in the mirror.', { status: 404 })
  const t = d.ledger.totals
  const stillToPay = d.gross - t.paidOut - t.retention

  const rows = d.ledger.rows.map(r => `
    <tr class="${r.status === 'live' ? '' : 'off'}">
      <td>${esc(r.date ?? '')}</td>
      <td>${esc(r.ref)}${r.status !== 'live' ? ` <span class="tag">${r.status}</span>` : ''}</td>
      <td>${r.kind === 'advance' ? 'Advance' : 'Bill'}</td>
      <td class="n">${money(r.gross)}</td>
      <td class="n">${money(r.certified)}</td>
      <td class="n">${money(r.tds)}</td>
      <td class="n">${money(r.retention)}</td>
      <td class="n">${money(r.advanceRecovered)}</td>
      <td class="n">${money(r.paid)}</td>
      <td class="n b">${r.status === 'live' ? money(r.stillToPay) : ''}</td>
    </tr>`).join('')

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Ledger — ${esc(d.ref)}</title>
<style>
  @page { size: A4 landscape; margin: 12mm }
  body { margin: 0; font: 11.5px/1.45 system-ui, sans-serif; color: #111 }
  .wrap { max-width: 1120px; margin: 0 auto; padding: 16px }
  h1 { font-size: 16px; margin: 0 } .sub { color: #555; margin: 2px 0 12px }
  table { width: 100%; border-collapse: collapse } th, td { padding: 5px 6px; border-bottom: 1px solid #e5e7eb; vertical-align: top }
  th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; color: #555; background: #f8fafc }
  .n, th.n { text-align: right; font-variant-numeric: tabular-nums } .b { font-weight: 700 }
  tr.off td { color: #9ca3af } .tag { font-size: 10px; border: 1px solid #d1d5db; border-radius: 4px; padding: 0 4px; color: #6b7280 }
  tfoot td { border-top: 2px solid #d1d5db; font-weight: 700; background: #f8fafc }
  .bar { display: flex; gap: 8px; justify-content: flex-end; margin-bottom: 10px }
  button { font: inherit; padding: 6px 12px; border: 1px solid #c7d2fe; background: #eef2ff; border-radius: 6px; cursor: pointer }
  .note { color: #555; margin-top: 10px } thead { display: table-header-group } tr { page-break-inside: avoid }
  @media print { .bar { display: none } .wrap { padding: 0 } }
</style></head><body><div class="wrap">
  <div class="bar"><button onclick="window.print()">Print / save as PDF</button></div>
  <h1>${esc(d.ref)}${d.party ? ` — ${esc(d.party)}` : ''}</h1>
  <p class="sub">Ordered (with GST) ${money(d.gross)} · ${d.ledger.rows.length} entr${d.ledger.rows.length === 1 ? 'y' : 'ies'} · ${d.in4 === 'live' ? 'order value live from IN4' : 'order value from the mirror (IN4 not reached)'}</p>
  <table>
    <thead><tr><th>Date</th><th>Bill</th><th>Type</th><th class="n">Gross</th><th class="n">Certified</th><th class="n">TDS</th><th class="n">Retention</th><th class="n">Advance recovered</th><th class="n">Paid</th><th class="n">Still to pay</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="10" style="text-align:center;color:#6b7280">No bills or advances in IN4 against this order.</td></tr>'}</tbody>
    <tfoot><tr><td colspan="3">Totals — live entries</td><td class="n">${money(t.billed + t.advancePaid)}</td><td class="n"></td><td class="n">${money(t.tds)}</td><td class="n">${money(t.retention)}</td><td class="n">${money(t.advanceRecovered)}</td><td class="n">${money(t.paid)}</td><td class="n">${money(stillToPay)}</td></tr></tfoot>
  </table>
  <p class="note">Money out = bill payments + TDS (counted as paid) + advances as billed. Still to pay = Ordered − money out − retention held; retention is released at the end. Cancelled and rejected certificates are shown greyed and add nothing. Every figure is IN4’s own; the running column is the only arithmetic.</p>
</div></body></html>`
  return new NextResponse(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })
}
