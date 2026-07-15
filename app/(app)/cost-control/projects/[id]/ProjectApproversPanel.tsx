'use client'
// Management names each project's approvers — Project Head, Atm Head,
// Trustee — so (Phase 2) only they get this project's approvals. Reviewer
// only. Collapsed by default to a one-line summary; expands to the editor
// on demand so it doesn't crowd the project page.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, X, Plus, UserRound, Pencil } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { setProjectApprover } from './actions'

type ApproverRole = 'project_head' | 'head' | 'founder'
type Person = { id: string; name: string }
type Approver = { role: ApproverRole; user_id: string; name: string }

const ROLE_ORDER: Array<{ role: ApproverRole; label: string; short: string; hint: string }> = [
  { role: 'project_head', label: 'Project Head', short: 'PH',      hint: 'Stage 1 — first sign-off' },
  { role: 'head',         label: 'Atm Head',     short: 'Atm',     hint: 'Stage 2 — second sign-off' },
  { role: 'founder',      label: 'Trustee',      short: 'Trustee', hint: 'Stage 3 — releases the budget' },
]

export function ProjectApproversPanel({
  projectId, approvers, candidates, canWrite,
}: {
  projectId: string
  approvers: Approver[]
  candidates: Person[]
  canWrite: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  const nameById = new Map(candidates.map(c => [c.id, c.name]))
  const anySet = approvers.length > 0

  function change(role: ApproverRole, userId: string, add: boolean) {
    if (!userId) return
    setErr(null)
    setBusyKey(`${role}:${userId}`)
    startTransition(async () => {
      const r = await setProjectApprover({ project_id: projectId, role, user_id: userId, add })
      setBusyKey(null)
      if (!r.ok) { setErr(r.error ?? 'Could not update approvers'); return }
      router.refresh()
    })
  }

  // ── Collapsed: a slim summary bar (default). ──
  if (!open) {
    const summary = ROLE_ORDER
      .map(({ short, role }) => {
        const names = approvers.filter(a => a.role === role).map(a => nameById.get(a.user_id) ?? a.name)
        return `${short}: ${names.length ? names.join(', ') : '—'}`
      })
      .join('   ·   ')
    return (
      <div className="rounded-lg border border-gray-200 bg-white px-4 py-2 flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0 text-xs text-gray-600 flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1.5 font-semibold text-gray-800">
            <UserRound className="h-3.5 w-3.5 text-indigo-600" /> Approvers
          </span>
          {anySet
            ? <span className="text-gray-500">{summary}</span>
            : <span className="text-gray-400">Not set — using the role-wide approvers</span>}
        </div>
        {canWrite && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-700 hover:underline whitespace-nowrap"
          >
            <Pencil className="h-3 w-3" /> {anySet ? 'Edit' : 'Set approvers'}
          </button>
        )}
      </div>
    )
  }

  // ── Expanded: the full editor. ──
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-2">
          <UserRound className="h-4 w-4 text-indigo-600" />
          <h2 className="text-sm font-bold text-gray-900">Approvers for this project</h2>
        </div>
        <button type="button" onClick={() => setOpen(false)} className="text-xs font-semibold text-gray-500 hover:text-gray-800">
          Done
        </button>
      </div>
      <p className="text-xs text-gray-500 mb-3">
        Name who signs off <b>this</b> project. Leave a stage empty to fall back to the current role-wide behaviour.
      </p>
      {err && <p className="text-xs text-rose-700 mb-2">{err}</p>}

      <div className="space-y-3">
        {ROLE_ORDER.map(({ role, label, hint }) => {
          const forRole = approvers.filter(a => a.role === role)
          const chosen = new Set(forRole.map(a => a.user_id))
          const remaining = candidates.filter(c => !chosen.has(c.id))
          return (
            <div key={role} className="rounded-md border border-gray-200 px-3 py-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-semibold text-gray-800">{label}</span>
                <span className="text-[10px] text-gray-400">{hint}</span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {forRole.length === 0 && (
                  <span className="text-[11px] text-gray-400">Not set — anyone with the {label} role can approve.</span>
                )}
                {forRole.map(a => (
                  <span key={a.user_id} className="inline-flex items-center gap-1 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-800 text-[11px] font-semibold px-2 py-0.5">
                    {nameById.get(a.user_id) ?? a.name}
                    {canWrite && (
                      <button
                        type="button"
                        onClick={() => change(role, a.user_id, false)}
                        disabled={pending}
                        className="text-indigo-400 hover:text-rose-600 disabled:opacity-50"
                        title="Remove"
                      >
                        {busyKey === `${role}:${a.user_id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                      </button>
                    )}
                  </span>
                ))}
                {canWrite && remaining.length > 0 && (
                  <span className="inline-flex items-center gap-1 text-[11px]">
                    <Plus className="h-3 w-3 text-gray-400" />
                    <select
                      defaultValue=""
                      disabled={pending}
                      onChange={e => { const v = e.target.value; e.currentTarget.value = ''; change(role, v, true) }}
                      className="text-[11px] border border-gray-200 rounded px-1 py-0.5 bg-white text-gray-700 max-w-[160px] disabled:opacity-50"
                    >
                      <option value="">Add…</option>
                      {remaining.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}
