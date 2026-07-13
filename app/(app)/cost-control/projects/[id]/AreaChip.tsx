'use client'
// Inline-editable project area chip on the Internal Estimate header —
// wrong areas poison every ₹/sft figure, so management can fix it here
// without leaving the page.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Loader2, Check, X } from 'lucide-react'
import { MoneyInput } from '@/components/ui/money-input'
import { setProjectArea } from './actions'

export function AreaChip({ projectId, sft, canWrite }: {
  projectId: string
  sft: number | null
  canWrite: boolean
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [raw, setRaw] = useState(sft != null ? String(sft) : '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    const n = raw === '' ? null : Number(raw)
    if (n != null && (!Number.isFinite(n) || n < 0)) { setErr('Enter a valid area'); return }
    setBusy(true); setErr(null)
    const r = await setProjectArea(projectId, n)
    setBusy(false)
    if (!r.ok) { setErr(r.error ?? 'Could not save the area'); return }
    setEditing(false)
    router.refresh()
  }

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-700">
        <span className="tabular-nums font-semibold">
          {sft != null && sft > 0 ? `${sft.toLocaleString('en-IN')} sft` : 'Set area'}
        </span>
        {canWrite && (
          <button
            type="button"
            onClick={() => { setEditing(true); setErr(null) }}
            className="text-gray-400 hover:text-blue-600"
            title="Correct the project's built-up area — every ₹/sft figure uses it"
          >
            <Pencil className="h-3 w-3" />
          </button>
        )}
      </span>
    )
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <span className="inline-flex items-center gap-1">
        <MoneyInput
          value={raw}
          onChange={setRaw}
          decimals={0}
          placeholder="e.g. 56000"
          className="h-7 w-28 text-xs"
          autoFocus
        />
        <span className="text-[10px] text-gray-500">sft</span>
        <button type="button" onClick={save} disabled={busy} className="text-emerald-600 hover:text-emerald-700 disabled:opacity-50" title="Save">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        </button>
        <button type="button" onClick={() => { setEditing(false); setRaw(sft != null ? String(sft) : ''); setErr(null) }} disabled={busy} className="text-gray-400 hover:text-gray-600" title="Cancel">
          <X className="h-4 w-4" />
        </button>
      </span>
      {err && <span className="text-[10px] text-rose-600">{err}</span>}
    </span>
  )
}
