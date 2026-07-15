'use client'
// Admin-only inline editor for the project ALIAS (short `code` badge) — sits
// on the Internal Estimate header next to Rename + Area. The alias is the
// short label shown everywhere and the prefix on NEW Working-Sheet codes;
// existing sheet codes keep their old prefix.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Loader2, Check, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { setProjectAlias } from './actions'

export function ProjectAliasChip({ projectId, code, isAdmin }: {
  projectId: string
  code: string
  isAdmin: boolean
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(code)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  if (!isAdmin) return null

  async function save() {
    const trimmed = draft.trim()
    if (trimmed.length < 1) { setErr('Alias is required'); return }
    if (trimmed === code) { setEditing(false); return }
    setBusy(true); setErr(null)
    const r = await setProjectAlias(projectId, trimmed)
    setBusy(false)
    if (!r.ok) { setErr(r.error ?? 'Could not save the alias'); return }
    setEditing(false)
    router.refresh()
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => { setEditing(true); setDraft(code); setErr(null) }}
        className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-700 hover:border-blue-300 hover:text-blue-700"
        title="Change the short alias (Admin only). New Working Sheet codes use it; existing sheet codes keep their old prefix."
      >
        Alias: <span className="font-mono font-semibold">{code}</span>
        <Pencil className="h-3 w-3" />
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
          placeholder="e.g. A"
          className="h-7 w-24 text-xs font-mono"
          autoFocus
          disabled={busy}
        />
        <button type="button" onClick={save} disabled={busy} className="text-emerald-600 hover:text-emerald-700 disabled:opacity-50" title="Save">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        </button>
        <button type="button" onClick={() => { setEditing(false); setDraft(code); setErr(null) }} disabled={busy} className="text-gray-400 hover:text-gray-600" title="Cancel">
          <X className="h-4 w-4" />
        </button>
      </span>
      <span className="text-[10px] text-gray-400">New WS codes use this; old codes keep their prefix.</span>
      {err && <span className="text-[10px] text-rose-600">{err}</span>}
    </span>
  )
}
