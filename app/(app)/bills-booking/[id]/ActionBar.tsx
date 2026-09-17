'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { MoneyInput } from '@/components/ui/money-input'
import { Loader2, ArrowRight, Undo2, PlayCircle, Ban, RotateCcw } from 'lucide-react'
import { stageDef, nextStage, prevStage, type BbStage } from '@/lib/bills-booking/stages'
import { formatINR } from '@/lib/utils'

/** The decision, pinned to the bottom of the screen.
 *
 *  Aksha, 16 Sep 2026, screen B: the one figure being approved and the things
 *  you can do with it stay on screen while you read the sheet. `position:
 *  fixed`, so the sticky trap inside `main` (AGENTS.md) does not apply.
 *
 *  Aksha, 17 Sep 2026: "Hold or Reject and send back - dont keep hiddenn -
 *  also remove HOLD option only." Both done:
 *
 *  · HOLD IS GONE. A held bill sat at a desk nobody owned — no SLA, nobody
 *    told, nothing chasing it. Sending it back names a desk and a reason and
 *    keeps the clock running, which is what "park this" actually needs to
 *    mean. The stage stays resolvable so an already-held bill still renders
 *    and can be resumed; none is held today.
 *  · NOTHING IS BEHIND "MORE". Send back, Reject and Forward all sit on the
 *    bar. The reason each one needs is asked in its own dialog at the moment
 *    it is clicked, so there is no free-floating "Why" box to fill in first.
 *
 *  Both destructive actions are reversible for ten minutes by whoever did
 *  them, and both are recorded either way. Reject is the only step in the flow
 *  that ends a bill, and it was one click from a desk holding lakhs. */
export function ActionBar({ billId, stage, netAmount, certified, claimed, preHoldStage, measured, orderType,
  hasStampedBill, navCollapsed, undoUntil, undoWhat, reconciles }: {
  billId: string; stage: BbStage
  netAmount: number | null; certified: number | null; claimed: number
  preHoldStage: BbStage | null
  measured: boolean | null
  orderType: string | null
  hasStampedBill: boolean
  navCollapsed: boolean
  /** ISO time until which this person can pull back what they just did. */
  undoUntil: string | null
  undoWhat: 'send_back' | 'reject' | null
  reconciles: boolean | null
}) {
  const router = useRouter()
  const supabase = createClient()
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [net, setNet] = useState(netAmount != null ? String(netAmount) : '')
  const [ask, setAsk] = useState<'send_back' | 'reject' | null>(null)
  const [reason, setReason] = useState('')
  const dlg = useRef<HTMLDialogElement>(null)
  const [, tick] = useState(0)
  // The undo window closes on its own; the button has to notice.
  useEffect(() => {
    if (!undoUntil) return
    const t = setInterval(() => tick(x => x + 1), 15_000)
    return () => clearInterval(t)
  }, [undoUntil])

  const fwd = nextStage(stage)
  const back = prevStage(stage)
  const waitsOnIn4 = stage === 'site_head' && measured !== null
  const thing = orderType === 'PO' ? 'goods receipt' : 'abstract'
  const showAmount = stage === 'ct_head'
  const resumeTo = preHoldStage ?? 'site_head'
  const needsDoc = stage === 'disc_head' && !hasStampedBill
  const canUndo = !!undoUntil && new Date(undoUntil).getTime() > Date.now()
  const figure = netAmount ?? certified ?? claimed
  const figureLabel = netAmount != null ? 'Net payable' : certified != null ? 'Certified' : 'Claimed'

  async function move(to: BbStage, action: string, key: string, why?: string) {
    setBusy(key); setErr(null)
    const { error } = await supabase.rpc('bb_rpc_move', {
      p_bill: billId, p_to: to, p_action: action,
      p_comment: why?.trim() || null,
      p_net: showAmount && net ? Number(net) : null,
      p_certified: showAmount && net ? Number(net) : null,
    })
    setBusy(null)
    if (error) { setErr(error.message); return false }
    return true
  }

  function open(what: 'send_back' | 'reject') {
    setAsk(what); setReason(''); setErr(null); dlg.current?.showModal()
  }

  /** Send back and Reject differ only in where the bill lands. Both take a
   *  reason, both offer the way home for ten minutes. */
  async function confirmAsk() {
    if (!ask) return
    const why = reason.trim()
    if (why.length < 8) { setErr('Say why — a reason is required, and eight characters is the least that says anything.'); return }
    const to = ask === 'reject' ? 'rejected' : back
    if (!to) return
    const ok = await move(to, ask, 'ask', why)
    if (!ok) return
    dlg.current?.close()
    const undoIt = async () => {
      const { error } = await supabase.rpc('bb_rpc_move', { p_bill: billId, p_to: stage, p_action: 'undo' })
      if (error) toast.error(error.message)
      else { toast.success('Pulled back — the bill is on your desk again'); router.push(`/bills-booking/${billId}`) }
    }
    toast.success(
      ask === 'reject' ? 'Rejected — it has left the flow' : `Sent back to ${stageDef(to as BbStage).label} — they have been told`,
      { duration: 600_000, action: { label: 'Undo', onClick: undoIt } },
    )
    router.push('/bills-booking')
  }

  async function undo() {
    if (await move(stage, 'undo', 'undo')) { toast.success('Pulled back — the bill is on your desk again'); router.refresh() }
  }

  async function forward() {
    if (!fwd) return
    if (await move(fwd, 'forward', 'fwd')) router.push('/bills-booking')
  }

  const left = navCollapsed ? 'md:left-16' : 'md:left-60'
  if (stage === 'paid' || stage === 'rejected') return null

  return (
    <>
      {/* Room at the foot of the page so the last card is not under the bar. */}
      <div className="h-24 md:h-20" aria-hidden />
      <div className={`fixed inset-x-0 bottom-0 z-30 border-t border-gray-200 bg-white/95 shadow-[0_-8px_24px_rgba(17,24,39,.08)] backdrop-blur ${left}`}>
        <div className="mx-auto max-w-5xl px-4 py-2.5 md:px-6">
          {err && <p role="alert" className="mb-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</p>}

          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <div className="mr-auto min-w-0">
              <p className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-400">{figureLabel} this bill</p>
              <p className="truncate text-base font-extrabold tabular-nums text-gray-900 sm:text-lg">
                {formatINR(figure)}
                {reconciles === true && <span className="ml-2 text-[11px] font-normal text-emerald-700">· sheet reconciles to IN4</span>}
                {reconciles === false && <span className="ml-2 text-[11px] font-normal text-amber-700">· sheet does not add up to IN4</span>}
              </p>
            </div>

            {stage === 'on_hold' ? (
              // Legacy only: nothing can be held any more. A bill already
              // parked here is resumed or rejected, and then it is gone.
              <>
                <span className="text-[12px] text-gray-500">Held — holding is no longer offered.</span>
                <Button onClick={() => move(resumeTo, 'resume', 'resume').then(ok => ok && router.push('/bills-booking'))}
                        disabled={busy !== null} className="min-h-[44px] bg-indigo-600 hover:bg-indigo-700">
                  {busy === 'resume' ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />} Resume to {stageDef(resumeTo).label}
                </Button>
                <Button variant="outline" onClick={() => open('reject')} disabled={busy !== null}
                        className="min-h-[44px] border-rose-200 text-rose-700 hover:bg-rose-50">
                  <Ban className="h-4 w-4" /> Reject
                </Button>
              </>
            ) : (
              <>
                {/* The one field a desk fills in. CT Head only, so it is on the
                    bar rather than hidden behind a toggle. */}
                {showAmount && (
                  <div className="w-full sm:w-[200px]">
                    <label className="text-[10.5px] font-medium text-gray-500">Verified net payable</label>
                    <MoneyInput value={net} onChange={setNet} placeholder={String(claimed)} />
                  </div>
                )}
                {canUndo && (
                  <Button variant="outline" onClick={undo} disabled={busy !== null}
                          className="min-h-[44px] border-indigo-200 text-indigo-700 hover:bg-indigo-50"
                          title={`You ${undoWhat === 'reject' ? 'rejected' : 'sent back'} this a moment ago — pull it back to your desk`}>
                    {busy === 'undo' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Undo
                  </Button>
                )}
                <Button variant="outline" onClick={() => open('reject')} disabled={busy !== null}
                        className="min-h-[44px] border-rose-200 text-rose-700 hover:bg-rose-50"
                        title="Ends the bill — for one raised in error. To have it corrected, send it back.">
                  <Ban className="h-4 w-4" /> Reject
                </Button>
                {back && (
                  <Button variant="outline" onClick={() => open('send_back')} disabled={busy !== null}
                          className="min-h-[44px] border-amber-200 text-amber-700 hover:bg-amber-50">
                    <Undo2 className="h-4 w-4" /> Send back
                  </Button>
                )}
                {fwd && !waitsOnIn4 && (
                  <span className="inline-flex flex-col items-end">
                    <Button onClick={forward} disabled={busy !== null || needsDoc}
                            className="min-h-[44px] bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60"
                            title={needsDoc ? 'Attach the stamped bill first' : undefined}>
                      {busy === 'fwd' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />} Forward to {stageDef(fwd).label}
                    </Button>
                    {needsDoc && <span className="mt-0.5 text-[11px] font-medium text-rose-700">Attach the stamped bill first</span>}
                  </span>
                )}
                {waitsOnIn4 && (
                  <span className={`rounded-lg border px-3 py-2 text-[12px] ${measured ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-blue-200 bg-blue-50 text-blue-900'}`}>
                    {measured ? <>IN4 has approved the {thing} — moves on at the next check</> : <>Waiting on IN4 to approve the {thing}</>}
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <dialog ref={dlg} className="w-[min(520px,92vw)] rounded-2xl border border-gray-200 p-0 shadow-2xl backdrop:bg-gray-900/40">
        <div className="p-5">
          <h3 className="text-base font-bold text-gray-900">
            {ask === 'reject'
              ? 'Reject this bill?'
              : `Send this bill back to ${back ? stageDef(back).label : 'the previous desk'}?`}
          </h3>
          <p className="mt-1 text-[13px] text-gray-600">
            {ask === 'reject' ? (
              <>It leaves the flow and cannot be forwarded again. Reject is for a bill raised in error — a duplicate, or
                one on the wrong order. If the bill is right but something on it needs fixing, <b>send it back</b> instead.</>
            ) : (
              <>The people on that desk are told, with your reason.
                {back === 'site_head' && <> The bill comes back to you by itself once the {thing} is revised and re-approved in IN4.</>}</>
            )}
          </p>
          <label className="mt-3 block text-xs font-semibold text-gray-600">Reason <span className="text-rose-600">· required</span></label>
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} autoFocus
                    className="mt-1 w-full rounded-lg border border-gray-300 p-2.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    placeholder={ask === 'reject' ? 'Why this bill should not exist' : 'What has to change'} />
          <p className="mt-2 text-[11.5px] text-gray-500">You can pull this back for <b>ten minutes</b> afterwards — it is recorded either way.</p>
          {err && <p role="alert" className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => dlg.current?.close()}
                    className="min-h-[40px] rounded-lg border border-gray-300 px-3.5 py-2 text-sm font-semibold text-gray-700">Keep it here</button>
            <button type="button" onClick={confirmAsk} disabled={busy !== null || reason.trim().length < 8}
                    className={`min-h-[40px] rounded-lg px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-50 ${
                      ask === 'reject' ? 'bg-rose-600' : 'bg-amber-600'}`}>
              {busy === 'ask' ? 'Working…' : ask === 'reject' ? 'Reject' : 'Send back'}
            </button>
          </div>
        </div>
      </dialog>
    </>
  )
}
