'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Card } from '@/components/ui/card'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { confirm } from '@/components/ui/confirm-dialog'
import { saveCountLine, addFoundItem, submitCount, approveCount, rejectCount, abandonCount, createItem } from '../../actions'
import { summarize, submitBlocker, hasDiff, diffOf, isReached } from '@/lib/warehouse/count'
import type { CountLine } from '@/lib/warehouse/count'
import { formatQty, formatINR } from '@/lib/warehouse/format'
import {
  Loader2, Check, SkipForward, ChevronLeft, ChevronRight, Plus,
  AlertTriangle, ClipboardCheck, ListChecks,
} from 'lucide-react'

const inputCls =
  'w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm bg-white min-h-[40px] ' +
  'focus:outline-none focus:ring-2 focus:ring-violet-400/40 focus:border-violet-400'
const labelCls = 'block text-[10px] font-extrabold uppercase tracking-wider text-slate-400 mb-1'

/** Reasons a shelf cannot be counted at all — different from why it does not
 *  tally, which is what the admin's reason list covers. */
const SKIP_HINTS = ['Godown locked', 'No access right now', 'Stacked under other material', 'Item not traced']

type Phase = 'count' | 'explain' | 'close'

export function CountSheet(props: {
  countId: string
  countNo: string
  store: string
  scopeTitle: string
  status: string
  blind: boolean
  lines: CountLine[]
  reasons: string[]
  units: string[]
  items: Array<{ id: string; name: string; unit: string }>
  counterName: string | null
  witnessName: string | null
  approverName: string | null
  hasWitness: boolean
  rejectReason: string | null
  canEdit: boolean
  canApprove: boolean
  iAmTheCounter: boolean
  showValues: boolean
}) {
  if (props.status === 'counting') return <WalkingSheet {...props} />
  return <ClosedSheet {...props} />
}

// ===========================================================================
// Steps 2–4 — the walk itself. One item fills the screen, because this is done
// standing in a godown on a phone, one hand on the material.
// ===========================================================================

function WalkingSheet(props: Parameters<typeof CountSheet>[0]) {
  const router = useRouter()
  const [saving, startSaving] = useTransition()

  const [rows, setRows] = useState<CountLine[]>(props.lines)
  const [cursor, setCursor] = useState(() => {
    const next = props.lines.findIndex(l => !isReached(l))
    return next === -1 ? Math.max(0, props.lines.length - 1) : next
  })
  const [phase, setPhase] = useState<Phase>(() =>
    props.lines.length > 0 && props.lines.every(isReached) ? 'close' : 'count')

  const [entry, setEntry] = useState('')
  const [skipping, setSkipping] = useState(false)
  const [skipReason, setSkipReason] = useState('')
  const [reason, setReason] = useState('')
  const [remark, setRemark] = useState('')
  const [showSheet, setShowSheet] = useState(false)
  const [found, setFound] = useState('')
  const [confirmed, setConfirmed] = useState(false)

  const s = useMemo(() => summarize(rows), [rows])
  const line: CountLine | undefined = rows[cursor]
  const blocker = submitBlocker(rows, props.hasWitness ? 'witness' : null)

  // An item added mid-walk arrives as a fresh server render. Merge it in rather
  // than remounting, so a found item does not throw away where he had got to.
  // Adjusted during render (not in an effect) so there is no second pass: the
  // locally-held line wins for anything already on the sheet, and a genuinely
  // new line is taken from the server.
  const idsSig = props.lines.map(l => l.id).join(',')
  const [seenSig, setSeenSig] = useState(idsSig)
  if (seenSig !== idsSig) {
    setSeenSig(idsSig)
    setRows(prev => {
      const mine = new Map(prev.map(r => [r.id, r]))
      return props.lines.map(l => mine.get(l.id) ?? l)
    })
  }

  /** Load a line into the editor. */
  function goTo(i: number, ph: Phase = 'count', source: CountLine[] = rows) {
    const l = source[i]
    setCursor(i)
    setPhase(ph)
    setEntry(l?.countedQty == null ? '' : String(l.countedQty))
    setReason(l?.reason ?? '')
    setRemark(l?.remark ?? '')
    setSkipping(false)
    setSkipReason(l?.skipReason ?? '')
  }

  /** Next unreached line, or the closing screen when the walk is done.
   *
   *  Reads the POST-save rows, not the state that has not re-rendered yet —
   *  otherwise the last item on the sheet looks unreached and he is sent back
   *  round to the item he has just counted. */
  function advance(from: number, source: CountLine[]) {
    const after = source.findIndex((l, i) => i > from && !isReached(l))
    const any = after === -1 ? source.findIndex(l => !isReached(l)) : after
    if (any === -1) { setPhase('close'); return }
    goTo(any, 'count', source)
  }

  function saveLine(l: CountLine, next: Partial<CountLine>, then: (rows: CountLine[]) => void) {
    const merged = { ...l, ...next }
    const nextRows = rows.map(r => (r.id === l.id ? merged : r))
    startSaving(async () => {
      const res = await saveCountLine({
        lineId: l.id,
        countedQty: merged.skipped ? null : merged.countedQty,
        skipped: merged.skipped,
        skipReason: merged.skipReason,
        reason: merged.reason,
        remark: merged.remark,
      })
      if (!res.ok) { toast.error(res.error ?? 'Could not save this line.'); return }
      setRows(nextRows)
      then(nextRows)
    })
  }

  /** Step 2 → the number. A tallied item goes straight to the next one; only a
   *  difference costs an extra screen. */
  function submitNumber() {
    if (!line) return
    const qty = Number(entry.replace(/[^\d.]/g, ''))
    if (!entry.trim() || !Number.isFinite(qty)) {
      toast.error('Type the quantity you counted — 0 if there is none, or skip it with a reason.')
      return
    }
    const tallies = qty === line.bookQty
    saveLine(line, { countedQty: qty, skipped: false, skipReason: null }, next => {
      if (tallies) { advance(cursor, next); return }
      setReason(line.reason ?? '')
      setRemark(line.remark ?? '')
      setPhase('explain')
    })
  }

  /** Step 3 — only when it doesn't tally. */
  function submitReason() {
    if (!line) return
    if (!reason.trim()) { toast.error('Pick why it does not tally — that is the part management acts on.'); return }
    saveLine(line, { reason: reason.trim(), remark: remark.trim() || null }, next => advance(cursor, next))
  }

  function submitSkip() {
    if (!line) return
    if (!skipReason.trim()) { toast.error('Say why it could not be counted.'); return }
    saveLine(line, { skipped: true, skipReason: skipReason.trim(), countedQty: null, reason: null }, next => {
      setSkipping(false)
      advance(cursor, next)
    })
  }

  function addFound() {
    if (!found) return
    startSaving(async () => {
      const res = await addFoundItem({ countId: props.countId, itemId: found })
      if (!res.ok) { toast.error(res.error ?? 'Could not add that item.'); return }
      setFound('')
      toast.success('Added to the sheet.')
      router.refresh()
    })
  }

  function doSubmit() {
    startSaving(async () => {
      const res = await submitCount(props.countId)
      if (!res.ok) { toast.error(res.error ?? 'Could not submit this count.'); return }
      toast.success('Submitted for approval. Stock has not moved yet.')
      router.refresh()
    })
  }

  function doAbandon() {
    startSaving(async () => {
      const ok = await confirm({
        title: 'Discard this count?',
        message: `Everything counted on ${props.countNo} is thrown away and ${props.store} becomes free to count again. `
          + 'Nothing in stock changes.',
        confirmLabel: 'Discard it',
      })
      if (!ok) return
      const res = await abandonCount(props.countId)
      if (!res.ok) { toast.error(res.error ?? 'Could not discard this count.'); return }
      toast.success('Discarded. Nothing in stock changed.')
      router.push('/warehouse/count')
    })
  }

  const onSheet = rows.filter(l => !isReached(l)).length
  const notOnSheet = props.items.filter(i => !rows.some(r => r.itemId === i.id))

  return (
    <div className="space-y-3">
      <Stepper phase={phase} counted={s.counted + s.skipped} total={s.total} />

      {props.lines.length === 0 && (
        <Card className="p-4 shadow-sm space-y-2">
          <p className="text-[13px] font-bold text-slate-800">Nothing on this sheet.</p>
          <p className="text-[12px] text-slate-600">
            The book says this store holds nothing. Add whatever you can actually see below — that is how
            material received without a gate entry gets found.
          </p>
        </Card>
      )}

      {/* ---------------- Step 2 · Count ---------------- */}
      {phase === 'count' && line && (
        <Card className="p-0 shadow-sm overflow-hidden">
          <div className="px-4 py-2 bg-violet-700 text-white flex items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider">Count</span>
            <span className="ml-auto text-[11px] font-mono opacity-90 tabular-nums">
              item {cursor + 1} of {rows.length}
            </span>
          </div>

          <div className="p-4 space-y-3">
            <div>
              <h3 className="text-lg font-extrabold text-slate-900 leading-tight break-words">{line.itemName}</h3>
              <p className="text-[12px] text-slate-500 mt-0.5">
                Counted in <b>{line.unit}</b>
                {!props.blind && <> · book says <b className="tabular-nums">{formatQty(line.bookQty)} {line.unit}</b></>}
              </p>
            </div>

            {props.blind && (
              <p className="text-[11.5px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5">
                The book figure is hidden until you enter yours.
              </p>
            )}

            {!skipping && (
              <>
                <div>
                  <label className={labelCls} htmlFor="count-qty">How many are actually here</label>
                  <input id="count-qty" autoFocus inputMode="decimal" value={entry}
                    onChange={e => setEntry(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') submitNumber() }}
                    placeholder="0"
                    className="w-full rounded-xl border-2 border-slate-300 px-3 py-3 text-3xl font-extrabold tabular-nums text-center bg-white focus:outline-none focus:ring-2 focus:ring-violet-400/40 focus:border-violet-400" />
                  <p className="text-[11px] text-slate-500 mt-1 text-center">
                    Enter 0 if the shelf is empty — that is a real count, not a skip.
                  </p>
                </div>

                <div className="grid grid-cols-[auto_1fr] gap-2">
                  <button type="button" onClick={() => setSkipping(true)} disabled={saving}
                    className="rounded-lg border-2 border-slate-200 px-3 py-2.5 min-h-[44px] text-[12.5px] font-bold text-slate-600 hover:border-slate-300 inline-flex items-center justify-center gap-1.5">
                    <SkipForward className="h-3.5 w-3.5" /> Can&apos;t count it
                  </button>
                  <button type="button" onClick={submitNumber} disabled={saving}
                    className="rounded-lg bg-violet-700 hover:bg-violet-800 px-3 py-2.5 min-h-[44px] text-sm font-bold text-white disabled:opacity-50 inline-flex items-center justify-center gap-1.5">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Next <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </>
            )}

            {skipping && (
              <div className="space-y-2 rounded-xl border-2 border-amber-200 bg-amber-50 p-3">
                <label className={labelCls} htmlFor="skip-reason">Why can&apos;t it be counted?</label>
                <input id="skip-reason" className={inputCls} value={skipReason} autoFocus
                  onChange={e => setSkipReason(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') submitSkip() }} />
                <div className="flex flex-wrap gap-1.5">
                  {SKIP_HINTS.map(h => (
                    <button key={h} type="button" onClick={() => setSkipReason(h)}
                      className="rounded-full border border-amber-300 bg-white px-2.5 py-1.5 min-h-[32px] text-[11.5px] font-semibold text-amber-900 hover:bg-amber-100">
                      {h}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-amber-900">
                  A skipped item keeps its book quantity — nothing is corrected, and it shows on the count as not checked.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setSkipping(false)}
                    className="rounded-lg border-2 border-amber-300 bg-white py-2 min-h-[40px] text-[12.5px] font-bold text-amber-900">
                    Back
                  </button>
                  <button type="button" onClick={submitSkip} disabled={saving}
                    className="rounded-lg bg-amber-600 hover:bg-amber-700 py-2 min-h-[40px] text-[12.5px] font-bold text-white disabled:opacity-50">
                    Skip this item
                  </button>
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 pt-1 border-t border-slate-100">
              <button type="button" disabled={cursor === 0} onClick={() => goTo(cursor - 1)}
                className="text-[12px] font-semibold text-slate-500 hover:text-slate-700 disabled:opacity-40 inline-flex items-center gap-1 min-h-[36px]">
                <ChevronLeft className="h-3.5 w-3.5" /> Previous item
              </button>
              {onSheet > 0 && (
                <span className="ml-auto text-[11.5px] text-slate-500 tabular-nums">{onSheet} still to count</span>
              )}
              {onSheet === 0 && (
                <button type="button" onClick={() => setPhase('close')}
                  className="ml-auto text-[12px] font-bold text-violet-700 hover:text-violet-900 inline-flex items-center gap-1 min-h-[36px]">
                  Finish <ChevronRight className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* ---------------- Step 3 · Only when it doesn't tally ---------------- */}
      {phase === 'explain' && line && (
        <Card className="p-0 shadow-sm overflow-hidden border-2 border-rose-200">
          <div className="px-4 py-2 bg-rose-600 text-white flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5" />
            <span className="text-[11px] font-bold uppercase tracking-wider">It doesn&apos;t tally</span>
          </div>
          <div className="p-4 space-y-3">
            <div>
              <h3 className="text-[15px] font-extrabold text-slate-900 leading-tight break-words">{line.itemName}</h3>
              <DiffLine line={line} showValues={props.showValues} />
            </div>

            <div>
              <label className={labelCls}>Why?</label>
              <div className="flex flex-wrap gap-1.5">
                {props.reasons.map(r => (
                  <button key={r} type="button" onClick={() => setReason(r)}
                    aria-pressed={reason === r}
                    className={`rounded-full border-2 px-3 py-1.5 min-h-[36px] text-[12px] font-bold transition ${
                      reason === r
                        ? 'border-rose-500 bg-rose-600 text-white'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-rose-300'}`}>
                    {r}
                  </button>
                ))}
              </div>
              {props.reasons.length === 0 && (
                <input className={inputCls} value={reason} onChange={e => setReason(e.target.value)}
                  placeholder="Type the reason" />
              )}
            </div>

            <div>
              <label className={labelCls} htmlFor="diff-remark">Anything to add (optional)</label>
              <input id="diff-remark" className={inputCls} value={remark}
                onChange={e => setRemark(e.target.value)}
                placeholder="Where it went, who to ask, what you saw" />
            </div>

            <div className="grid grid-cols-[auto_1fr] gap-2">
              <button type="button" onClick={() => { setPhase('count'); setEntry(String(line.countedQty ?? '')) }}
                className="rounded-lg border-2 border-slate-200 px-3 py-2.5 min-h-[44px] text-[12.5px] font-bold text-slate-600">
                Recount
              </button>
              <button type="button" onClick={submitReason} disabled={saving}
                className="rounded-lg bg-rose-600 hover:bg-rose-700 px-3 py-2.5 min-h-[44px] text-sm font-bold text-white disabled:opacity-50 inline-flex items-center justify-center gap-1.5">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Save &amp; next <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <p className="text-[11px] text-slate-500">
              Nothing is corrected yet. Stock only changes when this count is approved.
            </p>
          </div>
        </Card>
      )}

      {/* ---------------- Step 4 · Close & submit ---------------- */}
      {phase === 'close' && (
        <Card className="p-0 shadow-sm overflow-hidden">
          <div className="px-4 py-2 bg-slate-800 text-white flex items-center gap-2">
            <ClipboardCheck className="h-3.5 w-3.5" />
            <span className="text-[11px] font-bold uppercase tracking-wider">Close &amp; submit</span>
          </div>
          <div className="p-4 space-y-3">
            <SummaryStrip rows={rows} showValues={props.showValues} />

            {rows.filter(hasDiff).length > 0 && (
              <div className="space-y-1.5">
                <h4 className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                  What does not tally
                </h4>
                {rows.map((l, i) => hasDiff(l) ? (
                  <button key={l.id} type="button" onClick={() => goTo(i, 'explain')}
                    className="w-full text-left rounded-lg border border-slate-200 px-2.5 py-2 hover:border-rose-300 transition">
                    <span className="block text-[12.5px] font-semibold text-slate-800 break-words">{l.itemName}</span>
                    <DiffLine line={l} showValues={props.showValues} />
                    <span className="block text-[11px] text-slate-500 mt-0.5">
                      {l.reason ? <>Reason: <b>{l.reason}</b></> : <b className="text-rose-600">No reason given — tap to add</b>}
                      {l.remark ? ` · ${l.remark}` : ''}
                    </span>
                  </button>
                ) : null)}
              </div>
            )}

            {rows.some(l => l.skipped) && (
              <div className="space-y-1">
                <h4 className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Not counted</h4>
                {rows.map((l, i) => l.skipped ? (
                  <button key={l.id} type="button" onClick={() => goTo(i)}
                    className="w-full text-left text-[12px] text-slate-600 rounded-lg px-2.5 py-1.5 hover:bg-slate-50">
                    <b className="text-slate-800">{l.itemName}</b> — {l.skipReason}
                  </button>
                ) : null)}
              </div>
            )}

            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-700">
              <p>Counted by <b>{props.counterName ?? 'you'}</b></p>
              <p className="mt-0.5">
                Witnessed by{' '}
                {props.witnessName
                  ? <b>{props.witnessName}</b>
                  : <b className="text-rose-600">nobody yet — a count needs a witness</b>}
              </p>
            </div>

            <label className="flex items-start gap-2.5 text-[12.5px] text-slate-700 cursor-pointer">
              <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}
                className="mt-0.5 h-5 w-5 flex-shrink-0 accent-violet-700" />
              <span>
                I counted these quantities myself, with the witness present. I understand the differences above will
                correct stock once approved.
              </span>
            </label>

            {blocker && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[12px] font-semibold text-amber-900">
                {blocker}
              </div>
            )}

            <div className="grid grid-cols-[auto_1fr] gap-2">
              <button type="button" onClick={() => goTo(0)}
                className="rounded-lg border-2 border-slate-200 px-3 py-2.5 min-h-[44px] text-[12.5px] font-bold text-slate-600">
                Back to the sheet
              </button>
              <button type="button" onClick={doSubmit}
                disabled={saving || !props.canEdit || Boolean(blocker) || !confirmed}
                className="rounded-lg bg-slate-800 hover:bg-slate-900 px-3 py-2.5 min-h-[44px] text-sm font-bold text-white disabled:opacity-50 inline-flex items-center justify-center gap-1.5">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Submit for approval
              </button>
            </div>
            {!blocker && !confirmed && (
              <p className="text-[11px] text-slate-500">Tick the confirmation above to submit.</p>
            )}
          </div>
        </Card>
      )}

      {/* The whole sheet, collapsed — the walk is one item at a time on purpose,
          but he needs a way to jump back to something. */}
      {rows.length > 0 && (
        <Card className="p-0 shadow-sm overflow-hidden">
          <button type="button" onClick={() => setShowSheet(v => !v)}
            className="w-full px-4 py-2.5 min-h-[44px] flex items-center gap-2 text-[12.5px] font-bold text-slate-600 hover:bg-slate-50">
            <ListChecks className="h-4 w-4 text-slate-400" />
            The whole sheet ({rows.length})
            <ChevronRight className={`ml-auto h-4 w-4 text-slate-400 transition ${showSheet ? 'rotate-90' : ''}`} />
          </button>
          {showSheet && (
            <div className="border-t border-slate-100 divide-y divide-slate-50">
              {rows.map((l, i) => (
                <button key={l.id} type="button" onClick={() => goTo(i)}
                  className={`w-full text-left px-4 py-2 min-h-[44px] flex items-baseline gap-2 hover:bg-slate-50 ${
                    i === cursor ? 'bg-violet-50/60' : ''}`}>
                  <span className="text-[10px] font-mono text-slate-400 tabular-nums w-6 flex-shrink-0">{i + 1}</span>
                  <span className="flex-1 min-w-0 text-[12.5px] text-slate-700 break-words">{l.itemName}</span>
                  <span className="text-[11.5px] tabular-nums font-semibold flex-shrink-0">
                    {l.skipped
                      ? <span className="text-amber-700">skipped</span>
                      : l.countedQty === null
                        ? <span className="text-slate-400">—</span>
                        : <span className={hasDiff(l) ? 'text-rose-600' : 'text-emerald-700'}>
                            {formatQty(l.countedQty)} {l.unit}
                          </span>}
                  </span>
                </button>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Found something the book does not know about. */}
      {props.canEdit && (
        <Card className="p-4 shadow-sm space-y-2">
          <label className={labelCls} htmlFor="found-item">Found something not on the sheet?</label>
          <SearchableSelect
            id="found-item"
            value={found}
            onChange={setFound}
            options={notOnSheet.map(i => ({ id: i.id, label: i.name, hint: i.unit }))}
            placeholder="Search the item list…"
            emptyText="Nothing matches — add it as a new item below"
          />
          <button type="button" onClick={addFound} disabled={!found || saving}
            className="w-full rounded-lg border-2 border-dashed border-slate-300 py-2 min-h-[44px] text-[12.5px] font-bold text-slate-500 hover:border-violet-300 hover:text-violet-700 disabled:opacity-50 inline-flex items-center justify-center gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Add it to this count
          </button>

          {/* Old material that never came through a PO is often not in the item
              list at all — which is exactly the stock a first count is for.
              Sending him to Settings mid-count, standing in the godown, is how a
              count gets abandoned. */}
          <NewCountItem units={props.units} saving={saving} onCreated={id => setFound(id)} />

          <p className="text-[11px] text-slate-500">
            Material lying in the store that the book has no record of is the missed gate entry this count exists
            to find — and on a first count of an old store, it is <b>all</b> of it.
          </p>
        </Card>
      )}

      {/* Started by mistake? One open count per store, so without this the store
          could never be counted again. */}
      {props.canEdit && (props.iAmTheCounter || props.canApprove) && (
        <button type="button" onClick={doAbandon} disabled={saving}
          className="w-full text-[11.5px] font-semibold text-slate-400 hover:text-rose-600 py-2 min-h-[40px]">
          Discard this count
        </button>
      )}
    </div>
  )
}

// ===========================================================================
// Submitted / approved / rejected — read-only, plus the approval decision.
// ===========================================================================

function ClosedSheet(props: Parameters<typeof CountSheet>[0]) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [reason, setReason] = useState('')
  const [rejecting, setRejecting] = useState(false)

  const rows = props.lines
  const diffs = rows.filter(hasDiff)

  function doApprove() {
    start(async () => {
      const ok = await confirm({
        title: 'Approve this count?',
        message: diffs.length === 0
          ? 'Everything tallied, so nothing in stock will change.'
          : `This will correct stock on ${diffs.length} ${diffs.length === 1 ? 'item' : 'items'} to the counted figures. `
            + 'Each correction is written to the ledger with the reason given.',
        confirmLabel: 'Approve',
        danger: false,
      })
      if (!ok) return
      const res = await approveCount(props.countId)
      if (!res.ok) { toast.error(res.error ?? 'Could not approve this count.'); return }
      toast.success(res.applied ? `Approved — ${res.applied} correction${res.applied === 1 ? '' : 's'} posted.` : 'Approved.')
      router.refresh()
    })
  }

  function doReject() {
    if (!reason.trim()) { toast.error('Say why you are sending it back.'); return }
    start(async () => {
      const res = await rejectCount(props.countId, reason)
      if (!res.ok) { toast.error(res.error ?? 'Could not send this count back.'); return }
      toast.success('Sent back. Nothing in stock has changed.')
      setRejecting(false)
      router.refresh()
    })
  }

  const banner = {
    submitted: { cls: 'border-sky-200 bg-sky-50 text-sky-900', text: 'Waiting for approval. Nothing in stock has moved yet.' },
    approved:  { cls: 'border-emerald-200 bg-emerald-50 text-emerald-900', text: `Approved${props.approverName ? ` by ${props.approverName}` : ''}. Stock now matches this count.` },
    rejected:  { cls: 'border-rose-200 bg-rose-50 text-rose-900', text: `Sent back${props.rejectReason ? `: ${props.rejectReason}` : ''}. Nothing in stock changed — count it again.` },
  }[props.status] ?? { cls: 'border-slate-200 bg-slate-50 text-slate-700', text: props.status }

  return (
    <div className="space-y-3">
      <div className={`rounded-xl border px-3 py-2.5 text-[12.5px] font-semibold ${banner.cls}`}>
        {banner.text}
      </div>

      <Card className="p-4 shadow-sm space-y-3">
        <SummaryStrip rows={rows} showValues={props.showValues} />
        <div className="text-[12px] text-slate-600 pt-1 border-t border-slate-100">
          Counted by <b className="text-slate-800">{props.counterName ?? '—'}</b>
          {' · '}witnessed by <b className="text-slate-800">{props.witnessName ?? '—'}</b>
        </div>
      </Card>

      {diffs.length > 0 && (
        <Card className="p-4 shadow-sm space-y-2">
          <h4 className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
            What did not tally ({diffs.length})
          </h4>
          {diffs.map(l => (
            <div key={l.id} className="rounded-lg border border-slate-200 px-2.5 py-2">
              <span className="block text-[12.5px] font-semibold text-slate-800 break-words">{l.itemName}</span>
              <DiffLine line={l} showValues={props.showValues} />
              <span className="block text-[11px] text-slate-500 mt-0.5">
                Reason: <b>{l.reason ?? '—'}</b>{l.remark ? ` · ${l.remark}` : ''}
              </span>
            </div>
          ))}
        </Card>
      )}

      {rows.some(l => l.skipped) && (
        <Card className="p-4 shadow-sm space-y-1">
          <h4 className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Not counted</h4>
          {rows.filter(l => l.skipped).map(l => (
            <p key={l.id} className="text-[12px] text-slate-600">
              <b className="text-slate-800">{l.itemName}</b> — {l.skipReason}
            </p>
          ))}
          <p className="text-[11px] text-slate-500 pt-1">
            These keep their book quantity. Nothing about them is corrected.
          </p>
        </Card>
      )}

      {props.status === 'submitted' && (
        <Card className="p-4 shadow-sm space-y-2">
          {!props.canApprove && (
            <p className="text-[12px] text-slate-600">
              Only an admin or Atm Head can approve a count. This one is with them.
            </p>
          )}
          {props.canApprove && props.iAmTheCounter && (
            <p className="text-[12px] font-semibold text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2">
              You counted this store yourself, so you cannot approve it — someone else has to. That is the whole point
              of the second signature.
            </p>
          )}
          {props.canApprove && !props.iAmTheCounter && (
            <>
              {!rejecting && (
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setRejecting(true)} disabled={busy}
                    className="rounded-lg border-2 border-slate-200 py-2.5 min-h-[44px] text-[12.5px] font-bold text-slate-600 hover:border-rose-300 hover:text-rose-700">
                    Send back
                  </button>
                  <button type="button" onClick={doApprove} disabled={busy}
                    className="rounded-lg bg-emerald-600 hover:bg-emerald-700 py-2.5 min-h-[44px] text-[12.5px] font-bold text-white disabled:opacity-50 inline-flex items-center justify-center gap-1.5">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    Approve &amp; correct stock
                  </button>
                </div>
              )}
              {rejecting && (
                <div className="space-y-2">
                  <label className={labelCls} htmlFor="reject-reason">Why are you sending it back?</label>
                  <input id="reject-reason" className={inputCls} value={reason} autoFocus
                    onChange={e => setReason(e.target.value)} />
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => setRejecting(false)}
                      className="rounded-lg border-2 border-slate-200 py-2 min-h-[40px] text-[12.5px] font-bold text-slate-600">
                      Cancel
                    </button>
                    <button type="button" onClick={doReject} disabled={busy}
                      className="rounded-lg bg-rose-600 hover:bg-rose-700 py-2 min-h-[40px] text-[12.5px] font-bold text-white disabled:opacity-50">
                      Send it back
                    </button>
                  </div>
                </div>
              )}
              <p className="text-[11px] text-slate-500">
                Approving is the only thing in this module that changes stock without a truck behind it. Every
                correction is written to the ledger against {props.countNo}.
              </p>
            </>
          )}
        </Card>
      )}
    </div>
  )
}

// ===========================================================================

/** Add an item to the master without leaving the count.
 *
 *  Needed most on a first count: material that has sat in a store for years and
 *  never came through a purchase order is not in the item list, because nothing
 *  ever put it there. */
function NewCountItem({
  units, saving, onCreated,
}: { units: string[]; saving: boolean; onCreated: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [unit, setUnit] = useState(units[0] ?? 'Nos')
  const [busy, start] = useTransition()

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="text-[11.5px] font-bold text-slate-500 hover:text-violet-700 min-h-[32px] inline-flex items-center gap-1">
        <Plus className="h-3 w-3" /> It is not on the list at all — add it
      </button>
    )
  }

  return (
    <div className="rounded-lg border-2 border-dashed border-slate-300 p-2 space-y-2">
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <div>
          <label className={labelCls} htmlFor="new-count-item">What is it</label>
          <input id="new-count-item" className={inputCls} value={name} autoFocus
            onChange={e => setName(e.target.value)} placeholder="Name it the way the store calls it" />
        </div>
        <div>
          <label className={labelCls} htmlFor="new-count-unit">Counted in</label>
          <select id="new-count-unit" className={inputCls} value={unit} onChange={e => setUnit(e.target.value)}>
            {(units.length ? units : ['Nos', 'Bag', 'MT', 'Kg']).map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
      </div>
      <p className="text-[11px] text-slate-500">
        The unit locks to the item once stock is recorded against it, so get it right now.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => { setOpen(false); setName('') }}
          className="rounded-lg border-2 border-slate-200 py-2 min-h-[36px] text-[12px] font-bold text-slate-600">
          Cancel
        </button>
        <button type="button" disabled={busy || saving || !name.trim()}
          onClick={() => start(async () => {
            const res = await createItem({ name, unit })
            if (!res.ok) { toast.error(res.error); return }
            toast.success(`Added ${res.name} — now add it to the count`)
            onCreated(res.id)
            setOpen(false); setName('')
          })}
          className="rounded-lg bg-violet-700 hover:bg-violet-800 py-2 min-h-[36px] text-[12px] font-bold text-white disabled:opacity-50 inline-flex items-center justify-center gap-1.5">
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Create item
        </button>
      </div>
    </div>
  )
}

function Stepper({ phase, counted, total }: { phase: Phase; counted: number; total: number }) {
  const steps: Array<{ key: Phase; label: string }> = [
    { key: 'count', label: 'Count' },
    { key: 'explain', label: 'Differences' },
    { key: 'close', label: 'Close' },
  ]
  const at = steps.findIndex(s => s.key === phase)
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        {steps.map((s, i) => (
          <div key={s.key} className="flex-1">
            <div className={`h-1.5 rounded-full ${i <= at ? 'bg-violet-600' : 'bg-slate-200'}`} />
            <span className={`block text-[10px] font-extrabold uppercase tracking-wide mt-1 ${
              i === at ? 'text-violet-700' : 'text-slate-400'}`}>
              {s.label}
            </span>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-slate-500 tabular-nums">{counted} of {total} done</p>
    </div>
  )
}

/** "Book 320 · you counted 291 · short 29 ≈ ₹11,368" — the one line that makes
 *  a difference mean something. */
function DiffLine({ line, showValues }: { line: CountLine; showValues: boolean }) {
  const d = diffOf(line)
  const short = d < 0
  const value = line.rate ? Math.abs(d) * line.rate : null
  return (
    <span className="block text-[12px] text-slate-600 tabular-nums mt-0.5">
      Book <b className="text-slate-800">{formatQty(line.bookQty)}</b>
      {' · you counted '}
      <b className="text-slate-800">{formatQty(line.countedQty)}</b>
      {' · '}
      <b className={short ? 'text-rose-600' : 'text-emerald-700'}>
        {short ? 'short' : 'extra'} {formatQty(Math.abs(d))} {line.unit}
      </b>
      {showValues && value !== null && (
        <span className={short ? 'text-rose-600' : 'text-emerald-700'}> ≈ {formatINR(value)}</span>
      )}
    </span>
  )
}

function SummaryStrip({ rows, showValues }: { rows: CountLine[]; showValues: boolean }) {
  const s = summarize(rows)
  const cells = [
    { n: s.counted, l: 'counted', cls: 'text-slate-800' },
    { n: s.tallied, l: 'tallied', cls: 'text-emerald-700' },
    { n: s.shortLines, l: 'short', cls: s.shortLines ? 'text-rose-600' : 'text-slate-400' },
    { n: s.excessLines, l: 'extra', cls: s.excessLines ? 'text-sky-700' : 'text-slate-400' },
    { n: s.skipped, l: 'skipped', cls: s.skipped ? 'text-amber-700' : 'text-slate-400' },
  ]
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-5 gap-1.5">
        {cells.map(c => (
          <div key={c.l} className="rounded-lg bg-slate-50 border border-slate-100 px-1 py-2 text-center">
            <div className={`text-base font-extrabold tabular-nums ${c.cls}`}>{c.n}</div>
            <div className="text-[9.5px] font-bold uppercase tracking-wide text-slate-500">{c.l}</div>
          </div>
        ))}
      </div>
      {(s.shortQty > 0 || s.excessQty > 0) && (
        <p className="text-[12px] text-slate-600">
          {s.shortQty > 0 && (
            <>Short by <b className="text-rose-600 tabular-nums">{formatQty(s.shortQty)}</b>
              {showValues && s.shortValue > 0 && <> ≈ <b className="text-rose-600">{formatINR(s.shortValue)}</b></>}
            </>
          )}
          {s.shortQty > 0 && s.excessQty > 0 && ' · '}
          {s.excessQty > 0 && (
            <>Extra <b className="text-sky-700 tabular-nums">{formatQty(s.excessQty)}</b>
              {showValues && s.excessValue > 0 && <> ≈ <b className="text-sky-700">{formatINR(s.excessValue)}</b></>}
            </>
          )}
          {showValues && s.valuePartial && (
            <span className="block text-[11px] text-slate-500 mt-0.5">
              The ₹ figure covers only the items with a known rate, so it understates.
            </span>
          )}
        </p>
      )}
    </div>
  )
}
