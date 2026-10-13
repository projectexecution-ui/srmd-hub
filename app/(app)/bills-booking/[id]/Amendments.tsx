import { FilePenLine } from 'lucide-react'
import { formatDate, formatINR } from '@/lib/utils'

export interface AmendmentRow {
  amendment_no: number
  status_name: string | null
  gross_value: number | null
  approved_at: string | null
  approved_by: string | null
  remark: string | null
}

/** "WO amended 2× in IN4" — one line, the short trail on a click (Aksha, 13 Oct
 *  2026: "show the trail in short in a hover or click - not a major addition in
 *  page is needed but all should know the WO or PO is amended"). */
export function Amendments({ kind, orderNo, rows }: { kind: string; orderNo: string; rows: AmendmentRow[] }) {
  const done = rows.filter(r => r.amendment_no > 0 && r.status_name === 'Amended & Approved')
  if (!done.length) return null
  const pending = rows.filter(r => r.amendment_no > 0 && r.status_name !== 'Amended & Approved')
  const latest = done[done.length - 1]
  const valueAt = (no: number) => rows.find(r => r.amendment_no === no)?.gross_value ?? null
  const short = done.map(r => `Amendment ${r.amendment_no}${r.approved_at ? `, ${formatDate(r.approved_at)}` : ''}: ${formatINR(Number(valueAt(r.amendment_no - 1) ?? 0))} → ${formatINR(Number(r.gross_value ?? 0))}`).join('\n')

  return (
    <details className="group rounded-xl border border-indigo-200 bg-indigo-50/60 text-sm text-indigo-950">
      <summary title={short} className="flex min-h-[44px] cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2.5">
        <FilePenLine className="h-4 w-4 shrink-0 text-indigo-600" />
        <b>{kind} amended {done.length}× in IN4</b>
        <span className="text-indigo-900/80">
          · now {formatINR(Number(latest.gross_value ?? 0))} (amendment {latest.amendment_no}{latest.approved_at ? `, ${formatDate(latest.approved_at)}` : ''})
          {pending.length > 0 && ` · amendment ${pending[pending.length - 1].amendment_no} is ${pending[pending.length - 1].status_name?.replace('Amended & ', '').toLowerCase() ?? 'pending'} in IN4`}
        </span>
        <span className="ml-auto text-[12px] font-semibold text-indigo-700 group-open:hidden">Show the trail</span>
        <span className="ml-auto hidden text-[12px] font-semibold text-indigo-700 group-open:inline">Hide</span>
      </summary>
      <ol className="space-y-1.5 border-t border-indigo-200 px-4 py-3 text-[13px]">
        <li className="text-indigo-900/80">
          {orderNo} as first approved: <b className="tabular-nums text-indigo-950">{formatINR(Number(valueAt(0) ?? 0))}</b>
        </li>
        {rows.filter(r => r.amendment_no > 0).map(r => (
          <li key={r.amendment_no} className="flex flex-wrap items-baseline gap-x-2">
            <b className="text-indigo-950">Amendment {r.amendment_no}</b>
            <span className="tabular-nums">{formatINR(Number(valueAt(r.amendment_no - 1) ?? 0))} → <b>{formatINR(Number(r.gross_value ?? 0))}</b></span>
            <span className="text-indigo-900/80">
              {r.status_name === 'Amended & Approved'
                ? <>approved{r.approved_at ? ` ${formatDate(r.approved_at)}` : ''}{r.approved_by ? ` by ${r.approved_by}` : ''}</>
                : <>{r.status_name ?? 'pending'} in IN4</>}
            </span>
            {r.remark && <span className="text-indigo-900/80">· “{r.remark}”</span>}
          </li>
        ))}
      </ol>
    </details>
  )
}
