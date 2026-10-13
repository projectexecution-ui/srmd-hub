'use client'

import { useState, useTransition } from 'react'
import { Link2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { formatINR } from '@/lib/utils'
import { OrderPicker, type OrderKind } from '../new/OrderPicker'
import type { PickableOrder } from '@/lib/bills-booking/orders'
import { attachOrder } from './attach-actions'

/** "No WO yet" → the order IN4 has now raised. One pick, one tap; the bill
 *  becomes a normal WO / PO bill and CT Hub follows it into IN4. */
export function AttachOrder({ billId, wos, pos, projects, subprojects, vendor }: {
  billId: string
  wos: PickableOrder[]
  pos: PickableOrder[]
  projects: Array<[number, string]>
  subprojects: Array<[number, string]>
  vendor: string
}) {
  const [kind, setKind] = useState<OrderKind>('WO')
  const [picked, setPicked] = useState<PickableOrder | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, start] = useTransition()

  const go = () => {
    if (!picked) return
    setErr(null)
    start(async () => {
      const r = await attachOrder(billId, picked.orderNo)
      if (!r.ok) { setErr(r.error ?? 'Could not attach'); return }
      toast.success(`${picked.kind} ${picked.orderNo} attached`)
    })
  }

  const differs = picked && picked.party && vendor && picked.party.trim().toLowerCase() !== vendor.trim().toLowerCase()

  return (
    <Card className="space-y-3 p-4">
      <div>
        <p className="flex items-center gap-2 text-sm font-bold text-gray-900"><Link2 className="h-4 w-4 text-indigo-600" /> Attach the work order</p>
        <p className="mt-0.5 text-[12px] text-gray-600">
          Once IN4 has raised the WO or PO for this bill, pick it here. The bill keeps everything so far, becomes a normal {kind} bill,
          and CT Hub follows it into IN4 from there.
        </p>
      </div>
      <OrderPicker kind={kind} onKind={k => { setKind(k); setPicked(null) }} wos={wos} pos={pos}
                   picked={picked} onPick={setPicked} projectNames={new Map(projects)} subprojectNames={new Map(subprojects)}
                   booksTo={picked?.subprojectId ?? null} onSubproject={() => {}} />
      {picked && (
        <div className="space-y-2">
          {differs && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
              This order is for <b>{picked.party}</b>; the bill says <b>{vendor}</b>. Check it is the right order before attaching.
            </p>
          )}
          <Button onClick={go} disabled={busy} className="bg-indigo-600 hover:bg-indigo-700">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
            Attach {picked.orderNo} ({formatINR(Math.round(picked.orderedGross))})
          </Button>
        </div>
      )}
      {err && <p role="alert" className="text-[12px] font-semibold text-rose-700">{err}</p>}
    </Card>
  )
}
