'use client'
// "Correct entry" — for Billing, when the amount, bill no or date was typed
// wrong, or IN4 re-raised the bill under a new number (Aksha, 11 Oct 2026).
// A reason is required; the database keeps every change old → new.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, PencilLine } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MoneyInput } from '@/components/ui/money-input'
import { Textarea } from '@/components/ui/textarea'
import { correctBill } from './correct-actions'

export function CorrectEntry({ billId, claimed, billNo, billDate, onlyBillNo }: {
  billId: string
  claimed: number | null
  billNo: string | null
  billDate: string | null
  /** After IN4 cancelled it: only the bill no may change. */
  onlyBillNo: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [amt, setAmt] = useState(claimed != null ? String(Math.round(claimed * 100) / 100) : '')
  const [no, setNo] = useState(billNo ?? '')
  const [date, setDate] = useState(billDate ?? '')
  const [reason, setReason] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [pending, start] = useTransition()

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
        <PencilLine className="h-4 w-4" /> {onlyBillNo ? 'Enter the new bill no' : 'Correct entry'}
      </button>
    )
  }

  const save = () => start(async () => {
    setErr(null)
    const r = await correctBill({
      billId,
      claimed: onlyBillNo || amt === '' ? null : Number(amt),
      billNo: no.trim() || null,
      billDate: onlyBillNo || !date ? null : date,
      reason,
    })
    if (!r.ok) { setErr(r.error); return }
    toast.success(r.sentBack ? 'Corrected — the figure had been approved, so it is back with the Disc Head' : 'Corrected, and the change is kept on the bill')
    setOpen(false); setReason('')
    router.refresh()
  })

  return (
    <div className="w-full rounded-xl border border-gray-200 bg-white p-4 space-y-3">
      <p className="text-sm font-semibold text-gray-900">{onlyBillNo ? 'Raised again in IN4 under a new bill no' : 'Correct this entry'}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        {!onlyBillNo && (
          <div className="flex flex-col gap-1">
            <Label htmlFor="ce-amt" className="text-[12px]">Bill amount</Label>
            <MoneyInput id="ce-amt" value={amt} onChange={raw => { setAmt(raw); setErr(null) }} decimals={2} inputMode="decimal" className="min-h-[44px] sm:min-h-[36px]" />
          </div>
        )}
        <div className="flex flex-col gap-1">
          <Label htmlFor="ce-no" className="text-[12px]">Bill no</Label>
          <Input id="ce-no" value={no} onChange={e => { setNo(e.target.value); setErr(null) }} className="min-h-[44px] sm:min-h-[36px]" />
        </div>
        {!onlyBillNo && (
          <div className="flex flex-col gap-1">
            <Label htmlFor="ce-date" className="text-[12px]">Bill date</Label>
            <Input id="ce-date" type="date" value={date} onChange={e => { setDate(e.target.value); setErr(null) }} className="min-h-[44px] sm:min-h-[36px]" />
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="ce-why" className="text-[12px]">Why (required)</Label>
        <Textarea id="ce-why" rows={2} value={reason} onChange={e => { setReason(e.target.value); setErr(null) }}
                  placeholder={onlyBillNo ? 'e.g. Certificate cancelled and raised again as …' : 'e.g. Vendor revised the invoice'} />
      </div>
      <p className="text-[11.5px] text-gray-500">The old figure stays on the bill. If the CT Disc Head had already approved it, it goes back to them.</p>
      {err && <p className="text-[12px] font-semibold text-rose-700">{err}</p>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={() => { setOpen(false); setErr(null) }} className="w-full sm:w-auto">Cancel</Button>
        <Button onClick={save} disabled={pending || !reason.trim()} className="w-full sm:w-auto">
          {pending && <Loader2 className="h-4 w-4 animate-spin" />} Save correction
        </Button>
      </div>
    </div>
  )
}
