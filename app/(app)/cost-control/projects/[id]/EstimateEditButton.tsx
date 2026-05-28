'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { setInternalEstimate } from '@/components/cost-control/ws-actions'
import { Button } from '@/components/ui/button'
import { Loader2, Pencil, X, Calculator } from 'lucide-react'

export function EstimateEditButton({
  projectId, disciplineId, subSkillId, subSkillLabel, lineType, currentEstimate, currentNotes, compact = false,
}: {
  projectId: string
  disciplineId: string
  subSkillId: string
  subSkillLabel: string
  lineType: 'work' | 'material'
  currentEstimate: number | null
  currentNotes: string | null
  compact?: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState<string>(currentEstimate != null ? String(currentEstimate) : '')
  const [notes, setNotes] = useState<string>(currentNotes ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    setBusy(true); setErr(null)
    const num = amount.trim() === '' ? null : Number(amount)
    if (num != null && (!Number.isFinite(num) || num < 0)) {
      setErr('Enter a non-negative number, or leave empty to clear'); setBusy(false); return
    }
    const r = await setInternalEstimate({
      projectId, disciplineId, subSkillId, lineType,
      amount: num, notes: notes.trim() || null,
    })
    setBusy(false)
    if (!r.ok) { setErr(r.error ?? 'Save failed'); return }
    setOpen(false)
    router.refresh()
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={compact
          ? 'inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 hover:text-blue-800'
          : 'inline-flex items-center gap-1.5 text-sm font-medium text-blue-700 hover:text-blue-800'}
        title="Set / change Internal Estimate"
      >
        {currentEstimate != null ? <Pencil className="h-3 w-3" /> : <Calculator className="h-3 w-3" />}
        {currentEstimate != null ? (compact ? 'Edit' : 'Edit estimate') : (compact ? 'Set' : 'Set estimate')}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="text-base font-bold text-gray-900 inline-flex items-center gap-2">
                  <Calculator className="h-4 w-4 text-blue-600" />
                  Internal Estimate
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">{subSkillLabel} · {lineType === 'work' ? 'Work' : 'Material'}</p>
              </div>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600">
                <X className="h-4 w-4" />
              </button>
            </div>

            {err && <p className="mb-3 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{err}</p>}

            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-gray-700">Full-scope estimate (₹)</label>
                <input
                  type="number" step="any" inputMode="decimal"
                  value={amount} onChange={e => setAmount(e.target.value)}
                  placeholder="e.g. 1500000"
                  className="mt-1 flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-mono"
                />
                <p className="text-[11px] text-gray-500 mt-1">
                  HOD&apos;s planning ceiling for this sub-skill. ERP releases tranches against this over time.
                </p>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700">Notes</label>
                <textarea
                  value={notes} onChange={e => setNotes(e.target.value)}
                  rows={2}
                  placeholder="optional — basis of estimate, assumptions, etc."
                  className="mt-1 flex w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" disabled={busy} onClick={save}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                Save
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
