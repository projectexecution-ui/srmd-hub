'use client'
// Change which project this one sits under (grouping). Admin-only; auto-saves
// on pick. One level deep — the options are top-level projects only (the
// server action enforces the same rule and rejects cycles).

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Check } from 'lucide-react'
import { setProjectParent } from './actions'

export function ParentProjectControl({
  projectId, currentParentId, options, isAdmin,
}: {
  projectId: string
  currentParentId: string | null
  /** Eligible top-level projects (self + own children already excluded). */
  options: Array<{ id: string; label: string }>
  isAdmin: boolean
}) {
  const router = useRouter()
  const [value, setValue] = useState(currentParentId ?? '')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const currentLabel = options.find(o => o.id === currentParentId)?.label ?? 'Top-level (no parent)'

  if (!isAdmin) {
    return (
      <p className="text-sm text-gray-700">
        Parent: <span className="font-medium">{currentLabel}</span>
        <span className="ml-2 text-xs text-gray-400">(Admin can change this)</span>
      </p>
    )
  }

  async function save(next: string) {
    setBusy(true); setErr(null); setSaved(false)
    const r = await setProjectParent(projectId, next === '' ? null : next)
    setBusy(false)
    if (!r.ok) { setErr(r.error ?? 'Could not change the parent'); setValue(currentParentId ?? ''); return }
    setSaved(true); router.refresh()
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <select
          value={value}
          onChange={e => { setValue(e.target.value); save(e.target.value) }}
          disabled={busy}
          className="h-9 rounded-md border border-gray-300 bg-white px-2.5 text-sm max-w-xs disabled:opacity-50"
        >
          <option value="">Top-level (no parent)</option>
          {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        {busy && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
        {saved && !busy && (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
            <Check className="h-3.5 w-3.5" /> Saved
          </span>
        )}
      </div>
      {err && <p className="text-xs text-rose-600">{err}</p>}
    </div>
  )
}
