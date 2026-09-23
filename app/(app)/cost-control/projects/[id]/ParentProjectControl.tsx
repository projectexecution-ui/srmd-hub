'use client'
// What kind of thing this project is, and what it sits under (Aksha, 23 Sep
// 2026, H1). Group → Project → Sub-project, three fixed levels. Admin-only;
// each pick saves at once. The parent list is filtered to what the kind
// allows — the reason a building like NGH A never appeared before is gone:
// choose Sub-project and every project is offered.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Check } from 'lucide-react'
import { setProjectParent, setProjectKind } from './actions'
import { KINDS, KIND_LABEL, KIND_HINT, allowedParents, kindChangeError, type ProjectKind } from '@/lib/projects/kind'

export interface KindOption { id: string; label: string; kind: ProjectKind; parentLabel?: string | null }

export function ParentProjectControl({
  projectId, kind: initialKind, currentParentId, options, childKinds, isAdmin,
}: {
  projectId: string
  kind: ProjectKind
  currentParentId: string | null
  /** Every live project except this one, with its kind. */
  options: KindOption[]
  /** The kinds of what sits under this project — decides what it may become. */
  childKinds: ProjectKind[]
  isAdmin: boolean
}) {
  const router = useRouter()
  const [kind, setKind] = useState<ProjectKind>(initialKind)
  const [parent, setParent] = useState(currentParentId ?? '')
  const [busy, setBusy] = useState<'kind' | 'parent' | null>(null)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const parents = allowedParents(kind, options, projectId)
  const currentParent = options.find(o => o.id === currentParentId)

  if (!isAdmin) {
    return (
      <p className="text-sm text-gray-700">
        {KIND_LABEL[kind]}{currentParent ? <> under <span className="font-medium">{currentParent.label}</span></> : ', top-level'}
        <span className="ml-2 text-xs text-gray-400">(an admin can change this)</span>
      </p>
    )
  }

  async function changeKind(next: ProjectKind) {
    const blocked = kindChangeError(next, childKinds)
    if (blocked) { setErr(blocked); return }
    setBusy('kind'); setErr(null); setSaved(false)
    const r = await setProjectKind(projectId, next)
    setBusy(null)
    if (!r.ok) { setErr(r.error ?? 'Could not change the kind'); return }
    setKind(next)
    if (r.parentId !== undefined) setParent(r.parentId ?? '')
    setSaved(true); router.refresh()
  }

  async function changeParent(next: string) {
    setBusy('parent'); setErr(null); setSaved(false)
    const r = await setProjectParent(projectId, next === '' ? null : next)
    setBusy(null)
    if (!r.ok) { setErr(r.error ?? 'Could not change the parent'); setParent(currentParentId ?? ''); return }
    setParent(next); setSaved(true); router.refresh()
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2" role="radiogroup" aria-label="Kind">
        {KINDS.map(k => {
          const on = k === kind
          const blocked = kindChangeError(k, childKinds)
          return (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={busy !== null || (!on && !!blocked)}
              title={blocked ?? KIND_HINT[k]}
              onClick={() => !on && changeKind(k)}
              className={`rounded-lg border p-2.5 text-left min-h-[44px] disabled:opacity-50 ${on ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white hover:bg-gray-50'}`}
            >
              <span className="block text-sm font-semibold text-gray-900">{KIND_LABEL[k]}</span>
              <span className="block text-[11px] text-gray-500 leading-snug">{KIND_HINT[k]}</span>
            </button>
          )
        })}
      </div>

      {kind !== 'group' && (
        <div className="flex items-center gap-2 flex-wrap">
          <label htmlFor="parent-pick" className="text-sm text-gray-700">{kind === 'project' ? 'In group' : 'Part of project'}</label>
          <select
            id="parent-pick"
            value={parent}
            onChange={e => changeParent(e.target.value)}
            disabled={busy !== null}
            className="h-10 rounded-md border border-gray-300 bg-white px-2.5 text-sm max-w-md disabled:opacity-50"
          >
            {kind === 'project'
              ? <option value="">None — stands on its own</option>
              : <option value="" disabled>— pick the project it belongs to —</option>}
            {parents.map(o => (
              <option key={o.id} value={o.id}>{o.label}{o.parentLabel ? ` · ${o.parentLabel}` : ''}</option>
            ))}
          </select>
          {busy && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
          {saved && !busy && <span className="inline-flex items-center gap-1 text-xs text-emerald-600"><Check className="h-3.5 w-3.5" /> Saved</span>}
        </div>
      )}
      {kind === 'group' && saved && !busy && <span className="inline-flex items-center gap-1 text-xs text-emerald-600"><Check className="h-3.5 w-3.5" /> Saved</span>}
      {err && <p className="text-xs text-rose-600">{err}</p>}
    </div>
  )
}
