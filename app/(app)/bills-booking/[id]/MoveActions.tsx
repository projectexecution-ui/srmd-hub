'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { MoneyInput } from '@/components/ui/money-input'
import { Loader2, ArrowRight, Undo2, PauseCircle } from 'lucide-react'
import { stageDef, nextStage, prevStage, isTerminal, type BbStage } from '@/lib/bills-booking/stages'

// The desks where a verified amount is set/locked.
const AMOUNT_STAGES: BbStage[] = ['ct_head', 'atm_approval', 'ct_billing']

export function MoveActions({ billId, stage, netAmount, claimed }: {
  billId: string; stage: BbStage; netAmount: number | null; claimed: number
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

  async function move(to: BbStage, action: string, key: string) {
    if ((action === 'send_back' || action === 'hold') && !comment.trim()) {
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

  if (isTerminal(stage)) {
    return (
      <Card className="p-4 text-sm text-gray-500">
        This bill is <b>{stageDef(stage).label.toLowerCase()}</b> — no further action.
      </Card>
    )
  }

  return (
    <Card className="p-4 space-y-3 border-indigo-200">
      <p className="text-sm text-gray-700">
        At <b>{stageDef(stage).label}</b> ({stageDef(stage).desk}).
        {fwd && <> Forward sends it to <b>{stageDef(fwd).label}</b>.</>}
      </p>
      {err && <p role="alert" className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{err}</p>}

      {showAmount && (
        <div className="max-w-[240px]">
          <label className="text-xs font-medium text-gray-600">Verified net payable (locks on forward)</label>
          <MoneyInput value={net} onChange={setNet} placeholder={String(claimed)} />
        </div>
      )}

      <Textarea value={comment} onChange={e => setComment(e.target.value)} rows={2}
        placeholder="Comment / checks (required to send back or hold)" />

      <div className="flex flex-wrap gap-2">
        {fwd && (
          <Button onClick={() => move(fwd, 'forward', 'fwd')} disabled={busy !== null} className="bg-indigo-600 hover:bg-indigo-700">
            {busy === 'fwd' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            Forward to {stageDef(fwd).label}
          </Button>
        )}
        {back && (
          <Button variant="outline" onClick={() => move(back, 'send_back', 'back')} disabled={busy !== null}
            className="text-amber-700 border-amber-200 hover:bg-amber-50">
            {busy === 'back' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
            Send back to {stageDef(back).label}
          </Button>
        )}
        {stage !== 'on_hold' && (
          <Button variant="outline" onClick={() => move('on_hold', 'hold', 'hold')} disabled={busy !== null}
            className="text-gray-600 border-gray-200 hover:bg-gray-50">
            {busy === 'hold' ? <Loader2 className="h-4 w-4 animate-spin" /> : <PauseCircle className="h-4 w-4" />}
            Hold
          </Button>
        )}
      </div>
    </Card>
  )
}
