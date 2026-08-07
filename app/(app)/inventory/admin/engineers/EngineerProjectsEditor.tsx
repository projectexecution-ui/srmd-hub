'use client'
// Assign each engineer to their project(s) — populates inv_engineer_projects,
// which scopes both the raise-request form and the weekly Site stock check.
// Tapping a chip assigns/unassigns. Tapping the star marks that engineer as the
// site's OWNER (is_primary) — the one accountable for the weekly count. Ownership
// is exclusive per site, so starring one engineer clears any other owner.

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/ui/card'
import { Check, Loader2, Star } from 'lucide-react'

type Engineer = { id: string; name: string }
type Project = { id: string; code: string; name: string }

export function EngineerProjectsEditor({
  engineers, projects, initial, owners,
}: {
  engineers: Engineer[]
  projects: Project[]
  initial: Record<string, string[]>  // engineer_id → project_ids
  owners: Record<string, string>     // project_id → owner engineer_id
}) {
  const [assigned, setAssigned] = useState<Record<string, Set<string>>>(() => {
    const m: Record<string, Set<string>> = {}
    for (const e of engineers) m[e.id] = new Set(initial[e.id] ?? [])
    return m
  })
  const [owner, setOwner] = useState<Record<string, string>>(owners) // project_id → engineer_id
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const supabase = createClient()

  async function toggle(engId: string, projId: string) {
    const key = `${engId}:${projId}`
    const on = assigned[engId]?.has(projId)
    setBusy(key); setError(null)
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
    // Removing an assignment that was the owner clears the ownership too.
    if (on && owner[projId] === engId) setOwner(prev => { const n = { ...prev }; delete n[projId]; return n })
  }

  async function toggleOwner(engId: string, projId: string) {
    const key = `owner:${engId}:${projId}`
    const isOwner = owner[projId] === engId
    setBusy(key); setError(null)
    const { error } = await supabase.rpc('inv_rpc_set_site_owner', {
      p_project: projId, p_engineer: isOwner ? null : engId,
    })
    setBusy(null)
    if (error) { setError(error.message); return }
    setOwner(prev => {
      const n = { ...prev }
      if (isOwner) delete n[projId]; else n[projId] = engId
      return n
    })
  }

  if (engineers.length === 0) {
    return <Card className="p-6 text-center text-sm text-gray-500">No engineers yet. Add users with the Engineer role first.</Card>
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <p className="text-xs text-gray-500">
        Tap a project to assign it. Tap the <Star className="inline h-3 w-3 text-amber-500 fill-amber-400 -mt-0.5" /> on an assigned
        project to make that engineer its <b>owner</b> — the one responsible for the weekly stock check. Engineers with no projects see <b>all</b> projects (safe default).
      </p>
      {engineers.map(e => {
        const set = assigned[e.id] ?? new Set<string>()
        const ownCount = projects.filter(p => owner[p.id] === e.id).length
        return (
          <Card key={e.id} className="p-3">
            <p className="text-sm font-semibold text-gray-900 mb-2">{e.name}
              <span className="ml-2 text-xs font-normal text-gray-500">
                {set.size === 0 ? 'all projects' : `${set.size} assigned`}{ownCount > 0 && ` · owns ${ownCount}`}
              </span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {projects.map(p => {
                const on = set.has(p.id)
                const isOwner = owner[p.id] === e.id
                const key = `${e.id}:${p.id}`
                const ownerKey = `owner:${e.id}:${p.id}`
                return (
                  <span key={p.id} className={`inline-flex items-center rounded-full border text-sm transition-colors ${on ? 'border-green-500 bg-green-50 text-green-800' : 'border-gray-200 text-gray-600'}`}>
                    <button type="button" onClick={() => toggle(e.id, p.id)} disabled={busy === key}
                      className="inline-flex items-center gap-1 pl-3 pr-2 py-2 hover:opacity-80">
                      {busy === key ? <Loader2 className="h-3 w-3 animate-spin" /> : on ? <Check className="h-3 w-3" /> : null}
                      {p.code}
                    </button>
                    {on && (
                      <button type="button" onClick={() => toggleOwner(e.id, p.id)} disabled={busy === ownerKey}
                        aria-label={isOwner ? `Remove ${e.name} as owner of ${p.code}` : `Make ${e.name} owner of ${p.code}`}
                        title={isOwner ? 'Owner — responsible for the weekly check' : 'Make owner'}
                        className="pr-2.5 pl-1 py-2">
                        {busy === ownerKey
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <Star className={`h-3.5 w-3.5 ${isOwner ? 'text-amber-500 fill-amber-400' : 'text-gray-300 hover:text-amber-400'}`} />}
                      </button>
                    )}
                  </span>
                )
              })}
            </div>
          </Card>
        )
      })}
    </div>
  )
}
