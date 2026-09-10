'use client'
// Admin-only inline editor for the project's SHORT NAME — the chip people see
// on the ribbon header, the Projects landing and the group roll-up. Display
// only (name layer, Phase 1; Aksha, 10 Sep 2026): the CODE underneath is
// untouched, so Working-Sheet numbers and the IN4 matcher never move.
//
// This chip used to be labelled "Alias" and rewrote projects.code. Changing the
// code is still possible, admin-only, behind the small "Change code…" link with
// a warning — because it is a key, not a label.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Loader2, Check, X, KeyRound } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { setProjectShortName, setProjectCode } from './actions'

export function ProjectAliasChip({ projectId, code, shortName, isAdmin }: {
  projectId: string
  code: string
  shortName: string | null
  isAdmin: boolean
}) {
  const router = useRouter()
  const [mode, setMode] = useState<'view' | 'short' | 'code'>('view')
  const [draft, setDraft] = useState(shortName ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  if (!isAdmin) return null

  function open(next: 'short' | 'code') {
    setMode(next)
    setDraft(next === 'short' ? (shortName ?? '') : code)
    setErr(null); setNote(null)
  }
  function close() { setMode('view'); setErr(null) }

  async function saveShort() {
    const trimmed = draft.trim()
    if (trimmed === (shortName ?? '')) { close(); return }
    setBusy(true); setErr(null)
    const r = await setProjectShortName(projectId, trimmed)
    setBusy(false)
    if (!r.ok) { setErr(r.error ?? 'Could not save the short name'); return }
    if (r.sharedWith && r.sharedWith.length) setNote(`Also used by ${r.sharedWith.join(', ')} — fine in context, just so you know.`)
    setMode('view')
    router.refresh()
  }

  async function saveCode() {
    const trimmed = draft.trim()
    if (trimmed.length < 1) { setErr('Code is required'); return }
    if (trimmed === code) { close(); return }
    setBusy(true); setErr(null)
    const r = await setProjectCode(projectId, trimmed)
    setBusy(false)
    if (!r.ok) { setErr(r.error ?? 'Could not change the code'); return }
    setMode('view')
    router.refresh()
  }

  if (mode === 'view') {
    const shown = (shortName ?? '').trim() || code
    return (
      <span className="inline-flex flex-col gap-1">
        <span className="inline-flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => open('short')}
            className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-700 hover:border-blue-300 hover:text-blue-700"
            title="Short name — what the chip shows on the header, the Projects list and cards. Display only; the code is unchanged."
          >
            Short name: <span className="font-mono font-semibold">{shown}</span>
            {!(shortName ?? '').trim() && <span className="text-gray-400 font-normal">(code)</span>}
            <Pencil className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => open('code')}
            className="inline-flex items-center gap-1 text-[11px] text-gray-400 hover:text-amber-700"
            title="Change the project CODE — the prefix on new Working-Sheet numbers and a matching key. Admin only."
          >
            <KeyRound className="h-3 w-3" /> Code {code} · change…
          </button>
        </span>
        {note && <span className="text-[10px] text-gray-500">{note}</span>}
      </span>
    )
  }

  const isCode = mode === 'code'
  return (
    <span className="inline-flex flex-col gap-1">
      <span className="inline-flex items-center gap-1">
        <Input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') (isCode ? saveCode : saveShort)()
            else if (e.key === 'Escape') close()
          }}
          placeholder={isCode ? 'e.g. NGHCE' : 'e.g. NGH Common (blank = show the code)'}
          className={`h-7 text-xs ${isCode ? 'w-28 font-mono' : 'w-48'}`}
          autoFocus
          disabled={busy}
        />
        <button type="button" onClick={isCode ? saveCode : saveShort} disabled={busy} className="text-emerald-600 hover:text-emerald-700 disabled:opacity-50" title="Save">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        </button>
        <button type="button" onClick={close} disabled={busy} className="text-gray-400 hover:text-gray-600" title="Cancel">
          <X className="h-4 w-4" />
        </button>
      </span>
      {isCode ? (
        <span className="text-[10px] text-amber-700 max-w-[300px] leading-snug">
          This changes the project’s real code. New Working Sheets take the new prefix; existing sheet codes keep the old one. It is also the last-resort match key for IN4 sub-projects. Logged to the audit.
        </span>
      ) : (
        <span className="text-[10px] text-gray-400 max-w-[300px] leading-snug">
          Display only — shows on the header chip, Projects list and cards. The code stays <span className="font-mono">{code}</span>. Blank goes back to showing the code.
        </span>
      )}
      {err && <span className="text-[10px] text-rose-600">{err}</span>}
    </span>
  )
}
