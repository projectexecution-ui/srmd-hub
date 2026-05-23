'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Loader2 } from 'lucide-react'
import { todayISO } from '@/lib/jmr/format'
import type { JmrBill, JmrBillStatus } from '@/lib/types'

export function BillActions({ bill }: { bill: JmrBill }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [varianceNotes, setVarianceNotes] = useState(bill.variance_notes ?? '')
  const [paidOn, setPaidOn] = useState(bill.paid_on ?? todayISO())
  const [paymentRef, setPaymentRef] = useState(bill.payment_ref ?? '')

  async function update(patch: Partial<JmrBill> & { status?: JmrBillStatus }) {
    setBusy(true); setError(null)
    const supabase = createClient()
    const user = (await supabase.auth.getUser()).data.user
    const payload: Record<string, unknown> = { ...patch }
    if (patch.status === 'approved') {
      payload.approved_by_user_id = user?.id ?? null
      payload.approved_at = new Date().toISOString()
    }
    const { error } = await supabase.from('jmr_bills').update(payload).eq('id', bill.id)
    if (error) { setError(error.message); setBusy(false); return }
    setBusy(false)
    router.refresh()
  }

  if (bill.status === 'paid') {
    return <p className="text-sm text-gray-500">Bill has been paid. No further actions.</p>
  }
  if (bill.status === 'rejected') {
    return (
      <Button size="sm" variant="outline" onClick={() => update({ status: 'pm_review' })} disabled={busy}>
        Reopen for review
      </Button>
    )
  }

  return (
    <div className="space-y-3">
      {bill.variance_flag && bill.status === 'pm_review' && (
        <div>
          <Label className="text-xs">Variance notes</Label>
          <Textarea value={varianceNotes} onChange={e => setVarianceNotes(e.target.value)} rows={2} className="mt-1" />
        </div>
      )}
      {bill.status === 'pm_review' && (
        <div className="flex flex-col gap-2">
          <Button
            size="sm"
            disabled={busy}
            onClick={() => update({ status: 'approved', variance_notes: varianceNotes || null })}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Approve bill
          </Button>
          <Button
            size="sm" variant="outline"
            disabled={busy}
            onClick={() => update({ status: 'rejected', variance_notes: varianceNotes || null })}
          >
            Reject
          </Button>
        </div>
      )}
      {bill.status === 'approved' && (
        <>
          <div>
            <Label className="text-xs">Paid on</Label>
            <Input type="date" value={paidOn} onChange={e => setPaidOn(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">Payment reference</Label>
            <Input value={paymentRef} onChange={e => setPaymentRef(e.target.value)} placeholder="UTR / cheque #" className="mt-1" />
          </div>
          <Button
            size="sm" disabled={busy || !paymentRef}
            onClick={() => update({ status: 'paid', paid_on: paidOn, payment_ref: paymentRef })}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Mark paid
          </Button>
        </>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
