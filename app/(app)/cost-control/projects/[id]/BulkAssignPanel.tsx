'use client'
// Phase 5 — faster sub-skill assignment. Two bulk shortcuts so management
// doesn't pick an engineer row-by-row: assign a whole discipline to one
// engineer, or copy another project's assignments. Collapsed by default.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Users, ChevronRight, Check } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { bulkAssignDisciplineEngineer, copySubSkillAssignments } from './actions'

type Opt = { id: string; label: string }

export function BulkAssignPanel({
  projectId, disciplines, engineers, otherProjects,
}: {
  projectId: string
  disciplines: Opt[]
  engineers: Opt[]
  otherProjects: Opt[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [disc, setDisc] = useState('')
  const [eng, setEng] = useState('')
  const [fromProj, setFromProj] = useState('')
  const [busy, startTransition] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  function applyDiscipline() {
    setErr(null); setMsg(null)
    if (!disc) { setErr('Pick a discipline'); return }
    startTransition(async () => {
      const r = await bulkAssignDisciplineEngineer({ project_id: projectId, discipline_id: disc, engineer_id: eng || null })
      if (!r.ok) { setErr(r.error ?? 'Failed'); return }
      setMsg(`${eng ? 'Assigned' : 'Cleared'} ${r.count ?? 0} sub-skill${(r.count ?? 0) === 1 ? '' : 's'}.`)
      router.refresh()
    })
  }

  function applyCopy() {
    setErr(null); setMsg(null)
    if (!fromProj) { setErr('Pick a project to copy from'); return }
    startTransition(async () => {
      const r = await copySubSkillAssignments({ project_id: projectId, from_project_id: fromProj })
      if (!r.ok) { setErr(r.error ?? 'Failed'); return }
      setMsg(`Copied ${r.count ?? 0} assignment${(r.count ?? 0) === 1 ? '' : 's'}.`)
      router.refresh()
    })
  }

  if (!open) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white px-4 py-2 flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-800">
          <Users className="h-3.5 w-3.5 text-indigo-600" /> Bulk-assign engineers
        </span>
        <button type="button" onClick={() => setOpen(true)} className="text-xs font-semibold text-indigo-700 hover:underline whitespace-nowrap">
          Open
        </button>
      </div>
    )
  }

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <span className="inline-flex items-center gap-1.5 text-sm font-bold text-gray-900">
          <Users className="h-4 w-4 text-indigo-600" /> Bulk-assign engineers
        </span>
        <button type="button" onClick={() => setOpen(false)} className="text-xs font-semibold text-gray-500 hover:text-gray-800">Done</button>
      </div>
      {err && <p className="text-xs text-rose-700 mb-2">{err}</p>}
      {msg && <p className="text-xs text-emerald-700 mb-2">{msg}</p>}

      <div className="space-y-3">
        {/* Assign a whole discipline to one engineer */}
        <div className="rounded-md border border-gray-200 px-3 py-2.5">
          <p className="text-xs font-semibold text-gray-800 mb-1.5 inline-flex items-center gap-1">
            <ChevronRight className="h-3 w-3 text-gray-400" /> Assign a whole discipline to one engineer
          </p>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <select value={disc} onChange={e => setDisc(e.target.value)} disabled={busy} className="border border-gray-200 rounded px-1.5 py-1 bg-white text-gray-700 max-w-[220px]">
              <option value="">Discipline…</option>
              {disciplines.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
            <span className="text-gray-400">→</span>
            <select value={eng} onChange={e => setEng(e.target.value)} disabled={busy} className="border border-gray-200 rounded px-1.5 py-1 bg-white text-gray-700 max-w-[180px]">
              <option value="">Unassign (clear)</option>
              {engineers.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
            <button type="button" onClick={applyDiscipline} disabled={busy} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Apply
            </button>
          </div>
          <p className="text-[10px] text-gray-400 mt-1">Sets every sub-skill under that discipline at once.</p>
        </div>

        {/* Copy from another project */}
        {otherProjects.length > 0 && (
          <div className="rounded-md border border-gray-200 px-3 py-2.5">
            <p className="text-xs font-semibold text-gray-800 mb-1.5 inline-flex items-center gap-1">
              <ChevronRight className="h-3 w-3 text-gray-400" /> Copy assignments from another project
            </p>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <select value={fromProj} onChange={e => setFromProj(e.target.value)} disabled={busy} className="border border-gray-200 rounded px-1.5 py-1 bg-white text-gray-700 max-w-[240px]">
                <option value="">Copy from…</option>
                {otherProjects.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
              <button type="button" onClick={applyCopy} disabled={busy} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Copy
              </button>
            </div>
            <p className="text-[10px] text-gray-400 mt-1">Copies the engineer for each sub-skill that also exists here.</p>
          </div>
        )}
      </div>
    </Card>
  )
}
