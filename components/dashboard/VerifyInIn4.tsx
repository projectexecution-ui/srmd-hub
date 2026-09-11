// "Waiting to be verified in IN4" — the home-page counterpart of the teal
// counts on the ribbon and the projects lane.
//
// Separate from "Needs you now" on purpose. That list is CT Hub work on this
// person's desk; this is work parked in another system, which they may have to
// go and clear there. Mixing the two is what made the old dashboard
// untrustworthy — a count you cannot act on from here does not belong in a
// list of things you can.
//
// Self-hides when there is nothing at Verify.

import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { VERIFY_PILL } from '@/lib/revamp/verify-pill'
import { cn } from '@/lib/utils'
import { ClipboardCheck } from 'lucide-react'

export interface VerifyRow {
  projectId: string
  label: string
  indents: number
  wos: number
  pos: number
}

/** Plain words for a row, so the reader never has to decode three numbers. */
function words(r: { indents: number; wos: number; pos: number }): string {
  const parts = [
    r.indents ? `${r.indents} indent${r.indents === 1 ? '' : 's'}` : null,
    r.wos ? `${r.wos} work order${r.wos === 1 ? '' : 's'}` : null,
    r.pos ? `${r.pos} purchase order${r.pos === 1 ? '' : 's'}` : null,
  ].filter(Boolean)
  return parts.length <= 1
    ? (parts[0] ?? '')
    : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

export function VerifyInIn4({
  rows, unassigned,
}: {
  rows: VerifyRow[]
  /** At Verify, but on no sub-project CT Hub knows — so no project row can
   *  carry it. Shown rather than dropped: it is real work either way. */
  unassigned: { indents: number; wos: number; pos: number }
}) {
  const loose = unassigned.indents + unassigned.wos + unassigned.pos
  if (rows.length === 0 && loose === 0) return null

  const total = rows.reduce((t, r) => t + r.indents + r.wos + r.pos, 0) + loose

  return (
    <Card className="p-0 shadow-sm overflow-hidden border-l-4 border-teal-300">
      <div className="px-4 py-2.5 border-b border-slate-100 bg-teal-50/50 flex items-center gap-2 flex-wrap">
        <h3 className="font-bold text-slate-800 text-sm inline-flex items-center gap-1.5">
          <ClipboardCheck className="h-4 w-4 text-teal-600" />
          Waiting to be verified in IN4 · {total}
        </h3>
        <span className="ml-auto text-[11px] text-slate-500">
          Cleared in IN4, not here
        </span>
      </div>

      <div className="divide-y divide-slate-50">
        {rows.map(r => (
          <Link
            key={r.projectId}
            href={`/project/${r.projectId}`}
            className="flex items-center gap-2 px-4 py-2.5 hover:bg-slate-50/70 transition"
          >
            <span className="font-semibold text-slate-800 text-[13px] truncate">{r.label}</span>
            <span className="text-[11.5px] text-slate-500 truncate">{words(r)}</span>
            <span
              className={cn(
                'ml-auto inline-flex items-center justify-center rounded-full flex-shrink-0',
                VERIFY_PILL,
                'text-[10px] font-bold tabular-nums min-w-[17px] h-[17px] px-1',
              )}
            >
              {r.indents + r.wos + r.pos}
            </span>
          </Link>
        ))}

        {loose > 0 && (
          <div className="px-4 py-2.5">
            <p className="text-[12.5px] text-slate-700">
              <b>{words(unassigned)}</b> at Verify with no sub-project set in IN4.
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Nothing links these to a project, so they appear on no project screen —
              they can only be found in IN4 itself.
            </p>
          </div>
        )}
      </div>
    </Card>
  )
}
