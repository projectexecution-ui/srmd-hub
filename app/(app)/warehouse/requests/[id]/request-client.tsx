'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { Card } from '@/components/ui/card'
import { confirm } from '@/components/ui/confirm-dialog'
import { formatDate, formatDateTime } from '@/lib/utils'
import { formatQty, formatINR } from '@/lib/warehouse/format'
import { moveRequest, cancelRequest, waiveReturn } from '../../request-actions'
import { STATUS_TONE } from '@/lib/warehouse/requests'
import { STAGE_LABEL } from '@/lib/warehouse/approval-matrix'
import { returnSummary } from '@/lib/warehouse/cross-project'
import type { RequestDetail } from '@/lib/warehouse/request-data'
import {
  Loader2, Stamp, X, Info, PackageCheck, Ban, TriangleAlert, ArrowRight, Undo2,
} from 'lucide-react'

const inputCls =
  'w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm bg-white min-h-[40px] ' +
  'focus:outline-none focus:ring-2 focus:ring-emerald-400/40 focus:border-emerald-400'
const labelCls = 'block text-[10px] font-extrabold uppercase tracking-wider text-slate-400 mb-1'

const TONE: Record<string, string> = {
  wait: 'bg-amber-100 text-amber-900 border-amber-200',
  go: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  part: 'bg-sky-100 text-sky-800 border-sky-200',
  done: 'bg-slate-100 text-slate-600 border-slate-200',
  bad: 'bg-rose-100 text-rose-800 border-rose-200',
  dead: 'bg-slate-100 text-slate-400 border-slate-200',
}

type Move = {
  toStage: string
  needsRemarks: boolean
  label: string
  /** What pressing it does, in consequences rather than stage names. */
  hint: string
}

export function RequestClient({
  request: r, showValues, moves, whyNoMoves, canIssue, whyNotIssue, canCancel,
  canWaive, whyNotWaive, capExplainer,
}: {
  request: RequestDetail
  showValues: boolean
  /** Generated from the approval rules, not hard-coded. */
  moves: Move[]
  whyNoMoves: string | null
  canIssue: boolean
  whyNotIssue: string | null
  canCancel: boolean
  /** May this person release the material from having to come back? */
  canWaive: boolean
  whyNotWaive: string | null
  /** Where this person’s own authority stops, when a cap is configured. */
  capExplainer: string | null
}) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [open, setOpen] = useState<Move | null>(null)
  const [reason, setReason] = useState('')
  const [waiving, setWaiving] = useState(false)
  const [waiveNote, setWaiveNote] = useState('')

  return (
    <div className="space-y-3">
      {/* Where it stands, first thing, in one band. */}
      <Card className={`p-3 shadow-sm border ${TONE[STATUS_TONE[r.status]]}`}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="text-[14px] font-extrabold">{STAGE_LABEL[r.status]}</p>
            <p className="text-[12px] mt-0.5">
              Raised {formatDate(r.day)}{r.requestedBy ? ` by ${r.requestedBy}` : ''}
              {r.age > 0 ? ` · ${r.age} ${r.age === 1 ? 'day' : 'days'} ago` : ' · today'}
            </p>
          </div>
          {r.status === 'part_issued' && (
            <p className="text-[13px] font-extrabold">{r.pct}% issued</p>
          )}
        </div>

        {(r.status === 'pending' || r.status === 'checked') && (
          <p className="text-[12px] mt-1.5">
            {r.approvals.length > 0
              ? `${r.approvals.length} ${r.approvals.length === 1 ? 'approval' : 'approvals'} so far`
              : 'No approval yet'}
            {r.estValue != null && showValues ? ` · about ${formatINR(r.estValue)}` : ''}
          </p>
        )}
        {returnSummary(r.items.map(i => ({
          lineId: i.lineId, isReturnable: i.isReturnable, waivedAt: i.waivedAt, issuedQty: i.issuedQty,
        }))) && (
          <p className="text-[12px] mt-1.5 inline-flex items-center gap-1.5">
            <Undo2 className="h-3.5 w-3.5" />
            {returnSummary(r.items.map(i => ({
              lineId: i.lineId, isReturnable: i.isReturnable, waivedAt: i.waivedAt, issuedQty: i.issuedQty,
            })))}
          </p>
        )}
        {r.status === 'rejected' && r.rejectReason && (
          <p className="text-[12.5px] mt-1.5">
            <b>Reason:</b> {r.rejectReason}{r.rejectedBy ? ` — ${r.rejectedBy}` : ''}
          </p>
        )}
        {r.status === 'cancelled' && (
          <p className="text-[12.5px] mt-1.5">
            Withdrawn{r.cancelledBy ? ` by ${r.cancelledBy}` : ''}. Nobody refused it.
          </p>
        )}
      </Card>

      <Card className="p-3 shadow-sm">
        <dl className="grid sm:grid-cols-2 gap-x-4 gap-y-1.5">
          {[
            ['Asking', r.storeName],
            ['Going to', r.destination],
            ['What for', r.purpose],
            ['Needed by', r.needBy ? formatDate(r.needBy) : 'not stated'],
          ].map(([k, v]) => (
            <div key={k} className="flex gap-2 text-[12.5px] min-w-0">
              <dt className="text-slate-500 flex-shrink-0 w-[86px]">{k}</dt>
              <dd className="font-semibold text-slate-800 min-w-0 break-words">{v}</dd>
            </div>
          ))}
        </dl>

        {r.approvals.length > 0 && (
          <div className="mt-2.5 pt-2.5 border-t border-slate-100 space-y-1">
            {r.approvals.map(a => (
              <p key={a.stage} className="text-[11.5px] text-emerald-800 flex items-center gap-1.5">
                <Stamp className="h-3.5 w-3.5" />
                Approval {a.stage} — {a.by}, {formatDateTime(a.at)}
              </p>
            ))}
          </div>
        )}
      </Card>

      {/* Each line against what the store actually holds, so the keeper is not
          guessing and the requester can see why only part came. */}
      <Card className="p-0 shadow-sm overflow-hidden">
        <p className="px-3 pt-3 pb-2 text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
          {r.items.length} {r.items.length === 1 ? 'item' : 'items'} asked for
        </p>
        <div className="divide-y divide-slate-100">
          {r.items.map(it => {
            const shortNow = it.outstanding > it.available
            return (
              <div key={it.lineId} className="px-3 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[13px] font-semibold text-slate-800 min-w-0">
                    {it.itemName}
                    {it.itemCode && (
                      <span className="ml-1.5 font-mono text-[10px] font-normal text-slate-400">{it.itemCode}</span>
                    )}
                  </p>
                  <p className="text-[13px] font-bold tabular-nums text-slate-900 whitespace-nowrap">
                    {formatQty(it.qty)} <span className="font-normal text-slate-400">{it.unit}</span>
                  </p>
                </div>
                <p className="text-[11px] mt-0.5">
                  {it.issuedQty > 0 && (
                    <span className="text-emerald-700 font-semibold mr-2">
                      {formatQty(it.issuedQty)} issued
                    </span>
                  )}
                  {it.outstanding > 0 && (
                    <span className="text-amber-800 font-semibold mr-2">
                      {formatQty(it.outstanding)} still to come
                    </span>
                  )}
                  <span className={shortNow ? 'text-rose-700 font-semibold' : 'text-slate-500'}>
                    store holds {formatQty(it.available)} {it.unit}
                  </span>
                </p>
                {it.isReturnable && !it.waivedAt && (
                  <p className="text-[11px] font-semibold text-violet-700 mt-0.5 inline-flex items-center gap-1">
                    <Undo2 className="h-3 w-3" /> Returnable — must come back
                  </p>
                )}
                {it.waivedAt && (
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    <span className="font-semibold text-slate-600">Need not come back</span>
                    {it.waivedBy ? ` — ${it.waivedBy}` : ''}, {formatDateTime(it.waivedAt)}
                    {it.waivedNote ? ` · ${it.waivedNote}` : ''}
                  </p>
                )}
                {it.note && <p className="text-[11px] text-slate-500 mt-0.5">{it.note}</p>}
              </div>
            )
          })}
        </div>
      </Card>

      {r.issues.length > 0 && (
        <Card className="p-3 shadow-sm">
          <p className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400 mb-1.5">
            Issued against this request
          </p>
          {r.issues.map(i => (
            <Link key={i.id} href={`/warehouse/entries/out/${i.id}`}
              className="flex items-center justify-between gap-2 py-1 text-[12.5px] hover:underline">
              <span className={i.voided ? 'line-through text-slate-400' : 'text-slate-700'}>
                <span className="font-mono text-[11px]">{i.entryNo}</span> · {formatDate(i.day)}
              </span>
              {i.voided && <span className="text-[11px] font-bold text-rose-600">voided</span>}
            </Link>
          ))}
        </Card>
      )}

      {/* ---- What can be done next ---- */}
      <Card className="p-3 shadow-sm space-y-2">
        <p className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">Next step</p>

        {/* One button per hop the rules allow this person, at this stage, at
            this value. A new stage or a new approver role needs no code here. */}
        {moves.length > 0 && !open && (
          <div className="space-y-2">
            {capExplainer && (
              <p className="text-[12px] text-slate-600 bg-slate-50 border border-slate-200
                            rounded-lg px-2.5 py-2 flex gap-1.5">
                <Info className="h-3.5 w-3.5 flex-shrink-0 mt-0.5 text-slate-400" />
                <span>{capExplainer}</span>
              </p>
            )}
            {/* One full-width choice per row, each saying what it does. Chips
                side by side had no room for the consequence, which is how
                "Check and pass on" ended up meaning nothing to anybody. */}
            {moves.map(m => (
              <button key={m.toStage} type="button" disabled={busy}
                onClick={() => { setOpen(m); setReason('') }}
                className={`w-full text-left rounded-lg border-2 px-3 py-2.5 min-h-[56px]
                            disabled:opacity-50 transition flex items-start gap-2.5 ${
                  m.toStage === 'rejected'
                    ? 'border-rose-200 hover:border-rose-300 hover:bg-rose-50'
                    : 'border-emerald-300 bg-emerald-50/50 hover:bg-emerald-50'}`}>
                <span className={`mt-0.5 flex-shrink-0 ${
                  m.toStage === 'rejected' ? 'text-rose-600' : 'text-emerald-700'}`}>
                  {m.toStage === 'rejected' ? <X className="h-4 w-4" /> : <Stamp className="h-4 w-4" />}
                </span>
                <span className="min-w-0">
                  <span className={`block text-[13.5px] font-bold ${
                    m.toStage === 'rejected' ? 'text-rose-800' : 'text-emerald-900'}`}>
                    {m.label}
                  </span>
                  <span className="block text-[11.5px] text-slate-600 mt-0.5 leading-snug">
                    {m.hint}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}

        {open && (
          <div className="space-y-2">
            <div>
              <label className={labelCls} htmlFor="mv-note">
                {open.needsRemarks ? 'Why? (compulsory for this step)' : 'Remark (optional)'}
              </label>
              <input id="mv-note" className={inputCls} value={reason} autoFocus
                onChange={e => setReason(e.target.value)}
                placeholder={open.toStage === 'rejected'
                  ? 'Not budgeted this month — raise it in September'
                  : 'Anything the storekeeper should know'} />
              {open.needsRemarks && (
                <p className="text-[11px] text-slate-500 mt-1">
                  An admin made a remark compulsory for this step in Admin ▸ Approvals. A decision the
                  requester cannot act on just gets raised again tomorrow.
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <button type="button" disabled={busy}
                className={`rounded-lg px-3 py-2 min-h-[42px] text-[12.5px] font-bold text-white
                            disabled:opacity-50 inline-flex items-center gap-1.5 ${
                  open.toStage === 'rejected' ? 'bg-rose-600 hover:bg-rose-700'
                                              : 'bg-emerald-600 hover:bg-emerald-700'}`}
                onClick={() => start(async () => {
                  const res = await moveRequest(r.id, open.toStage, reason)
                  if (!res.ok) { toast.error(res.error ?? 'Could not do that.', { duration: 10000 }); return }
                  toast.success(`${r.reqNo} → ${STAGE_LABEL[open.toStage] ?? open.toStage}`)
                  setOpen(null); setReason('')
                  router.refresh()
                })}>
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {open.label}
              </button>
              <button type="button" onClick={() => { setOpen(null); setReason('') }} disabled={busy}
                className="rounded-lg border-2 border-slate-200 px-3 py-2 min-h-[42px] text-[12.5px] font-bold text-slate-500">
                Back
              </button>
            </div>
          </div>
        )}

        {/* The rule is shown rather than the button being quietly greyed out. */}
        {whyNoMoves && (
          <p className="text-[12px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2 flex gap-1.5">
            <Info className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
            <span>{whyNoMoves}</span>
          </p>
        )}

        {canIssue && (
          <Link href={`/warehouse/out?req=${r.id}`}
            className="rounded-lg bg-sky-600 px-3 py-2 min-h-[42px] text-[12.5px] font-bold text-white
                       hover:bg-sky-700 inline-flex items-center gap-1.5 w-fit">
            <PackageCheck className="h-3.5 w-3.5" /> Issue against this request
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        )}
        {whyNotIssue && r.status !== 'pending' && (
          <p className="text-[12px] text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2 flex gap-1.5">
            <TriangleAlert className="h-3.5 w-3.5 flex-shrink-0 mt-0.5 text-slate-400" />
            <span>{whyNotIssue}</span>
          </p>
        )}

        {/* Aksha’s rule: another project’s stock is always borrowed on a
            returnable footing, but the Atm Head can release it AFTER approving —
            including once it has gone out. Firm at the asking, flexible after. */}
        {canWaive && !waiving && (
          <button type="button" disabled={busy} onClick={() => { setWaiving(true); setWaiveNote('') }}
            className="rounded-lg border-2 border-violet-200 px-3 py-2 min-h-[42px] text-[12.5px] font-bold
                       text-violet-800 hover:bg-violet-50 inline-flex items-center gap-1.5 w-fit">
            <Undo2 className="h-3.5 w-3.5" /> Not required to take back
          </button>
        )}

        {waiving && (
          <div className="space-y-2 rounded-lg border border-violet-200 bg-violet-50/60 p-2.5">
            <div>
              <label className={labelCls} htmlFor="waive-note">Why need it not come back?</label>
              <input id="waive-note" className={inputCls} value={waiveNote} autoFocus
                onChange={e => setWaiveNote(e.target.value)}
                placeholder="Consumed on site — charge it to the borrowing project" />
              <p className="text-[11px] text-violet-900 mt-1">
                It stops being chased on the Returnables report, and your name and reason stay
                on the request.
              </p>
            </div>
            <div className="flex gap-2">
              <button type="button" disabled={busy || !waiveNote.trim()}
                className="rounded-lg bg-violet-700 px-3 py-2 min-h-[42px] text-[12.5px] font-bold text-white
                           hover:bg-violet-800 disabled:opacity-50 inline-flex items-center gap-1.5"
                onClick={() => start(async () => {
                  const res = await waiveReturn(r.id, waiveNote)
                  if (!res.ok) { toast.error(res.error ?? 'Could not do that.', { duration: 10000 }); return }
                  toast.success('Released — it need not come back')
                  setWaiving(false); setWaiveNote('')
                  router.refresh()
                })}>
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Release it
              </button>
              <button type="button" onClick={() => { setWaiving(false); setWaiveNote('') }} disabled={busy}
                className="rounded-lg border-2 border-slate-200 px-3 py-2 min-h-[42px] text-[12.5px] font-bold text-slate-500">
                Back
              </button>
            </div>
          </div>
        )}

        {/* Shown, not hidden — a missing button with no reason reads as a bug. */}
        {!canWaive && whyNotWaive && r.items.some(i => i.isReturnable) && (
          <p className="text-[12px] text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2 flex gap-1.5">
            <Info className="h-3.5 w-3.5 flex-shrink-0 mt-0.5 text-slate-400" />
            <span>{whyNotWaive}</span>
          </p>
        )}

        {canCancel && (r.status === 'pending' || r.status === 'approved') && (
          <button type="button" disabled={busy}
            className="rounded-lg border-2 border-slate-200 px-3 py-2 min-h-[42px] text-[12.5px] font-bold
                       text-slate-500 hover:border-slate-300 inline-flex items-center gap-1.5 w-fit"
            onClick={() => start(async () => {
              const ok = await confirm({
                title: `Withdraw ${r.reqNo}?`,
                message: 'It disappears from the store’s queue. Nobody is recorded as having refused it.',
                confirmLabel: 'Withdraw it',
              })
              if (!ok) return
              const res = await cancelRequest(r.id)
              if (!res.ok) { toast.error(res.error ?? 'Could not cancel it.', { duration: 9000 }); return }
              toast.success(`${r.reqNo} withdrawn`)
              router.refresh()
            })}>
            <Ban className="h-3.5 w-3.5" /> Withdraw this request
          </button>
        )}
      </Card>
    </div>
  )
}
