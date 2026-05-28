'use client'
// Approve a working sheet in tranches. Opens a small panel with the
// estimate / already-approved / remaining numbers and an amount input
// (pre-filled with the remaining). HOD can type a smaller number to
// release just a slice; clicking "Approve all remaining" finalises it.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { approveWorkingSheet } from '@/components/cost-control/ws-actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Check, Loader2, Wallet } from 'lucide-react'

function formatINR(n: number): string {
  return '₹' + (Number.isFinite(n) ? n.toLocaleString('en-IN', { maximumFractionDigits: 0 }) : '—')
}

export function ApproveTrancheButton({
  wsId, totalAmount, approvedSoFar, compact = false,
}: {
  wsId: string
  totalAmount: number
  approvedSoFar: number
  compact?: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const remaining = Math.max(totalAmount - approvedSoFar, 0)
  const [amount, setAmount] = useState<string>(String(remaining))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit(useAll: boolean) {
    setBusy(true); setErr(null)
    let trancheArg: number | null = null
    if (!useAll) {
      const num = Number(amount)
      if (!Number.isFinite(num) || num <= 0) { setErr('Enter an amount greater than zero'); setBusy(false); return }
      if (num > remaining + 0.5) { setErr(`Tranche ${formatINR(num)} exceeds remaining ${formatINR(remaining)}`); setBusy(false); return }
      trancheArg = num
    }
    const r = await approveWorkingSheet(wsId, trancheArg)
    setBusy(false)
    if (!r.ok) { setErr(r.error ?? 'Approve failed'); return }
    setOpen(false)
    router.refresh()
  }

  if (!open) {
    return (
      <Button
        variant="success"
        size={compact ? 'sm' : 'default'}
        onClick={() => { setOpen(true); setAmount(String(remaining)) }}
      >
        <Check className="h-4 w-4" />
        {approvedSoFar > 0 ? 'Approve more' : 'Approve'}
      </Button>
    )
  }

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3 space-y-3">
      <div className="flex items-center gap-2 text-xs">
        <Wallet className="h-3.5 w-3.5 text-emerald-700" />
        <span className="text-emerald-900 font-semibold">Approve a tranche into ERP</span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <Stat label="Estimate" value={formatINR(totalAmount)} />
        <Stat label="Already approved" value={formatINR(approvedSoFar)} tone="green" />
        <Stat label="Remaining" value={formatINR(remaining)} tone="amber" />
      </div>
      <div>
        <label className="text-[11px] font-semibold text-gray-700">Tranche amount (₹)</label>
        <Input
          type="number" step="any" inputMode="decimal"
          value={amount} onChange={e => setAmount(e.target.value)}
          placeholder={String(remaining)}
          className="mt-1 font-mono"
        />
        <p className="text-[11px] text-gray-500 mt-1">
          Enter the slice HOD is approving now. Sheet stays open at &quot;partially approved&quot; until the full estimate is reached.
        </p>
      </div>
      {err && <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1.5">{err}</p>}
      <div className="flex flex-wrap gap-2 justify-end">
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => submit(true)}>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Approve all remaining ({formatINR(remaining)})
        </Button>
        <Button variant="success" size="sm" disabled={busy || !amount} onClick={() => submit(false)}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Approve this tranche
        </Button>
      </div>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'green' | 'amber' }) {
  const cls = tone === 'green' ? 'text-emerald-800' : tone === 'amber' ? 'text-amber-800' : 'text-gray-800'
  return (
    <div className="bg-white rounded-md border border-gray-200 px-2 py-1.5">
      <p className="text-[10px] uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`font-mono font-semibold ${cls}`}>{value}</p>
    </div>
  )
}
