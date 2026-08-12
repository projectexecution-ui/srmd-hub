'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/ui/card'
import { toast } from 'sonner'
import { Plus, X, Loader2 } from 'lucide-react'

export type Override = { projectId: string; userId: string }
export type DeskState = { global: string | null; overrides: Override[] }
type User = { id: string; name: string }
type Project = { id: string; code: string }

export function DeskOwnersEditor({ desks, users, projects, initial }: {
  desks: { key: string; label: string }[]
  users: User[]
  projects: Project[]
  initial: Record<string, DeskState>
}) {
  const supabase = createClient()
  const [state, setState] = useState<Record<string, DeskState>>(initial)
  const [busy, setBusy] = useState<string | null>(null)
  const sel = 'h-9 rounded-lg border border-gray-300 bg-white px-2 text-sm'

  async function save(desk: string, project: string | null, user: string | null, key: string) {
    setBusy(key)
    const { error } = await supabase.rpc('bb_rpc_set_desk_owner', { p_desk: desk, p_project: project, p_user: user })
    setBusy(null)
    if (error) { toast.error(error.message); return false }
    return true
  }

  async function setGlobal(desk: string, userId: string) {
    const ok = await save(desk, null, userId || null, `g:${desk}`)
    if (ok) setState(s => ({ ...s, [desk]: { ...s[desk], global: userId || null } }))
  }
  async function setOverride(desk: string, projectId: string, userId: string) {
    if (!projectId) return
    const ok = await save(desk, projectId, userId || null, `o:${desk}:${projectId}`)
    if (!ok) return
    setState(s => {
      const ov = s[desk].overrides.filter(o => o.projectId !== projectId)
      if (userId) ov.push({ projectId, userId })
      return { ...s, [desk]: { ...s[desk], overrides: ov } }
    })
  }

  return (
    <div className="space-y-3">
      {desks.map(d => {
        const st = state[d.key]
        const usedProjects = new Set(st.overrides.map(o => o.projectId))
        return (
          <Card key={d.key} className="p-4 space-y-3">
            <p className="text-sm font-bold text-gray-900">{d.label}</p>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-gray-500">Default (all projects)</span>
              <select className={sel} value={st.global ?? ''} onChange={e => setGlobal(d.key, e.target.value)} disabled={busy === `g:${d.key}`}>
                <option value="">— none —</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
              {busy === `g:${d.key}` && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
            </div>

            {st.overrides.length > 0 && (
              <div className="space-y-1.5 border-t border-gray-100 pt-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Per-project overrides</p>
                {st.overrides.map(o => {
                  const proj = projects.find(p => p.id === o.projectId)
                  return (
                    <div key={o.projectId} className="flex flex-wrap items-center gap-2">
                      <span className="w-16 shrink-0 rounded bg-slate-800 px-1.5 py-0.5 text-center text-[11px] font-bold text-white">{proj?.code ?? '—'}</span>
                      <select className={sel} value={o.userId} onChange={e => setOverride(d.key, o.projectId, e.target.value)} disabled={busy === `o:${d.key}:${o.projectId}`}>
                        {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                      </select>
                      <button onClick={() => setOverride(d.key, o.projectId, '')} disabled={busy === `o:${d.key}:${o.projectId}`}
                        aria-label="Remove override" className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-rose-600">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}

            <AddOverride desk={d.key} users={users}
              projects={projects.filter(p => !usedProjects.has(p.id))}
              onAdd={(proj, user) => setOverride(d.key, proj, user)} />
          </Card>
        )
      })}
    </div>
  )
}

function AddOverride({ desk, users, projects, onAdd }: {
  desk: string; users: User[]; projects: Project[]; onAdd: (projectId: string, userId: string) => void
}) {
  const [proj, setProj] = useState('')
  const [user, setUser] = useState('')
  const sel = 'h-9 rounded-lg border border-gray-300 bg-white px-2 text-sm'
  if (projects.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-2">
      <span className="text-[11px] text-gray-400">Add override</span>
      <select className={sel} value={proj} onChange={e => setProj(e.target.value)}>
        <option value="">Project…</option>
        {projects.map(p => <option key={p.id} value={p.id}>{p.code}</option>)}
      </select>
      <select className={sel} value={user} onChange={e => setUser(e.target.value)}>
        <option value="">User…</option>
        {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
      </select>
      <button onClick={() => { if (proj && user) { onAdd(proj, user); setProj(''); setUser('') } }}
        disabled={!proj || !user}
        className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
        <Plus className="h-3.5 w-3.5" /> Add
      </button>
      <input type="hidden" value={desk} readOnly />
    </div>
  )
}
