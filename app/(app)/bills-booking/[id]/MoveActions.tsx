'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { MoneyInput } from '@/components/ui/money-input'
import { Loader2, ArrowRight, Undo2, PauseCircle, PlayCircle, Ban } from 'lucide-react'
import { stageDef, nextStage, prevStage, type BbStage } from '@/lib/bills-booking/stages'

export function MoveActions({ billId, stage, netAmount, claimed, preHoldStage }: {
  billId: string; stage: BbStage; netAmount: number | null; claimed: number; preHoldStage: BbStage | null
}) {
  const router = useRouter()
  const supabase = createClient()
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [net, setNet] = useState(netAmount != null ? String(netAmount) : '')

  const fwd = nextStage(stage)
  const back = prevStage(stage)
  const showAmount = stage === 'ct_head' // CT Head locks the verified net
  const resumeTo = preHoldStage ?? 'site_head'

  async function move(to: BbStage, action: string, key: string) {
    if ((action === 'send_back' || action === 'hold' || action === 'reject') && !comment.trim()) {
      setErr('Add a reason first'); return
    }
    setBusy(key); setErr(null)
    const { error } = await supabase.rpc('bb_rpc_move', {
      p_bill: billId, p_to: to, p_action: action,
      p_comment: comment.trim() || null,
      p_net: showAmount && net ? Number(net) : null,
      p_certified: showAmount && net ? Number(net) : null,
    })
    if (error) { setBusy(null); setErr(error.message); return }
    router.push('/bills-booking')
  }

  if (stage === 'paid' || stage === 'rejected') {
    return <Card className="p-4 text-sm text-gray-500">This bill is <b>{stageDef(stage).label.toLowerCase()}</b> — no further action.</Card>
  }

  // Held bill: resume it, or reject it. (This is the previously-dead-end fix.)
  if (stage === 'on_hold') {
    return (
      <Card className="p-4 space-y-3 border-gray-200">
        <p className="text-sm text-gray-700">On hold. Resume it back to <b>{stageDef(resumeTo).label}</b>, or reject it.</p>
        {err && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</p>}
        <Textarea value={comment} onChange={e => setComment(e.target.value)} rows={2} placeholder="Comment (required to reject)" />
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => move(resumeTo, 'resume', 'resume')} disabled={busy !== null} className="bg-indigo-600 hover:bg-indigo-700">
            {busy === 'resume' ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />} Resume to {stageDef(resumeTo).label}
          </Button>
          <Button variant="outline" onClick={() => move('rejected', 'reject', 'reject')} disabled={busy !== null} className="border-rose-200 text-rose-700 hover:bg-rose-50">
            {busy === 'reject' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />} Reject
          </Button>
        </div>
      </Card>
    )
  }

  return (
    <Card className="p-4 space-y-3 border-indigo-200">
      <p className="text-sm text-gray-700">
        At <b>{stageDef(stage).label}</b> ({stageDef(stage).desk}).{fwd && <> Forward sends it to <b>{stageDef(fwd).label}</b>.</>}
      </p>
      {err && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</p>}

      {showAmount && (
        <div className="max-w-[240px]">
          <label className="text-xs font-medium text-gray-600">Verified net payable (locks on forward)</label>
          <MoneyInput value={net} onChange={setNet} placeholder={String(claimed)} />
        </div>
      )}

      <Textarea value={comment} onChange={e => setComment(e.target.value)} rows={2} placeholder="Comment / checks (required to send back, hold or reject)" />

      <div className="flex flex-wrap gap-2">
        {fwd && (
          <Button onClick={() => move(fwd, 'forward', 'fwd')} disabled={busy !== null} className="bg-indigo-600 hover:bg-indigo-700">
            {busy === 'fwd' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />} Forward to {stageDef(fwd).label}
          </Button>
        )}
        {back && (
          <Button variant="outline" onClick={() => move(back, 'send_back', 'back')} disabled={busy !== null} className="border-amber-200 text-amber-700 hover:bg-amber-50">
            {busy === 'back' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />} Send back to {stageDef(back).label}
          </Button>
        )}
        <Button variant="outline" onClick={() => move('on_hold', 'hold', 'hold')} disabled={busy !== null} className="border-gray-200 text-gray-600 hover:bg-gray-50">
          {busy === 'hold' ? <Loader2 className="h-4 w-4 animate-spin" /> : <PauseCircle className="h-4 w-4" />} Hold
        </Button>
        <Button variant="outline" onClick={() => move('rejected', 'reject', 'reject')} disabled={busy !== null} className="border-rose-200 text-rose-700 hover:bg-rose-50">
          {busy === 'reject' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />} Reject
        </Button>
      </div>
    </Card>
  )
}
