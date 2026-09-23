// "For you to verify in IN4" — the Atm Head's card on the home page.
//
// Separate from "Needs you now" on purpose. That list is CT Hub work on this
// person's desk; this is work parked in another system, which they have to go
// and clear there. Mixing the two is what made the old dashboard
// untrustworthy — a count you cannot act on from here does not belong in a
// list of things you can.
//
// Shown ONLY to the Atm Head of the projects it names (lib/dashboard/scope.ts
// decides; the page passes nothing for anyone else). Aksha, 23 Sep 2026: the
// card was on every engineer's and viewer's home, and "all are getting
// confused". The numbers are read from IN4 itself, at most a minute old — not
// from the twice-a-day mirror — and the card now SAYS when it read them, so
// nobody has to guess whether they are live.
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

/** "09:41 am" in IST — the time only; the date is today's or the card is stale anyway. */
function istTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })
}

export function VerifyInIn4({
  rows, unassigned, fetchedAt,
}: {
  rows: VerifyRow[]
  /** At Verify, but on no sub-project CT Hub knows — so no project row can
   *  carry it. Shown rather than dropped: it is real work either way. */
  unassigned: { indents: number; wos: number; pos: number }
  /** When IN4 was read (ISO); null when it could not be reached. */
  fetchedAt: string | null
}) {
  const loose = unassigned.indents + unassigned.wos + unassigned.pos
  if (rows.length === 0 && loose === 0) return null

  const total = rows.reduce((t, r) => t + r.indents + r.wos + r.pos, 0) + loose

  return (
    <Card className="p-0 shadow-sm overflow-hidden border-l-4 border-teal-300">
      <div className="px-4 py-2.5 border-b border-slate-100 bg-teal-50/50 flex items-center gap-2 flex-wrap">
        <h3 className="font-bold text-slate-800 text-sm inline-flex items-center gap-1.5">
          <ClipboardCheck className="h-4 w-4 text-teal-600" />
          For you to verify in IN4 · {total}
        </h3>
        <span className="ml-auto text-[11px] text-slate-500 tabular-nums">
          {fetchedAt ? `Read from IN4 at ${istTime(fetchedAt)} IST · refreshes every minute` : 'IN4 could not be reached'}
        </span>
      </div>

      <div className="divide-y divide-slate-50">
        {rows.map(r => (
          <Link
            key={r.projectId}
            href={`/project/${r.projectId}`}
            className="flex items-center gap-2 px-4 py-2.5 hover:bg-slate-50/70 transition min-h-[44px]"
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

      <p className="px-4 py-2 text-[11px] text-slate-500 border-t border-slate-100 bg-slate-50/60">
        These are cleared in IN4, not here. Once you verify there, this card updates within a minute.
      </p>
    </Card>
  )
}
