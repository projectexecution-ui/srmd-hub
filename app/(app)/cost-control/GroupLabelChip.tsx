'use client'
// Admin-only inline editor for a project GROUP's display name, shown on the
// dashboard group band. Saves to the parent project's group_label; clearing
// it falls the band back to the parent's short code.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Loader2, Check, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { setProjectGroupLabel } from './projects/[id]/actions'

export function GroupLabelChip({ projectId, label, isAdmin }: {
  projectId: string
  /** The label currently shown on the band (custom name, or the code). */
  label: string
  isAdmin: boolean
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(label)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  if (!isAdmin) {
    return <>{label}</>
  }

  async function save() {
    setBusy(true); setErr(null)
    const trimmed = draft.trim()
    const r = await setProjectGroupLabel(projectId, trimmed === '' ? null : trimmed)
    setBusy(false)
    if (!r.ok) { setErr(r.error ?? 'Could not rename the group'); return }
    setEditing(false)
    router.refresh()
  }

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-1.5">
        {label}
        <button
          type="button"
          onClick={() => { setEditing(true); setDraft(label); setErr(null) }}
          className="text-indigo-400 hover:text-indigo-700"
          title="Rename this group (Admin only). Leave blank to use the project code."
        >
          <Pencil className="h-3 w-3" />
        </button>
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1 align-middle">
      <Input
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') save()
          else if (e.key === 'Escape') { setEditing(false); setErr(null) }
        }}
        placeholder="Group name (blank = code)"
        className="h-6 w-48 text-xs normal-case"
        autoFocus
        disabled={busy}
      />
      <button type="button" onClick={save} disabled={busy} className="text-emerald-600 hover:text-emerald-700 disabled:opacity-50" title="Save">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
      </button>
      <button type="button" onClick={() => { setEditing(false); setDraft(label); setErr(null) }} disabled={busy} className="text-gray-400 hover:text-gray-600" title="Cancel">
        <X className="h-4 w-4" />
      </button>
      {err && <span className="text-[10px] text-rose-600 normal-case font-normal">{err}</span>}
    </span>
  )
}
