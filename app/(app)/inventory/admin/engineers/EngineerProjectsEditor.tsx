'use client'
// Assign each engineer to their project(s). Populates inv_engineer_projects,
// which scopes the project dropdown on the raise-request form. Toggling a chip
// inserts/deletes the row (RLS allows inventory-edit writes). No Save step.

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/ui/card'
import { Check, Loader2 } from 'lucide-react'

type Engineer = { id: string; name: string }
type Project = { id: string; code: string; name: string }

export function EngineerProjectsEditor({
  engineers, projects, initial,
}: {
  engineers: Engineer[]
  projects: Project[]
  initial: Record<string, string[]> // engineer_id → project_ids
}) {
  const [assigned, setAssigned] = useState<Record<string, Set<string>>>(() => {
    const m: Record<string, Set<string>> = {}
    for (const e of engineers) m[e.id] = new Set(initial[e.id] ?? [])
    return m
  })
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function toggle(engId: string, projId: string) {
    const key = `${engId}:${projId}`
    const on = assigned[engId]?.has(projId)
    setBusy(key); setError(null)
    const supabase = createClient()
    const { error } = on
      ? await supabase.from('inv_engineer_projects').delete().eq('engineer_id', engId).eq('project_id', projId)
      : await supabase.from('inv_engineer_projects').insert({ engineer_id: engId, project_id: projId })
    setBusy(null)
    if (error) { setError(error.message); return }
    setAssigned(prev => {
      const next = new Set(prev[engId])
      if (on) next.delete(projId); else next.add(projId)
      return { ...prev, [engId]: next }
    })
  }

  if (engineers.length === 0) {
    return <Card className="p-6 text-center text-sm text-gray-500">No engineers yet. Add users with the Engineer role first.</Card>
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <p className="text-xs text-gray-500">
        Tap a project to assign it to that engineer. Engineers with no projects assigned see <b>all</b> projects (safe default).
      </p>
      {engineers.map(e => {
        const set = assigned[e.id] ?? new Set<string>()
        return (
          <Card key={e.id} className="p-3">
            <p className="text-sm font-semibold text-gray-900 mb-2">{e.name}
              <span className="ml-2 text-xs font-normal text-gray-500">{set.size === 0 ? 'all projects' : `${set.size} assigned`}</span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {projects.map(p => {
                const on = set.has(p.id)
                const key = `${e.id}:${p.id}`
                return (
                  <button key={p.id} type="button" onClick={() => toggle(e.id, p.id)} disabled={busy === key}
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors ${on ? 'border-green-500 bg-green-50 text-green-800' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                    {busy === key ? <Loader2 className="h-3 w-3 animate-spin" /> : on ? <Check className="h-3 w-3" /> : null}
                    {p.code}
                  </button>
                )
              })}
            </div>
          </Card>
        )
      })}
    </div>
  )
}
