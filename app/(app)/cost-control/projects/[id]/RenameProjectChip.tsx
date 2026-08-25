'use client'
// Inline rename for the project — sits next to the AreaChip on the Internal
// Estimate header. Allowed for Cost-Control admins + coordinators (canRename);
// the name shows on every module, so it stays an admin/coordinator action.
// The CODE is never editable here (it's baked into WS codes).

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Loader2, Check, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { renameProject } from './actions'

export function RenameProjectChip({ projectId, name, canRename }: {
  projectId: string
  name: string
  canRename: boolean
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  if (!canRename) return null

  async function save() {
    const trimmed = draft.trim()
    if (trimmed.length < 2) { setErr('Name is too short'); return }
    if (trimmed === name) { setEditing(false); return }
    setBusy(true); setErr(null)
    const r = await renameProject(projectId, trimmed)
    setBusy(false)
    if (!r.ok) { setErr(r.error ?? 'Could not rename'); return }
    setEditing(false)
    router.refresh()
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => { setEditing(true); setDraft(name); setErr(null) }}
        className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-700 hover:border-blue-300 hover:text-blue-700"
        title="Rename this project — the new name shows everywhere"
      >
        <Pencil className="h-3 w-3" /> Rename
      </button>
    )
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <span className="inline-flex items-center gap-1">
        <Input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') save()
            else if (e.key === 'Escape') { setEditing(false); setErr(null) }
          }}
          placeholder="Project name"
          className="h-7 w-52 text-xs"
          autoFocus
          disabled={busy}
        />
        <button type="button" onClick={save} disabled={busy} className="text-emerald-600 hover:text-emerald-700 disabled:opacity-50" title="Save">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        </button>
        <button type="button" onClick={() => { setEditing(false); setDraft(name); setErr(null) }} disabled={busy} className="text-gray-400 hover:text-gray-600" title="Cancel">
          <X className="h-4 w-4" />
        </button>
      </span>
      {err && <span className="text-[10px] text-rose-600">{err}</span>}
    </span>
  )
}
