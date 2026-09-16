'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { MoneyInput } from '@/components/ui/money-input'
import { confirm } from '@/components/ui/confirm-dialog'
import { Loader2, ArrowRight, Undo2, PauseCircle, PlayCircle, Ban, ChevronUp, RotateCcw } from 'lucide-react'
import { stageDef, nextStage, prevStage, type BbStage } from '@/lib/bills-booking/stages'
import { formatINR } from '@/lib/utils'

/** The decision, pinned to the bottom of the screen.
 *
 *  Aksha, 16 Sep 2026, screen B of the look-and-feel preview: "Build it". The
 *  bill page is a long scroll — facts, sheet, money, flow — and the buttons sat
 *  at the very end of it. Now the one figure being approved and the two things
 *  you can do with it stay on screen while you read. `position: fixed`, so the
 *  sticky trap inside `main` (AGENTS.md) does not apply; the left edge follows
 *  the sidebar, whose width the server reads from its cookie.
 *
 *  Three rules from the same screen:
 *
 *  · SEND BACK asks "are you sure" with a reason that is compulsory, and can
 *    be pulled back for ten minutes — both recorded. Every one of the 43
 *    movements on record was a forward; a mis-click had no way home.
 *  · FORWARD from the Disc Head is refused without the stamped bill, and the
 *    button says so in words rather than going grey and silent. The database
 *    enforces the same rule, so the button is a courtesy, not the lock.
 *  · The Site Head has no Forward at all: the bill leaves that desk when IN4
 *    approves the measurement, never by a click (Aksha, 15 Sep). */
export function ActionBar({ billId, stage, netAmount, certified, claimed, preHoldStage, measured, orderType,
  hasStampedBill, navCollapsed, undoUntil, reconciles }: {
  billId: string; stage: BbStage
  netAmount: number | null; certified: number | null; claimed: number
  preHoldStage: BbStage | null
  measured: boolean | null
  orderType: string | null
  hasStampedBill: boolean
  navCollapsed: boolean
  /** ISO time until which this person can pull back their own send-back. */
  undoUntil: string | null
  reconciles: boolean | null
}) {
  const router = useRouter()
  const supabase = createClient()
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [more, setMore] = useState(false)
  const [comment, setComment] = useState('')
  const [net, setNet] = useState(netAmount != null ? String(netAmount) : '')
  const [reason, setReason] = useState('')
  const dlg = useRef<HTMLDialogElement>(null)
  const [tick, setTick] = useState(0)
  // The undo window closes on its own; the button has to notice.
  useEffect(() => {
    if (!undoUntil) return
    const t = setInterval(() => setTick(x => x + 1), 15_000)
    return () => clearInterval(t)
  }, [undoUntil])
  void tick

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
      p_comment: (why ?? comment).trim() || null,
      p_net: showAmount && net ? Number(net) : null,
      p_certified: showAmount && net ? Number(net) : null,
    })
    setBusy(null)
    if (error) { setErr(error.message); return false }
    return true
  }

  async function sendBack() {
    if (!back) return
    const why = reason.trim()
    if (why.length < 8) { setErr('Say what has to change — a reason is required, and eight characters is the least that says anything.'); return }
    const ok = await move(back, 'send_back', 'back', why)
    if (!ok) return
    dlg.current?.close()
    // The way home, for ten minutes. sonner keeps the toast across the
    // navigation because the Toaster lives in the app layout.
    toast.success(`Sent back to ${stageDef(back).label} — they have been told`, {
      duration: 600_000,
      action: {
        label: 'Undo',
        onClick: async () => {
          const { error } = await supabase.rpc('bb_rpc_move', { p_bill: billId, p_to: stage, p_action: 'undo' })
          if (error) toast.error(error.message)
          else { toast.success('Pulled back — the bill is on your desk again'); router.push(`/bills-booking/${billId}`) }
        },
      },
    })
    router.push('/bills-booking')
  }

  async function undo() {
    const ok = await move(stage, 'undo', 'undo')
    if (ok) { toast.success('Pulled back — the bill is on your desk again'); router.refresh() }
  }

  async function reject() {
    if (!comment.trim()) { setErr('Add a reason first — it is compulsory to reject'); return }
    const sure = await confirm({
      title: 'Reject this bill?',
      message: 'It leaves the flow and cannot be forwarded again. Your reason is recorded on the bill.',
      confirmLabel: 'Reject', danger: true,
    })
    if (!sure) return
    if (await move('rejected', 'reject', 'reject')) router.push('/bills-booking')
  }

  async function hold() {
    if (!comment.trim()) { setErr('Add a reason first — it is compulsory to put on hold'); return }
    if (await move('on_hold', 'hold', 'hold')) router.push('/bills-booking')
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

          {more && stage !== 'on_hold' && (
            <div className="mb-2.5 flex flex-wrap items-end gap-2 rounded-lg border border-gray-200 bg-gray-50 p-2.5">
              {showAmount && (
                <div className="w-full sm:w-[220px]">
                  <label className="text-[11px] font-medium text-gray-600">Verified net payable (locks on forward)</label>
                  <MoneyInput value={net} onChange={setNet} placeholder={String(claimed)} />
                </div>
              )}
              <div className="min-w-[200px] flex-1">
                <label className="text-[11px] font-medium text-gray-600">Reason (required to hold or reject)</label>
                <input value={comment} onChange={e => setComment(e.target.value)}
                       className="mt-1 h-10 w-full rounded-lg border border-gray-300 px-3 text-sm" placeholder="Why" />
              </div>
              <Button variant="outline" onClick={hold} disabled={busy !== null} className="min-h-[40px] border-gray-300 text-gray-700">
                {busy === 'hold' ? <Loader2 className="h-4 w-4 animate-spin" /> : <PauseCircle className="h-4 w-4" />} Hold
              </Button>
              <Button variant="outline" onClick={reject} disabled={busy !== null} className="min-h-[40px] border-rose-200 text-rose-700 hover:bg-rose-50">
                {busy === 'reject' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />} Reject
              </Button>
            </div>
          )}

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
              <>
                <input value={comment} onChange={e => setComment(e.target.value)}
                       className="h-10 w-40 rounded-lg border border-gray-300 px-3 text-sm" placeholder="Reason (to reject)" />
                <Button onClick={() => move(resumeTo, 'resume', 'resume').then(ok => ok && router.push('/bills-booking'))}
                        disabled={busy !== null} className="min-h-[44px] bg-indigo-600 hover:bg-indigo-700">
                  {busy === 'resume' ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />} Resume to {stageDef(resumeTo).label}
                </Button>
                <Button variant="outline" onClick={reject} disabled={busy !== null} className="min-h-[44px] border-rose-200 text-rose-700 hover:bg-rose-50">
                  <Ban className="h-4 w-4" /> Reject
                </Button>
              </>
            ) : (
              <>
                {canUndo && (
                  <Button variant="outline" onClick={undo} disabled={busy !== null}
                          className="min-h-[44px] border-indigo-200 text-indigo-700 hover:bg-indigo-50"
                          title="You sent this back a moment ago — pull it back to your desk">
                    {busy === 'undo' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Undo send-back
                  </Button>
                )}
                <button type="button" onClick={() => setMore(v => !v)}
                        className="inline-flex min-h-[44px] items-center gap-1 rounded-lg px-2 text-[12px] font-semibold text-gray-500 hover:text-gray-800"
                        aria-expanded={more}>
                  <ChevronUp className={`h-3.5 w-3.5 transition-transform ${more ? 'rotate-180' : ''}`} /> {more ? 'Less' : 'More'}
                </button>
                {back && (
                  <Button variant="outline" onClick={() => { setReason(''); setErr(null); dlg.current?.showModal() }} disabled={busy !== null}
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
          <h3 className="text-base font-bold text-gray-900">Send this bill back to {back ? stageDef(back).label : 'the previous desk'}?</h3>
          <p className="mt-1 text-[13px] text-gray-600">
            The people on that desk are told, with your reason.
            {back === 'site_head' && <> The bill comes back to you by itself once the {thing} is revised and re-approved in IN4.</>}
          </p>
          <label className="mt-3 block text-xs font-semibold text-gray-600">Reason <span className="text-rose-600">· required</span></label>
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} autoFocus
                    className="mt-1 w-full rounded-lg border border-gray-300 p-2.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    placeholder="What has to change" />
          <p className="mt-2 text-[11.5px] text-gray-500">You can pull this back for <b>ten minutes</b> after sending — it is recorded either way.</p>
          {err && <p role="alert" className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => dlg.current?.close()}
                    className="min-h-[40px] rounded-lg border border-gray-300 px-3.5 py-2 text-sm font-semibold text-gray-700">Keep it here</button>
            <button type="button" onClick={sendBack} disabled={busy !== null || reason.trim().length < 8}
                    className="min-h-[40px] rounded-lg bg-amber-600 px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {busy === 'back' ? 'Sending…' : 'Send back'}
            </button>
          </div>
        </div>
      </dialog>
    </>
  )
}
