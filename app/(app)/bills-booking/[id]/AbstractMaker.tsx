'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Check, ChevronDown, Loader2, Plus, Ruler, X } from 'lucide-react'
import { priceAbstract, DEDUCTION_LABELS, type Deduction, type DeductionKind, type MakerLine, type RatePick } from '@/lib/bills-booking/maker'
import { formatINR, formatINRCompact, formatNumber, formatDate } from '@/lib/utils'
import { Particular, ExpandAll } from './Particular'
import { shortenBoq } from '@/lib/bills-booking/shorten'
import type { EarlierBill } from '@/lib/bills-booking/abstract'

/** The Abstract Sheet, filled in CT Hub.
 *
 *  Aksha, 14 Sep 2026: "make the Abstract maker in CT Hub … it should be in
 *  screenshot format" — the concept sheet from the design phase, kept to the
 *  letter: four column groups (Work Order · This bill · Cumulative · Balance),
 *  one row per BOQ item, and ONE typed number per row.
 *
 *  Everything else computes as you type: This Amt, the cumulative, the
 *  balance, GST, retention and the green Net Payable line. The rate is never
 *  editable — it is what the work order ordered, and a rate somebody can
 *  retype is a rate that ends up wrong. */
export function AbstractMaker({ billId, woNo, vendor, work, seed, gst: gstPick, retention: retPick, canEdit, canEditDeductions = false, retentionAmt = null, deductions: dedSeed = [], in4Net = null, raLabel, ownSheet, in4Total, source = 'ct', sourceNote, earlierBills = [], kind = 'WO', invoiceTotal = null, in4ReceiptValue = null }: {
  billId: string
  woNo: string
  /** Work order or purchase order — only the labels change. Aksha, 9 Oct
   *  2026: "dont make new formats": a supplier bill's goods receipt renders
   *  in this same sheet, lines at PO rates, same totals ladder. */
  kind?: 'WO' | 'PO'
  /** The supplier's invoice as entered on the bill (a receipt not yet
   *  certified). Compared with the sheet's Net Payable in one line. */
  invoiceTotal?: number | null
  /** What IN4 values the receipt at (tax and order charges spread across the
   *  lines) — named in that line so the reader knows where each figure is from. */
  in4ReceiptValue?: number | null
  vendor: string
  work: string | null
  seed: MakerLine[]
  gst: RatePick
  retention: RatePick
  canEdit: boolean
  /** The deductions block (retention as ₹ or %, advance recovery, other
   *  recovery, debits) is typed at the CT Disc Head and CT Head desks —
   *  Aksha, 7 Oct 2026 — even when the quantities are IN4's and read-only. */
  canEditDeductions?: boolean
  /** Retention typed as rupees on this bill, when somebody did. */
  retentionAmt?: number | null
  deductions?: Deduction[]
  /** What IN4's certificate says is payable on this bill, once it exists, so
   *  the sheet can say whether its own net agrees. */
  in4Net?: number | null
  /** "RA-4", for the strip along the top. */
  raLabel: string
  /** True once CT Hub holds lines of its own for this bill. */
  ownSheet: boolean
  /** Who measured what is on screen.  means the Site Head did it in IN4
   *  and this is a read-back — same format, same arithmetic, different author.
   *  Aksha, 15 Sep 2026: "why is the Abstract sheet is coming like this and not
   *  like the screenshot". Because there used to be a second, plainer table for
   *  this case. There is one format now. */
  source?: 'ct' | 'in4'
  /** One line under the masthead naming the IN4 document and whether Billing
   *  has certified it yet. Composed by the page, which is what knows. */
  sourceNote?: string | null
  /** The earlier bills on this order, oldest first — one column each.
   *
   *  Aksha, 15 Sep 2026: "all RA bills should show not only previous Bill
   *  total". A lump tells you how much came before but not which bill it came
   *  on, and on a running account that is the thing being checked: whether
   *  this bill is re-measuring what an earlier one already claimed.
   *
   *  The RA numbers are the register's own — see EarlierBill — so a column
   *  headed RA-4 is the bill the "Bills on …" panel calls RA-4. */
  earlierBills?: EarlierBill[]
  /** What IN4's own abstract for this bill totals, when it has one. Shown as a
   *  single reconciling line — NOT as a second table, which is what confused
   *  Aksha: two panels, both titled "Abstract sheet". */
  in4Total: number | null
}) {
  const router = useRouter()
  const supabase = createClient()
  const [busy, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)
  const [gst, setGst] = useState(String(gstPick.pct))
  const [ret, setRet] = useState(String(retPick.pct))
  // Retention as rupees or as a rate; deductions as typed rows. Values are kept
  // as strings while typing so a half-typed "12." does not snap to 12.
  const [retMode, setRetMode] = useState<'pct' | 'amt'>(retentionAmt != null ? 'amt' : 'pct')
  const [retAmt, setRetAmt] = useState(retentionAmt != null ? String(retentionAmt) : '')
  type DedDraft = { kind: DeductionKind; mode: 'pct' | 'amt'; value: string; note: string }
  const [deds, setDeds] = useState<DedDraft[]>(
    () => dedSeed.map(d => ({ kind: d.kind, mode: d.mode, value: String(d.value), note: d.note ?? '' })))
  const [qty, setQty] = useState<Record<number, string>>(
    () => Object.fromEntries(seed.map(l => [l.sr, l.thisQty ? String(l.thisQty) : ''])))

  const lines: MakerLine[] = useMemo(
    () => seed.map(l => ({ ...l, thisQty: Number(qty[l.sr]) || 0 })), [seed, qty])

  const typedDeds: Deduction[] = useMemo(
    () => deds.map(d => ({ kind: d.kind, mode: d.mode, value: Number(d.value) || 0, note: d.note.trim() || null })),
    [deds])
  const sheet = useMemo(
    () => priceAbstract(lines, {
      gstPct: Number(gst) || 0, retentionPct: Number(ret) || 0,
      retentionAmt: retMode === 'amt' ? (Number(retAmt) || 0) : null,
      deductions: typedDeds,
    }),
    [lines, gst, ret, retMode, retAmt, typedDeds])
  // Rates and quantities follow the sheet's own edit right; the deductions
  // block has its own, so an IN4 sheet can still carry them.
  const canEditRates = canEdit || canEditDeductions

  const touched = sheet.lines.filter(l => l.thisQty !== 0).length
  // How many rows actually hide something, for the Show-full-text control.
  const [expandAll, setExpandAll] = useState(false)
  // Aksha, 15 Sep 2026: "make it last 3 RA bills and older roll into Earlier
  // but expandable when requuired." Nineteen columns do not fit a laptop, and
  // the bills that matter when checking a measurement are the recent ones —
  // what RA-1 did eighteen months ago is history, not a comparison. So the
  // last three stand on their own and everything older becomes one Earlier
  // column, one click from being opened out again.
  // Aksha, 15 Sep 2026: "keep the RA 1 2 3 4 5 etc collapsable should show -
  // it makes it easy view also whenever i want i can see."
  //
  // The control was a text link at the tail of a long legend line, and it only
  // appeared on orders with more than three earlier bills — so on most bills
  // there was nothing to click and the folding looked like it did not exist.
  // It is a button now, it is on every order that has any earlier bill, and the
  // folded column itself opens when clicked.
  //
  //   auto    the last three stand alone, anything older folds  (the default)
  //   all     every RA bill as its own column
  //   folded  every earlier bill in one column — the narrowest read
  const [view, setView] = useState<'auto' | 'all' | 'folded'>('auto')
  const KEEP = 3
  let rolled = view === 'all' ? 0
    : view === 'folded' ? earlierBills.length
      : Math.max(0, earlierBills.length - KEEP)
  // Never fold half a shared sheet. Where IN4 filed one abstract against RA-1,
  // RA-2 and RA-3 its quantity is written once, against the first of them, so
  // splitting the three across the fold would leave the figure hiding inside
  // "Earlier" and RA-3 reading as nothing. The boundary moves instead.
  while (rolled > 0 && rolled < earlierBills.length
         && earlierBills[rolled].group === earlierBills[rolled - 1].group) rolled++
  // Kept with their ORIGINAL position, so the label stays RA-4 and not RA-1 —
  // renumbering them would make the legend lie.
  const shownBills = earlierBills.map((b, i) => ({ ...b, i })).slice(rolled)
  const unmeasured = earlierBills.filter(b => !b.measured).length
  // Every bill keeps its own heading. Consecutive bills answered by ONE
  // abstract share one cell beneath them, because IN4 holds one quantity for
  // the lot and there is no honest way to split it three ways.
  const cells = shownBills.reduce<Array<{ i: number; span: number; idx: number[] }>>((acc, b) => {
    const last = acc[acc.length - 1]
    if (last && earlierBills[last.i].group === b.group) { last.span++; last.idx.push(b.i) }
    else acc.push({ i: b.i, span: 1, idx: [b.i] })
    return acc
  }, [])
  const shared = cells.filter(cl => cl.span > 1)
  const prevCols = (rolled > 0 ? 1 : 0) + Math.max(shownBills.length, earlierBills.length === 0 ? 1 : 0)
  const hidden = useMemo(() => seed.filter(l => shortenBoq(l.particular).shortened).length, [seed])

  const dedPayload = typedDeds.filter(d => d.value > 0).map(d => ({ kind: d.kind, mode: d.mode, value: d.value, note: d.note }))
  const retAmtPayload = retMode === 'amt' ? (Number(retAmt) || 0) : null

  function save() {
    setErr(null)
    start(async () => {
      // The sheet's own lines save with everything; an IN4 sheet saves only the
      // money block, through the desk-gated function.
      const { error } = canEdit
        ? await supabase.rpc('bb_rpc_save_abstract', {
            p_bill: billId,
            p_gst: Number(gst) || 0,
            p_retention: Number(ret) || 0,
            p_lines: sheet.lines.map(l => ({
              item_id: l.itemId, sr: l.sr, particular: l.particular, uom: l.uom,
              ordered_qty: l.orderedQty, rate: l.rate, ordered_amt: l.orderedAmt,
              prior_qty: l.priorQty, prior_amt: l.priorAmt, this_qty: l.thisQty,
            })),
            p_retention_amt: retAmtPayload,
            p_deductions: dedPayload,
          })
        : await supabase.rpc('bb_rpc_save_deductions', {
            p_bill: billId,
            p_gst: Number(gst) || 0,
            p_retention_pct: Number(ret) || 0,
            p_retention_amt: retAmtPayload,
            p_deductions: dedPayload,
          })
      if (error) { setErr(error.message); return }
      toast.success(canEdit
        ? `Abstract saved — ${touched} ${touched === 1 ? 'item' : 'items'}, net payable ${formatINR(sheet.netThisBill)}`
        : `Deductions saved — net payable ${formatINR(sheet.netThisBill)}`)
      router.refresh()
    })
  }

  function addDed() {
    setDeds(d => [...d, { kind: d.some(x => x.kind === 'advance') ? 'recovery' : 'advance', mode: 'pct', value: '', note: '' }])
  }
  function setDed(i: number, patch: Partial<DedDraft>) {
    setDeds(d => d.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  }
  const num = (s: string) => s.replace(/[^\d.]/g, '')

  const q3 = (v: number) => Math.round(v * 1000) / 1000
  const n = (v: number) => (v === 0 ? '—' : formatNumber(v, v % 1 === 0 ? 0 : 2))
  const m = (v: number) => (v === 0 ? '—' : formatINR(v))
  // Line amounts compact so all four column groups fit a laptop without a
  // sideways scroll; the totals below stay in full rupees, because that is the
  // figure being approved.
  const mc = (v: number) => (v === 0 ? '—' : formatINRCompact(v))

  return (
    <Card className="overflow-hidden p-0">
      {/* Masthead, as on the concept sheet */}
      <div className="flex flex-wrap items-center gap-3 bg-slate-800 px-4 py-3 text-white">
        <Ruler className="h-4 w-4 shrink-0 text-amber-300" />
        <div>
          <h2 className="text-[15px] font-bold leading-tight">{kind === 'PO' ? 'Abstract Sheet — Supplier Bill' : 'Abstract Sheet — RA Bill'}</h2>
          <p className="text-[11px] text-slate-300">
            {source === 'in4'
              ? (kind === 'PO' ? 'Goods received in IN4 at the gate — read back here at PO rates' : 'Measured in IN4 by the Site Head — read back here')
              : ownSheet ? 'Measured in CT Hub'
                : canEdit ? 'Not measured yet — type This Qty against each line' : 'Not measured yet'}
          </p>
        </div>
        {sourceNote && (
          <span className="w-full text-[11px] text-slate-300 sm:w-auto">{sourceNote}</span>
        )}
        <span className="ml-auto rounded-md bg-amber-300 px-2.5 py-0.5 text-[11px] font-extrabold text-slate-900">
          {raLabel} · {woNo}
        </span>
      </div>

      {earlierBills.length > 0 && (
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-gray-100 bg-amber-50/40 px-4 py-1.5 text-[11px] text-gray-600">
          <b className="text-gray-800">Earlier bills on this order:</b>
          <span className="min-w-0 flex-1">
            {earlierBills.map((b, i) => (
              <span key={i} className={i < rolled ? 'text-gray-400' : undefined}>
                {i > 0 && '  ·  '}
                <b>{b.label ?? 'Abstract'}</b> {b.billNo ?? '—'}{b.on ? ` (${formatDate(b.on)})` : ''}
                {!b.measured && <span className="text-gray-400"> · no sheet</span>}
              </span>
            ))}
          </span>
          <button type="button"
                  onClick={() => setView(rolled > 0 ? 'all' : 'folded')}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-300 bg-white px-2 py-1 text-[11px] font-semibold text-amber-900 hover:bg-amber-50 min-h-[28px]">
            <ChevronDown className={`h-3 w-3 transition-transform ${rolled > 0 ? '' : 'rotate-180'}`} />
            {/* Never a dead click: the button offers whichever of the two the
                sheet is not already showing. */}
            {rolled > 0
              ? `Show all ${earlierBills.length} ${earlierBills.length === 1 ? 'bill' : 'bills'}`
              : 'Fold earlier bills'}
          </button>
        </div>
      )}
      {shared.length > 0 && (
        <p className="border-b border-gray-100 bg-amber-50/70 px-4 py-1.5 text-[11px] text-amber-900">
          <b>IN4 holds one measurement sheet for {shared.map(cl =>
            cl.idx.map(i => earlierBills[i].label ?? 'an abstract').join(', ')).join('; and for ')}.</b>{' '}
          Each bill keeps its own column, and that one measured quantity is drawn across them — IN4 has no
          per-bill figure to split it into, and the money on each is on the bills panel below.
        </p>
      )}
      {unmeasured > 0 && (
        <p className="border-b border-gray-100 bg-amber-50/70 px-4 py-1.5 text-[11px] text-amber-900">
          <b>{unmeasured} of these {unmeasured === 1 ? 'bills has' : 'bills have'} no measurement sheet in IN4.</b>{' '}
          {unmeasured === 1 ? 'Its' : 'Their'} column is blank and {unmeasured === 1 ? 'its' : 'their'} quantity is
          not in Prev Amt or Cum Qty — the money on {unmeasured === 1 ? 'that bill' : 'those bills'} is on the
          bills panel below, the measurement was never abstracted.
        </p>
      )}
      <div className="flex items-center justify-end border-b border-gray-100 px-4 py-1.5">
        <ExpandAll on={expandAll} onToggle={() => setExpandAll(v => !v)} n={hidden} />
      </div>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 border-b border-gray-200 px-4 py-3 text-[13px] sm:grid-cols-2">
        <div><dt className="inline w-16 font-semibold text-gray-500">Vendor </dt><dd className="inline">{vendor}</dd></div>
        <div><dt className="inline w-16 font-semibold text-gray-500">{kind} No </dt><dd className="inline font-mono text-xs">{woNo}</dd></div>
        {work && <div className="sm:col-span-2"><dt className="inline w-16 font-semibold text-gray-500">Work </dt><dd className="inline">{work}</dd></div>}
      </dl>

      {err && <p role="alert" className="mx-4 mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</p>}

      <div className="overflow-x-auto px-2 pt-2">
        <table style={{ minWidth: 1020 + (prevCols - 1) * 54 }} className="w-full border-collapse text-[11.5px]">
          <thead>
            <tr>
              <Th l>#</Th><Th l>Particular</Th><Th>Qty</Th><Th>Unit</Th><Th>Rate</Th>
              <Th g="wo">{kind} Amt</Th>
              {rolled > 0 && (
                <Th g="prev">
                  <button type="button" onClick={() => setView('all')}
                          title={`Open: ${earlierBills.slice(0, rolled).map(b => `${b.label ?? 'Abstract'} ${b.billNo ?? ''}`).join(' · ')}`}
                          className="inline-flex items-center gap-0.5 font-bold uppercase tracking-wide text-amber-900 hover:text-indigo-700">
                    Earlier ({rolled})
                    <ChevronDown className="h-2.5 w-2.5 -rotate-90" />
                  </button>
                </Th>
              )}
              {shownBills.map(b => (
                <Th key={b.i} g="prev">
                  {/* A bill with no abstract in IN4 still gets its column — it
                      is on the register and part of the running account — but
                      greyed, so an empty cell reads as "never measured" rather
                      than "measured as nothing". */}
                  <span className={b.measured ? undefined : 'font-normal text-amber-700/60'}
                        title={`${b.billNo ?? 'earlier bill'}${b.on ? ` · ${formatDate(b.on)}` : ''}${b.measured ? '' : ' — no measurement sheet in IN4'}`}>
                    {b.label ?? 'Abs'}
                  </span>
                </Th>
              ))}
              {earlierBills.length === 0 && <Th g="prev">Prev Qty</Th>}
              <Th g="prev">Prev Amt</Th>
              <Th g="this">This Qty</Th><Th g="this">This Amt</Th>
              <Th g="cum">Cum Qty</Th><Th g="cum">Cum Amt</Th>
              <Th g="bal">Bal Qty</Th><Th g="bal">Bal Amt</Th>
            </tr>
          </thead>
          <tbody>
            {sheet.lines.map(l => (
              <tr key={l.sr} className={l.overrun ? 'bg-rose-50' : 'hover:bg-gray-50/60'}>
                <Td l>{l.sr}</Td>
                <Td l className="max-w-[220px] whitespace-normal align-top">
                  <Particular text={l.particular} expandAll={expandAll} />
                </Td>
                <Td>{n(l.orderedQty)}</Td>
                <Td>{l.uom ?? '—'}</Td>
                <Td>{m(l.rate)}</Td>
                <Td g="wo">{mc(l.orderedAmt)}</Td>
                {rolled > 0 && (
                  <Td g="prev" className="text-gray-500">
                    {n(q3((l.history ?? []).slice(0, rolled).reduce((a, b) => a + b, 0)))}
                  </Td>
                )}
                {cells.map(cl => (
                  <Td key={cl.i} g="prev" colSpan={cl.span} centre={cl.span > 1}
                      className={cl.span > 1 ? 'bg-amber-100/70 text-gray-700' : 'text-gray-600'}
                      title={cl.span > 1
                        ? `One measurement sheet in IN4 for ${cl.idx.map(i => earlierBills[i].label ?? '').join(', ')} — no per-bill quantity exists`
                        : undefined}>
                    {n(q3(cl.idx.reduce((a, i) => a + (l.history?.[i] ?? 0), 0)))}
                  </Td>
                ))}
                {earlierBills.length === 0 && <Td g="prev">{n(l.priorQty)}</Td>}
                <Td g="prev">{mc(l.priorAmt)}</Td>
                <Td g="this">
                  {canEdit ? (
                    <input
                      inputMode="decimal"
                      value={qty[l.sr] ?? ''}
                      onChange={e => setQty(q => ({ ...q, [l.sr]: e.target.value.replace(/[^\d.]/g, '') }))}
                      placeholder="0"
                      aria-label={`Quantity this bill for ${l.particular}`}
                      className="w-[72px] rounded-md border border-slate-300 bg-amber-50/60 px-1.5 py-1 text-right tabular-nums focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  ) : n(l.thisQty)}
                </Td>
                <Td g="this" className="font-semibold">{mc(l.thisAmt)}</Td>
                <Td g="cum">{n(l.cumQty)}</Td>
                <Td g="cum">{mc(l.cumAmt)}</Td>
                <Td g="bal" className={l.overrun ? 'font-semibold text-rose-700' : l.complete ? 'text-emerald-700' : ''}>
                  {l.overrun ? `over ${n(Math.abs(l.balQty))}` : l.complete ? 'done' : n(l.balQty)}
                </Td>
                <Td g="bal">{mc(l.balAmt)}</Td>
              </tr>
            ))}
          </tbody>

          <tbody>
            {sheet.totals.map(t => {
              const less = t.kind === 'retention' || t.kind === 'deduction'
              const isDed = t.kind === 'deduction'
              const d = isDed && t.dedIndex != null ? deds[t.dedIndex] : null
              return (
              <tr key={isDed ? `ded-${t.dedIndex}` : t.kind} className={
                t.kind === 'net' ? 'bg-emerald-700 font-bold text-white'
                  : less ? 'bg-rose-50 font-bold text-rose-900'
                    : t.kind === 'gst' ? 'bg-amber-50 font-bold' : 'bg-slate-50 font-bold'}>
                <td className="border border-gray-100 px-2 py-1.5 text-left" colSpan={6}>
                  {t.kind === 'gst' && (
                    canEditRates
                      ? <>{t.label} @ <input inputMode="decimal" value={gst}
                              onChange={e => setGst(num(e.target.value))}
                              aria-label="GST percentage"
                              className="w-[46px] rounded border border-slate-300 bg-white px-1 py-0.5 text-right text-[11px] tabular-nums text-gray-900" />%</>
                      : <>{t.label} @ {t.rate}%</>
                  )}
                  {t.kind === 'retention' && (
                    canEditRates ? (
                      <span className="inline-flex flex-wrap items-center gap-1.5">
                        {t.label}
                        <ModeToggle mode={retMode} onChange={setRetMode} label="retention" />
                        {retMode === 'pct'
                          ? <>@ <input inputMode="decimal" value={ret} onChange={e => setRet(num(e.target.value))}
                                  aria-label="Retention percentage"
                                  className="w-[46px] rounded border border-slate-300 bg-white px-1 py-0.5 text-right text-[11px] tabular-nums text-gray-900" />%</>
                          : <>₹ <input inputMode="decimal" value={retAmt} onChange={e => setRetAmt(num(e.target.value))}
                                  aria-label="Retention amount" placeholder="0"
                                  className="w-[90px] rounded border border-slate-300 bg-white px-1 py-0.5 text-right text-[11px] tabular-nums text-gray-900" /></>}
                      </span>
                    ) : (
                      <>{t.label}{t.mode === 'amt' ? ' (typed)' : ` @ ${t.rate}%`}</>
                    )
                  )}
                  {isDed && d && (
                    canEditDeductions ? (
                      <span className="inline-flex flex-wrap items-center gap-1.5 font-semibold">
                        <select value={d.kind} onChange={e => setDed(t.dedIndex!, { kind: e.target.value as DeductionKind })}
                                aria-label="Deduction type"
                                className="rounded border border-slate-300 bg-white px-1 py-0.5 text-[11px] text-gray-900">
                          {(Object.keys(DEDUCTION_LABELS) as DeductionKind[]).map(k => <option key={k} value={k}>{DEDUCTION_LABELS[k]}</option>)}
                        </select>
                        <ModeToggle mode={d.mode} onChange={mode => setDed(t.dedIndex!, { mode })} label={DEDUCTION_LABELS[d.kind]} />
                        {d.mode === 'pct'
                          ? <>@ <input inputMode="decimal" value={d.value} onChange={e => setDed(t.dedIndex!, { value: num(e.target.value) })}
                                  aria-label={`${DEDUCTION_LABELS[d.kind]} percentage`} placeholder="0"
                                  className="w-[46px] rounded border border-slate-300 bg-white px-1 py-0.5 text-right text-[11px] tabular-nums text-gray-900" />%</>
                          : <>₹ <input inputMode="decimal" value={d.value} onChange={e => setDed(t.dedIndex!, { value: num(e.target.value) })}
                                  aria-label={`${DEDUCTION_LABELS[d.kind]} amount`} placeholder="0"
                                  className="w-[90px] rounded border border-slate-300 bg-white px-1 py-0.5 text-right text-[11px] tabular-nums text-gray-900" /></>}
                        <input value={d.note} onChange={e => setDed(t.dedIndex!, { note: e.target.value })}
                               aria-label="Reason" placeholder="reason (e.g. water charges)"
                               className="w-[150px] rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] font-normal text-gray-900" />
                        <button type="button" onClick={() => setDeds(x => x.filter((_, j) => j !== t.dedIndex))}
                                aria-label={`Remove ${DEDUCTION_LABELS[d.kind]}`}
                                className="inline-flex h-6 w-6 items-center justify-center rounded text-rose-700 hover:bg-rose-100">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    ) : (
                      <>{t.label}{t.mode === 'pct' ? ` @ ${t.rate}%` : ''}{t.note ? <span className="font-normal text-rose-800/80"> — {t.note}</span> : null}</>
                    )
                  )}
                  {(t.kind === 'sub' || t.kind === 'total' || t.kind === 'net') && t.label}
                </td>
                <td className={`border border-gray-100 px-2 py-1.5 text-right tabular-nums ${t.kind === 'net' ? 'text-emerald-50' : 'text-gray-500'}`} colSpan={Math.max(prevCols, 1) + 1}>
                  {less && t.previous > 0 ? '− ' : ''}{isDed ? '' : m(t.previous)}
                </td>
                <td className="border border-gray-100 px-2 py-1.5 text-right tabular-nums" colSpan={2}>
                  {less && t.thisBill > 0 ? '− ' : ''}{m(t.thisBill)}
                </td>
                <td className="border border-gray-100 px-2 py-1.5 text-right tabular-nums" colSpan={2}>
                  {less && t.cumulative > 0 ? '− ' : ''}{isDed ? '' : m(t.cumulative)}
                </td>
                <td className="border border-gray-100 px-2 py-1.5 text-right tabular-nums" colSpan={2}>{isDed ? '' : m(t.balance)}</td>
              </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {canEditDeductions && (
        <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 bg-rose-50/40 px-4 py-2 text-[11.5px] text-rose-900">
          <button type="button" onClick={addDed}
                  className="inline-flex min-h-[32px] items-center gap-1 rounded-md border border-rose-300 bg-white px-2.5 py-1 text-[11.5px] font-semibold text-rose-900 hover:bg-rose-50">
            <Plus className="h-3.5 w-3.5" /> Add deduction
          </button>
          <span>Advance recovery, other recovery or a debit — as a % of the Sub Total or as an amount. Retention can be typed as an amount too.</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-gray-200 px-4 py-3">
        <Chip k="This bill — net payable" v={formatINR(sheet.netThisBill)} tone="green" />
        {sheet.deductionsThisBill > 0 && <Chip k="Deductions this bill" v={formatINR(sheet.deductionsThisBill)} tone="red" />}
        <Chip k="Cumulative billed" v={formatINR(sheet.totals[2].cumulative)} />
        <Chip k="Retention held (running)" v={formatINR(sheet.totals[3].cumulative)} tone="red" />
        {(canEdit || canEditDeductions) && (
          <Button onClick={save} disabled={busy} className="ml-auto bg-indigo-600 hover:bg-indigo-700">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {canEdit ? 'Save abstract' : 'Save deductions'}
          </Button>
        )}
      </div>

      {invoiceTotal != null && invoiceTotal > 0 && Math.abs(invoiceTotal - sheet.netThisBill) > 2 && (
        <p className="border-t border-amber-200 bg-amber-50 px-4 py-2 text-[11.5px] text-amber-900">
          <b>Invoice as entered {formatINR(invoiceTotal)} · this sheet&apos;s net {formatINR(sheet.netThisBill)} · {formatINR(Math.abs(invoiceTotal - sheet.netThisBill))} {invoiceTotal > sheet.netThisBill ? 'more on the invoice' : 'less on the invoice'}.</b>{' '}
          The goods above are at PO rates; the difference is tax at another rate, or a charge on the invoice that is not a line here (freight, courier, packing).
          {in4ReceiptValue != null && <> IN4 values the receipt at {formatINR(in4ReceiptValue)}, with the order&apos;s tax and other charges spread across the lines.</>}
        </p>
      )}
      {invoiceTotal != null && invoiceTotal > 0 && Math.abs(invoiceTotal - sheet.netThisBill) <= 2 && (
        <p className="border-t border-emerald-200 bg-emerald-50 px-4 py-2 text-[11.5px] text-emerald-800">
          Invoice as entered agrees with this sheet&apos;s net, to the rupee.
        </p>
      )}
      {in4Net != null && Math.abs(in4Net - sheet.netThisBill) > 2 && (
        <p className="border-t border-amber-200 bg-amber-50 px-4 py-2 text-[11.5px] text-amber-900">
          <b>IN4&apos;s certificate pays {formatINR(in4Net)} on this bill; this sheet&apos;s net is {formatINR(sheet.netThisBill)}</b> —
          {' '}{formatINR(Math.abs(in4Net - sheet.netThisBill))} apart. The difference is a retention or deduction IN4 applied that is not on this sheet, or the other way round. Settle it here so every desk approves the figure Billing will enter.
        </p>
      )}
      {in4Net != null && Math.abs(in4Net - sheet.netThisBill) <= 2 && (
        <p className="border-t border-emerald-200 bg-emerald-50 px-4 py-2 text-[11.5px] text-emerald-800">
          Net payable agrees with IN4&apos;s certificate for this bill, to the rupee.
        </p>
      )}

      {in4Total != null && ownSheet && Math.abs(in4Total - sheet.basicThisBill) > 2 && (
        <p className="border-t border-amber-200 bg-amber-50 px-4 py-2 text-[11.5px] text-amber-900">
          <b>IN4 measured this bill differently.</b> Its own abstract totals {formatINR(in4Total)} against
          the {formatINR(sheet.basicThisBill)} above — a difference of {formatINR(Math.abs(in4Total - sheet.basicThisBill))}.
          Worth settling before the bill moves on.
        </p>
      )}
      {in4Total != null && ownSheet && Math.abs(in4Total - sheet.basicThisBill) <= 2 && (
        <p className="border-t border-emerald-200 bg-emerald-50 px-4 py-2 text-[11.5px] text-emerald-800">
          Agrees with IN4 own abstract for this bill, to the rupee.
        </p>
      )}

      <RateNote label="GST" pick={gstPick} />
      <RateNote label="Retention" pick={retPick} />

      {sheet.anyOverrun && (
        <p className="border-t border-rose-200 bg-rose-50 px-4 py-2.5 text-xs text-rose-800">
          Lines marked <b>over</b> are measured past the quantity ordered. That needs an amendment in IN4 before
          payment — it does not stop the sheet being saved or the bill being checked.
        </p>
      )}

      <p className="px-4 pb-4 pt-2 text-[11.5px] text-gray-500">
        You type only <b>This Qty</b>, and at the Disc Head and CT Head desks the <b>deductions</b>. This Amt, Cumulative, Balance, GST, Retention and Net Payable all compute.
        The rate is what the work order ordered and is not editable here. Saving writes the figures onto the bill and
        leaves a line in its history.
      </p>
    </Card>
  )
}

/** "% | ₹" — which way a retention or deduction is given. */
function ModeToggle({ mode, onChange, label }: { mode: 'pct' | 'amt'; onChange: (m: 'pct' | 'amt') => void; label: string }) {
  const btn = (m: 'pct' | 'amt', text: string) => (
    <button type="button" onClick={() => onChange(m)} aria-pressed={mode === m} aria-label={`${label} as ${m === 'pct' ? 'a percentage' : 'an amount'}`}
            className={`px-1.5 py-0.5 text-[10.5px] font-bold ${mode === m ? 'bg-slate-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'}`}>
      {text}
    </button>
  )
  return (
    <span className="inline-flex overflow-hidden rounded border border-slate-300">
      {btn('pct', '%')}{btn('amt', '₹')}
    </span>
  )
}

/** Where the rate came from — so a default reads as a default, and a
 *  disagreement reads as a decision.
 *
 *  This exists because the sheet used to open on a BLENDED average and simply
 *  assert it: "GST @ 14.4%" on an order whose bills carry 0% or 18%. A rate
 *  that cannot say where it came from is a rate nobody can check. */
function RateNote({ label, pick }: { label: string; pick: RatePick }) {
  if (pick.basis === 'default') {
    return (
      <p className="border-t border-amber-200 bg-amber-50 px-4 py-2 text-[11.5px] text-amber-900">
        <b>{label} @ {pick.pct}% is a fallback, not this order&apos;s rate.</b>{' '}
        {pick.total === 0
          ? 'This order has no bills yet to read one from.'
          : 'None of its bills gave a rate that divides cleanly.'} Check it before saving.
      </p>
    )
  }
  if (pick.others.length) {
    return (
      <p className="border-t border-amber-200 bg-amber-50 px-4 py-2 text-[11.5px] text-amber-900">
        <b>{label}: this order&apos;s bills disagree.</b> {pick.pct}% on the latest
        ({pick.seen} of {pick.total}); {pick.others.map(o => `${o}%`).join(', ')} on the rest.
        Set the one that applies to this bill.
      </p>
    )
  }
  return (
    <p className="border-t border-gray-100 px-4 py-1.5 text-[11.5px] text-gray-500">
      {label} @ {pick.pct}% — as on all {pick.total} of this order&apos;s bills.
    </p>
  )
}

function Th({ children, l, g }: { children: React.ReactNode; l?: boolean; g?: 'wo' | 'prev' | 'this' | 'cum' | 'bal' }) {
  const bg = g === 'this' ? 'bg-blue-100' : g === 'prev' ? 'bg-amber-50' : g === 'cum' ? 'bg-emerald-50' : g === 'wo' ? 'bg-slate-100' : g === 'bal' ? 'bg-gray-50' : 'bg-slate-100'
  return (
    <th className={`border border-gray-200 px-1.5 py-1.5 text-[10.5px] font-bold uppercase tracking-wide text-slate-700 ${bg} ${l ? 'text-left' : 'text-right'}`}>
      {children}
    </th>
  )
}
function Td({ children, l, g, colSpan, centre, title, className = '' }: { children: React.ReactNode; l?: boolean; g?: 'wo' | 'prev' | 'this' | 'cum' | 'bal'; colSpan?: number; centre?: boolean; title?: string; className?: string }) {
  const bg = g === 'this' ? 'bg-blue-50/70' : g === 'prev' ? 'bg-amber-50/50' : g === 'cum' ? 'bg-emerald-50/40' : g === 'wo' ? 'bg-slate-50/60' : ''
  const align = centre ? 'text-center' : l ? 'text-left' : 'text-right'
  return (
    <td colSpan={colSpan} title={title} className={`border border-gray-100 px-1.5 py-1 tabular-nums ${bg} ${align} ${className}`}>
      {children}
    </td>
  )
}
function Chip({ k, v, tone }: { k: string; v: string; tone?: 'green' | 'red' }) {
  return (
    <div className="rounded-lg border border-gray-200 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{k}</div>
      <div className={`text-base font-extrabold tabular-nums ${tone === 'green' ? 'text-emerald-700' : tone === 'red' ? 'text-rose-700' : 'text-gray-900'}`}>{v}</div>
    </div>
  )
}
