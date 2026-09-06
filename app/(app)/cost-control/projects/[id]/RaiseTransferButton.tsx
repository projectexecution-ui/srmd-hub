'use client'
// Asking for budget to be moved from one work category into another.
//
// Two ways in, one form:
//
//  • From a line that is OVER BUDGET — the common case, and how the need
//    actually arises: "I am short here, take it from there". The destination
//    is fixed by where you clicked and the only real choice is the source.
//  • From the project header, with both sides to pick — so a move that is not
//    driven by an overspend is still possible without hunting for a row.
//
// Every rule shown here is enforced again in the database. What the form adds
// is telling you the rule BEFORE you type instead of after you submit: what
// each source line has free, why a category is absent from the list, and what
// happens once it is sent.

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeftRight, Loader2, X, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { MoneyInput } from '@/components/ui/money-input'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { formatINR } from '@/lib/utils'
import { getTransferLineOptions, raiseTransfer, type TransferLineOption } from './transfer-actions'

export function RaiseTransferButton({
  projectId, disciplineId, subSkillId, label, variant, shortfall = 0,
}: {
  projectId: string
  /** The line that needs the money. Omit to let the form ask. */
  disciplineId?: string
  subSkillId?: string
  label?: string
  variant: 'card' | 'row' | 'header'
  /** How far past its budget the destination already is, when known. */
  shortfall?: number
}) {
  const router = useRouter()
  const fixedTo = !!(disciplineId && subSkillId)

  const [open, setOpen] = useState(false)
  const [lines, setLines] = useState<TransferLineOption[] | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [toKey, setToKey] = useState('')
  const [fromKey, setFromKey] = useState('')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [pending, start] = useTransition()

  useEffect(() => {
    if (!open || lines) return
    let alive = true
    getTransferLineOptions(projectId).then(r => {
      if (!alive) return
      if (r.ok) setLines(r.lines)
      else setLoadErr(r.error)
    })
    return () => { alive = false }
  }, [open, lines, projectId])

  const all = lines ?? []
  const pickedTo = fixedTo
    ? { discipline_id: disciplineId!, sub_skill_id: subSkillId!, label: label ?? 'this line' }
    : (() => {
        const l = all.find(x => x.sub_skill_id === toKey)
        return l ? { discipline_id: l.discipline_id, sub_skill_id: l.sub_skill_id, label: `${l.sub_code} ${l.sub_name}` } : null
      })()
  const pickedFrom = all.find(x => x.sub_skill_id === fromKey) ?? null

  // A closed line takes no more budget and gives none — its leftover is
  // already promised to the ERP reduction queue.
  const open4 = (l: TransferLineOption) => !l.is_completed

  // Only ever ACROSS categories: moving budget inside one category needs no
  // request, so offering it here would invent a second way to do one thing.
  const destinations = all.filter(l =>
    open4(l) && (!pickedFrom || l.discipline_id !== pickedFrom.discipline_id))
  const sources = all.filter(l =>
    open4(l) && l.free_to_move > 0 && (!pickedTo || l.discipline_id !== pickedTo.discipline_id))

  const cap = pickedFrom?.free_to_move ?? 0
  const amt = Math.round(Number(amount || 0))
  const need = fixedTo ? shortfall : (all.find(x => x.sub_skill_id === toKey)?.over_budget ?? 0)

  const problem =
    !pickedTo ? 'Pick the line the budget should go into'
    : !pickedFrom ? 'Pick where the budget should come from'
    : amt <= 0 ? 'Enter an amount to move'
    : amt > cap ? `Only ${formatINR(cap)} is free to move off ${pickedFrom.sub_code} ${pickedFrom.sub_name}`
    : !reason.trim() ? 'Say why the budget is moving'
    : null

  const reset = () => {
    setOpen(false); setToKey(''); setFromKey(''); setAmount(''); setReason(''); setErr(null)
  }

  const submit = () => {
    if (problem) { setErr(problem); return }
    start(async () => {
      setErr(null)
      const r = await raiseTransfer({
        projectId,
        fromDisciplineId: pickedFrom!.discipline_id,
        fromSubSkillId: pickedFrom!.sub_skill_id,
        toDisciplineId: pickedTo!.discipline_id,
        toSubSkillId: pickedTo!.sub_skill_id,
        amount: amt,
        reason: reason.trim(),
      })
      if (!r.ok) { setErr(r.error); return }
      toast.success(`${formatINR(amt)} requested from ${pickedFrom!.sub_code} ${pickedFrom!.sub_name}`)
      reset()
      router.refresh()
    })
  }

  const trigger =
    variant === 'row' ? (
      // Icon only, and bare like the reopen and chevron buttons beside it.
      // MEASURED: the action cell already runs to 209px against a w-28 (112px)
      // hint, and the table's 944px minimum leaves 48px before it overflows
      // the 992px a 1280 screen gives. A labelled chip here measured +119.5px
      // — straight back to the sideways scroll on the HOD's Mac. This costs
      // 26px, leaving 22px. The phone card keeps the words.
      <button
        type="button" onClick={() => setOpen(true)}
        aria-label={`Move budget into ${label} from another work category`}
        title={shortfall > 0
          ? `Over budget by ${formatINR(shortfall)} — ask for budget from another work category`
          : `Ask for budget to be moved into ${label} from another work category`}
        className="inline-flex items-center justify-center h-5 w-5 rounded text-indigo-600 hover:bg-indigo-100 flex-shrink-0"
      >
        <ArrowLeftRight className="h-3.5 w-3.5" />
      </button>
    ) : variant === 'header' ? (
      // Shares this bar with "Work categories" and the tree toolbar, which at
      // 375px leaves no room for another word — so the label is the part that
      // gives way, as it does in the page header above.
      <button
        type="button" onClick={() => setOpen(true)}
        aria-label="Move budget between work categories"
        title="Move budget between work categories"
        className="inline-flex items-center justify-center gap-1.5 min-h-[36px] min-w-[36px] px-1.5 sm:px-2.5 rounded-md border border-gray-300 bg-white text-[12.5px] font-semibold text-gray-700 hover:bg-gray-50"
      >
        <ArrowLeftRight className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Move budget</span>
      </button>
    ) : (
      <button
        type="button" onClick={() => setOpen(true)}
        className="mt-2.5 flex w-full items-center justify-center gap-1.5 min-h-[44px] rounded-lg border border-indigo-300 bg-indigo-50 text-sm font-semibold text-indigo-800"
      >
        <ArrowLeftRight className="h-4 w-4" /> Move budget in
        {shortfall > 0 && <span className="font-normal">· short {formatINR(shortfall)}</span>}
      </button>
    )

  if (!open) return trigger

  const nothingFree = !!lines && all.filter(l => open4(l) && l.free_to_move > 0).length === 0

  return (
    <>
      {trigger}
      <div
        className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center sm:p-4 bg-black/40"
        role="dialog" aria-modal="true" aria-label="Move budget between work categories"
        onClick={reset}
      >
        <div
          className="w-full sm:max-w-lg max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-white shadow-xl border border-gray-200"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-3 px-4 sm:px-5 pt-4 pb-3 border-b border-gray-100 sticky top-0 bg-white z-10">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-gray-900">
                {fixedTo ? 'Move budget in' : 'Move budget between categories'}
              </h2>
              {fixedTo && (
                <p className="text-[12.5px] text-gray-600 mt-0.5">
                  Into <b className="text-gray-900">{label}</b>
                  {shortfall > 0 && <> — over budget by <b className="text-rose-700">{formatINR(shortfall)}</b></>}
                </p>
              )}
            </div>
            <button
              type="button" onClick={reset} aria-label="Close"
              className="h-9 w-9 -mr-1 -mt-1 inline-flex items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700 flex-shrink-0"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="px-4 sm:px-5 py-4 flex flex-col gap-4">
            {loadErr && <p className="text-[12.5px] font-semibold text-rose-700">{loadErr}</p>}
            {!lines && !loadErr && (
              <p className="text-[13px] text-gray-500 inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Reading what each line has spare…
              </p>
            )}

            {nothingFree && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                <p className="text-[13px] font-semibold text-amber-900 inline-flex items-center gap-1.5">
                  <TriangleAlert className="h-4 w-4" /> Nothing is free to move
                </p>
                <p className="text-[12px] text-amber-800 mt-1">
                  No line on this project has budget that is both unpaid and not already
                  committed on a WO/PO. Committed money cannot be moved — a bill is coming
                  for it.
                </p>
              </div>
            )}

            {lines && !nothingFree && (
              <>
                {!fixedTo && (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="tr-to">Move it into</Label>
                    <SearchableSelect
                      id="tr-to"
                      value={toKey}
                      onChange={id => { setToKey(id); setErr(null) }}
                      placeholder="Pick the line that needs the budget…"
                      options={destinations.map(l => ({
                        id: l.sub_skill_id,
                        label: `${l.disc_code} ${l.disc_name} › ${l.sub_code} ${l.sub_name}`,
                        hint: l.over_budget > 0 ? `over by ${formatINR(l.over_budget)}` : formatINR(l.budget),
                      }))}
                      emptyText="No line available"
                    />
                    {need > 0 && (
                      <p className="text-[11.5px] font-semibold text-rose-700">
                        That line is over budget by {formatINR(need)}.
                      </p>
                    )}
                  </div>
                )}

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="tr-from">Take it from</Label>
                  <SearchableSelect
                    id="tr-from"
                    value={fromKey}
                    onChange={id => { setFromKey(id); setErr(null) }}
                    placeholder="Pick a line with spare budget…"
                    options={sources.map(l => ({
                      id: l.sub_skill_id,
                      label: `${l.disc_code} ${l.disc_name} › ${l.sub_code} ${l.sub_name}`,
                      hint: `${formatINR(l.free_to_move)} free`,
                    }))}
                    emptyText="No other category has spare budget"
                  />
                  <p className="text-[11.5px] text-gray-500">
                    Only other work categories are listed. Moving budget inside one category is
                    already allowed without a request, and CT Hub labels it after the next sync.
                  </p>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="tr-amt">Amount to move</Label>
                  <MoneyInput
                    id="tr-amt" value={amount}
                    onChange={raw => { setAmount(raw); setErr(null) }}
                    decimals={0} placeholder="0" inputMode="numeric"
                  />
                  {pickedFrom && (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-[11.5px] text-gray-500">
                        {formatINR(cap)} free on {pickedFrom.sub_code} {pickedFrom.sub_name}
                      </span>
                      {need > 0 && need <= cap && (
                        <button
                          type="button"
                          onClick={() => { setAmount(String(need)); setErr(null) }}
                          className="text-[11.5px] font-semibold text-indigo-700 hover:underline"
                        >
                          Cover the {formatINR(need)} shortfall
                        </button>
                      )}
                      {cap > 0 && (
                        <button
                          type="button"
                          onClick={() => { setAmount(String(cap)); setErr(null) }}
                          className="text-[11.5px] font-semibold text-indigo-700 hover:underline"
                        >
                          Use all {formatINR(cap)}
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="tr-why">Why is it moving?</Label>
                  <Textarea
                    id="tr-why" value={reason} rows={3}
                    onChange={e => { setReason(e.target.value); setErr(null) }}
                    placeholder="e.g. Steel Works is over by 4,03,206 against the approved rate; High Side has spare uncommitted budget."
                  />
                  <p className="text-[11.5px] text-gray-500">
                    This is what the Atm Head, the Trustee and anyone reading either line later
                    will see. Say what changed, not just that money is needed.
                  </p>
                </div>
              </>
            )}

            {err && <p className="text-[12.5px] font-semibold text-rose-700">{err}</p>}
          </div>

          <div className="px-4 sm:px-5 py-3 border-t border-gray-100 bg-gray-50/60 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3">
            <p className="text-[11.5px] text-gray-500">
              Goes to the Atm Head, then the Trustee, then IN4. No budget moves until it is
              approved and keyed in there.
            </p>
            <div className="flex flex-col-reverse sm:flex-row gap-2 sm:flex-shrink-0">
              <Button variant="ghost" onClick={reset} className="w-full sm:w-auto">Cancel</Button>
              <Button
                onClick={submit}
                disabled={pending || !lines || nothingFree}
                className="w-full sm:w-auto"
              >
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowLeftRight className="h-4 w-4" />}
                Send request
              </Button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
