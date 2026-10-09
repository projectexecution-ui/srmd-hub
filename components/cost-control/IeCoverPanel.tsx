'use client'
// Internal Estimate cover — shown to the Project Head / Atm Head at sign-off
// when the request is not covered by the sub-category's Internal Estimate
// (Aksha, 9 Oct 2026). Two ways to close the gap, used together if needed:
//   • take spare estimate from other sub-categories of the SAME category;
//   • add new Internal Estimate.
// Takes effect at once, no Trustee step. The sign-off stays blocked until the
// gap is closed — the database gate enforces it on every path.
// Management-only figures: this renders only when the viewer may sign off now.
// One layout for phone and desktop: rows stack, inputs are 44px tall.

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MoneyInput } from '@/components/ui/money-input'
import { formatINR } from '@/lib/utils'
import { coverInternalEstimate } from '@/components/cost-control/ws-actions'
import { donorRows, suggestCover, rowLabel, type IePosition } from '@/lib/cost-control/ie-cover'

export function IeCoverPanel({ wsId, pos }: { wsId: string; pos: IePosition }) {
  const router = useRouter()
  const shortfall = Math.round(pos.shortfall ?? 0)
  const donors = useMemo(() => donorRows(pos), [pos])
  const suggested = useMemo(() => suggestCover(shortfall, donors), [shortfall, donors])
  const [takes, setTakes] = useState<Record<string, string>>(
    () => Object.fromEntries(Object.entries(suggested.takes).map(([k, v]) => [k, String(v)])),
  )
  const [addNew, setAddNew] = useState<string>(suggested.addNew > 0 ? String(suggested.addNew) : '')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const thisRow = (pos.rows ?? []).find(r => r.is_this)
  const ask = Math.round(pos.ask ?? 0)
  const otherWaiting = Math.max(Math.round((pos.pending ?? 0) - ask), 0)

  const takeTotal = donors.reduce((t, d) => t + (Number(takes[d.sub_skill_id]) || 0), 0)
  const covered = Math.round(takeTotal + (Number(addNew) || 0))
  const overSpare = donors.find(d => (Number(takes[d.sub_skill_id]) || 0) > Math.floor(d.spare))
  const stillShort = Math.max(shortfall - covered, 0)

  // Say exactly why the button will not work — never a silently grey button.
  const blockReason =
    overSpare ? `${rowLabel(overSpare)} has only ${formatINR(Math.floor(overSpare.spare))} spare`
    : stillShort > 0 ? `Still short by ${formatINR(stillShort)} — take more or add new`
    : note.trim().length < 3 ? 'Add a short reason'
    : null

  async function apply() {
    if (blockReason) { setErr(blockReason); return }
    setBusy(true); setErr(null)
    const r = await coverInternalEstimate(wsId, {
      moves: donors
        .map(d => ({ sub_skill_id: d.sub_skill_id, amount: Math.round(Number(takes[d.sub_skill_id]) || 0) }))
        .filter(m => m.amount > 0),
      addNew: Math.round(Number(addNew) || 0),
      note: note.trim(),
    })
    setBusy(false)
    if (!r.ok) { setErr(r.error ?? 'Could not update the Internal Estimate'); return }
    toast.success('Internal Estimate updated — you can sign off now')
    router.refresh()
  }

  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50/70 p-3 space-y-3">
      <div>
        <p className="text-[13.5px] font-bold text-rose-900">
          Internal Estimate is short by {formatINR(shortfall)}
        </p>
        <p className="text-[12px] text-rose-900/90 mt-0.5 break-words">
          {thisRow ? rowLabel(thisRow) : 'This sub-category'}
        </p>
        <p className="text-[11.5px] text-rose-800 mt-1 tabular-nums flex flex-wrap gap-x-3 gap-y-0.5">
          <span>Internal Estimate <b>{formatINR(pos.ie ?? 0)}</b></span>
          <span>Approved <b>{formatINR(pos.approved ?? 0)}</b></span>
          {otherWaiting > 0 && <span>Other requests waiting <b>{formatINR(otherWaiting)}</b></span>}
          <span>This request <b>{formatINR(ask)}</b></span>
        </p>
        <p className="text-[11.5px] text-gray-600 mt-1">
          Cover it before signing off. It changes the Internal Estimate at once; the engineer does not see it.
        </p>
      </div>

      {!pos.can_cover ? (
        <p className="text-[12.5px] text-gray-700 bg-white/70 border border-rose-100 rounded-md px-3 py-2">
          {pos.cover_block ?? 'Only the person signing off this stage can cover it.'}
        </p>
      ) : (
        <>
          <div className="space-y-2">
            <p className="text-[12px] font-semibold text-gray-800">
              Take from {pos.discipline ?? 'the same category'}
            </p>
            {donors.length === 0 ? (
              <p className="text-[12px] text-gray-500">No other sub-category of this category has spare Internal Estimate.</p>
            ) : (
              <div className="divide-y divide-rose-100 rounded-md border border-rose-100 bg-white">
                {donors.map(d => (
                  <div key={d.sub_skill_id} className="flex flex-col sm:flex-row sm:items-center gap-2 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-[12.5px] font-medium text-gray-900 break-words">{rowLabel(d)}</p>
                      <p className="text-[11px] text-gray-500 tabular-nums">Spare {formatINR(Math.floor(d.spare))}</p>
                    </div>
                    <MoneyInput
                      value={takes[d.sub_skill_id] ?? ''}
                      onChange={v => setTakes(t => ({ ...t, [d.sub_skill_id]: v }))}
                      decimals={0}
                      placeholder="0"
                      disabled={busy}
                      aria-label={`Take from ${rowLabel(d)}`}
                      className="h-11 w-full sm:w-44 rounded-md border border-gray-300 bg-white px-2 text-right text-sm tabular-nums"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-semibold text-gray-800">Add new Internal Estimate</p>
              <p className="text-[11px] text-gray-500">Raises the category&apos;s total Internal Estimate.</p>
            </div>
            <MoneyInput
              value={addNew}
              onChange={setAddNew}
              decimals={0}
              placeholder="0"
              disabled={busy}
              aria-label="Add new Internal Estimate"
              className="h-11 w-full sm:w-44 rounded-md border border-gray-300 bg-white px-2 text-right text-sm tabular-nums"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[12px] font-semibold text-gray-800" htmlFor={`ie-note-${wsId}`}>
              Reason <span className="text-rose-600">*</span>
            </label>
            <textarea
              id={`ie-note-${wsId}`}
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={2}
              disabled={busy}
              className="w-full rounded-md border border-gray-300 bg-white p-2 text-sm"
              placeholder="Why the estimate moves — e.g. wiring was estimated inside 701 Panels & DBs"
            />
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-between">
            <p className={`text-[12px] tabular-nums ${stillShort > 0 ? 'text-rose-700 font-semibold' : 'text-emerald-700 font-semibold'}`}>
              Covers {formatINR(covered)} of {formatINR(shortfall)}
            </p>
            <Button onClick={apply} disabled={busy} className="w-full sm:w-auto min-h-11 font-semibold">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Update Internal Estimate
            </Button>
          </div>
          {(err || blockReason) && (
            <p role={err ? 'alert' : undefined} className={`text-[12px] ${err ? 'text-rose-700 bg-white border border-rose-200 rounded-md px-3 py-2' : 'text-gray-600'}`}>
              {err ?? blockReason}
            </p>
          )}
        </>
      )}
    </div>
  )
}
