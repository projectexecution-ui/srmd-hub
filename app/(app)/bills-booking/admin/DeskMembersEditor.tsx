'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/ui/card'
import { toast } from 'sonner'
import { X, Plus } from 'lucide-react'

export type DeskState = { global: string[]; overrides: Record<string, string[]> }
type User = { id: string; name: string }
type Project = { id: string; code: string }

export function DeskMembersEditor({ desks, users, projects, initial }: {
  desks: { key: string; label: string }[]
  users: User[]
  projects: Project[]
  initial: Record<string, DeskState>
}) {
  const supabase = createClient()
  const [state, setState] = useState<Record<string, DeskState>>(initial)
  const nameOf = (id: string) => users.find(u => u.id === id)?.name ?? '—'

  async function add(desk: string, project: string | null, user: string) {
    const { error } = await supabase.rpc('bb_rpc_add_desk_member', { p_desk: desk, p_project: project, p_user: user })
    if (error) { toast.error(error.message); return }
    setState(s => {
      const st = { ...s[desk], overrides: { ...s[desk].overrides } }
      if (project == null) st.global = [...new Set([...st.global, user])]
      else st.overrides[project] = [...new Set([...(st.overrides[project] ?? []), user])]
      return { ...s, [desk]: st }
    })
  }
  async function remove(desk: string, project: string | null, user: string) {
    const { error } = await supabase.rpc('bb_rpc_remove_desk_member', { p_desk: desk, p_project: project, p_user: user })
    if (error) { toast.error(error.message); return }
    setState(s => {
      const st = { ...s[desk], overrides: { ...s[desk].overrides } }
      if (project == null) st.global = st.global.filter(u => u !== user)
      else {
        const left = (st.overrides[project] ?? []).filter(u => u !== user)
        if (left.length) st.overrides[project] = left; else delete st.overrides[project]
      }
      return { ...s, [desk]: st }
    })
  }

  return (
    <div className="space-y-3">
      {desks.map(d => {
        const st = state[d.key]
        const overrideProjectIds = Object.keys(st.overrides)
        const freeProjects = projects.filter(p => !overrideProjectIds.includes(p.id))
        return (
          <Card key={d.key} className="p-4 space-y-3">
            <p className="text-sm font-bold text-gray-900">{d.label}</p>

            <MemberRow label="Default (all projects)" members={st.global} users={users} nameOf={nameOf}
              onAdd={u => add(d.key, null, u)} onRemove={u => remove(d.key, null, u)} />

            {overrideProjectIds.length > 0 && (
              <div className="space-y-2 border-t border-gray-100 pt-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Per-project overrides</p>
                {overrideProjectIds.map(pid => (
                  <MemberRow key={pid} label={projects.find(p => p.id === pid)?.code ?? '—'} chip members={st.overrides[pid]} users={users} nameOf={nameOf}
                    onAdd={u => add(d.key, pid, u)} onRemove={u => remove(d.key, pid, u)} />
                ))}
              </div>
            )}

            <AddProjectOverride projects={freeProjects} users={users} onAdd={(pid, u) => add(d.key, pid, u)} />
          </Card>
        )
      })}
    </div>
  )
}

function MemberRow({ label, members, users, nameOf, onAdd, onRemove, chip }: {
  label: string; members: string[]; users: User[]; nameOf: (id: string) => string
  onAdd: (u: string) => void; onRemove: (u: string) => void; chip?: boolean
}) {
  const [pick, setPick] = useState('')
  const free = users.filter(u => !members.includes(u.id))
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={chip ? 'w-16 shrink-0 rounded bg-slate-800 px-1.5 py-0.5 text-center text-[11px] font-bold text-white' : 'text-xs font-medium text-gray-500'}>{label}</span>
      {members.map(u => (
        <span key={u} className="inline-flex items-center gap-1 rounded-full bg-indigo-50 py-0.5 pl-2.5 pr-1 text-xs font-semibold text-indigo-800">
          {nameOf(u)}
          <button onClick={() => onRemove(u)} aria-label={`Remove ${nameOf(u)}`} className="flex h-4 w-4 items-center justify-center rounded-full hover:bg-indigo-200"><X className="h-3 w-3" /></button>
        </span>
      ))}
      {members.length === 0 && !chip && <span className="text-[11px] text-gray-400">none</span>}
      {free.length > 0 && (
        <select value={pick} onChange={e => { if (e.target.value) { onAdd(e.target.value); setPick('') } }}
          className="h-8 rounded-lg border border-gray-300 bg-white px-2 text-xs text-gray-600">
          <option value="">+ add…</option>
          {free.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      )}
    </div>
  )
}

function AddProjectOverride({ projects, users, onAdd }: {
  projects: Project[]; users: User[]; onAdd: (projectId: string, userId: string) => void
}) {
  const [proj, setProj] = useState('')
  const [user, setUser] = useState('')
  const sel = 'h-8 rounded-lg border border-gray-300 bg-white px-2 text-xs'
  if (projects.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-2">
      <span className="text-[11px] text-gray-400">Override a project</span>
      <select className={sel} value={proj} onChange={e => setProj(e.target.value)}>
        <option value="">Project…</option>
        {projects.map(p => <option key={p.id} value={p.id}>{p.code}</option>)}
      </select>
      <select className={sel} value={user} onChange={e => setUser(e.target.value)}>
        <option value="">User…</option>
        {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
      </select>
      <button onClick={() => { if (proj && user) { onAdd(proj, user); setProj(''); setUser('') } }} disabled={!proj || !user}
        className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
        <Plus className="h-3.5 w-3.5" /> Add
      </button>
    </div>
  )
}
