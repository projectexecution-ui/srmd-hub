'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Loader2 } from 'lucide-react'
import { saveCthubName } from '@/app/actions/names'
import { SCOPES_FOR, type NameKind, type NameScope } from '@/lib/names'

/**
 * The pencil beside a name (name layer, Phase 3 — Aksha, 10 Sep 2026).
 *
 * Click → a small panel: the new name, and WHERE it should apply —
 * Everywhere · only in this module · only for this project — with Everywhere
 * as the default and a line saying what each choice means. Scopes that make
 * no sense for the kind are simply not offered. "Back to IN4 name" clears the
 * name at the chosen scope; the identity underneath is never touched.
 *
 * Drawn only for people who may name (lib/names-data.ts canName); the RPC
 * re-checks, so the pencil is a convenience, not the gate.
 */
export function NamePencil({
  kind, nameKey, shown, original, projectId, projectLabel, module, moduleLabel, currentScope, size = 'sm',
}: {
  kind: NameKind
  nameKey: string
  /** What the screen shows right now (a CT Hub name, or the original). */
  shown: string
  /** IN4's (or the registry's) own text — what "back to" returns to. */
  original: string
  projectId?: string | null
  projectLabel?: string | null
  /** The module this screen belongs to, when a category is being named there. */
  module?: string | null
  moduleLabel?: string | null
  /** Where the shown name came from, if it is a CT Hub name. */
  currentScope?: NameScope | null
  size?: 'sm' | 'xs'
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(shown === original ? '' : shown)
  const scopesAllowed = SCOPES_FOR[kind].filter(s => (s === 'module' ? !!module : s === 'project' ? !!projectId : true))
  const [scope, setScope] = useState<NameScope>(currentScope && scopesAllowed.includes(currentScope) ? currentScope : 'all')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const renamed = shown !== original

  async function save(clear = false) {
    setBusy(true); setErr(null)
    const r = await saveCthubName({
      kind, key: nameKey, scope,
      scopeId: scope === 'module' ? module : scope === 'project' ? projectId : '',
      display: clear ? '' : draft,
      projectId,
    })
    setBusy(false)
    if (!r.ok) { setErr(r.error ?? 'Could not save the name'); return }
    setOpen(false)
    router.refresh()
  }

  const iconCls = size === 'xs' ? 'h-3 w-3' : 'h-3.5 w-3.5'

  return (
    <span className="relative inline-flex items-center align-middle">
      <button
        type="button"
        onClick={e => { e.preventDefault(); e.stopPropagation(); setOpen(o => !o); setDraft(renamed ? shown : ''); setErr(null) }}
        className={`ml-1 inline-flex items-center rounded p-0.5 text-gray-300 hover:text-indigo-600 hover:bg-indigo-50 ${renamed ? 'text-indigo-400' : ''}`}
        title={renamed ? `CT Hub name. IN4: ${original}` : 'Rename what this is called in CT Hub'}
        aria-label="Rename"
      >
        <Pencil className={iconCls} />
      </button>

      {open && (
        <span
          className="absolute left-0 top-full z-30 mt-1 w-[300px] rounded-lg border border-gray-200 bg-white p-3 text-left text-[12px] shadow-lg font-normal"
          onClick={e => e.stopPropagation()}
        >
          <p className="text-gray-500 mb-1">IN4 calls this <span className="font-mono text-gray-700">{original}</span></p>
          <input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setOpen(false) }}
            placeholder="What should CT Hub call it?"
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-[13px] text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-200"
            autoFocus
            disabled={busy}
          />

          <p className="mt-2.5 text-[11px] uppercase tracking-wide text-gray-400">Where should it apply?</p>
          <div className="mt-1 space-y-1">
            {scopesAllowed.includes('all') && (
              <Choice on={scope === 'all'} set={() => setScope('all')} label="Everywhere" hint="Every project, every screen — the usual choice" />
            )}
            {scopesAllowed.includes('module') && (
              <Choice on={scope === 'module'} set={() => setScope('module')} label={`Only in ${moduleLabel ?? module}`} hint="Other screens keep the old name" />
            )}
            {scopesAllowed.includes('project') && (
              <Choice on={scope === 'project'} set={() => setScope('project')} label={`Only for ${projectLabel ?? 'this project'}`} hint="Every other project keeps the old name" />
            )}
          </div>

          <div className="mt-3 flex items-center gap-2">
            <button type="button" onClick={() => save()} disabled={busy || !draft.trim()}
              className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-2.5 py-1.5 text-[12px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Save
            </button>
            {renamed && (
              <button type="button" onClick={() => save(true)} disabled={busy}
                className="text-[12px] text-gray-500 hover:text-gray-800 underline-offset-2 hover:underline">
                Back to IN4 name
              </button>
            )}
            <button type="button" onClick={() => setOpen(false)} disabled={busy} className="ml-auto text-[12px] text-gray-400 hover:text-gray-700">Cancel</button>
          </div>
          {err && <p className="mt-2 text-[11px] text-rose-600">{err}</p>}
        </span>
      )}
    </span>
  )
}

function Choice({ on, set, label, hint }: { on: boolean; set: () => void; label: string; hint: string }) {
  return (
    <label className={`flex items-start gap-2 rounded-md border px-2 py-1.5 cursor-pointer ${on ? 'border-indigo-300 bg-indigo-50/60' : 'border-gray-200 hover:bg-gray-50'}`}>
      <input type="radio" checked={on} onChange={set} className="mt-0.5" />
      <span>
        <span className="block text-gray-900 font-medium">{label}</span>
        <span className="block text-[11px] text-gray-500">{hint}</span>
      </span>
    </label>
  )
}
