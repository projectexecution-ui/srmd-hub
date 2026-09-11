'use client'
// One card per project: who signs each stage, who works on it, who sees its
// indents, where its bills desk is set. Same rows as the People grids.

import { useState } from 'react'
import Link from 'next/link'
import { ArrowRight, X, Plus, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { indentNameFor, type Result } from '@/lib/revamp/people-grants'
import { setApprover, setAssignment, setIndentHidden } from './actions'
import type { PeopleData } from './PeopleClient'
import { Block, ToggleChip, Picker } from './CardBits'

const STAGES: Array<{ role: 'project_head' | 'head' | 'founder'; label: string }> = [
  { role: 'project_head', label: 'Project Head' }, { role: 'head', label: 'Atm Head' }, { role: 'founder', label: 'Trustee' },
]

export function ProjectCards({ data, busy, run, initialProject }: { data: PeopleData; busy: string | null; run: (k: string, fn: () => Promise<Result>) => void; initialProject?: string }) {
  const projects = [...data.projects].sort((a, b) => Number(a.isGroup) - Number(b.isGroup))
  const [cur, setCur] = useState<string>(initialProject && projects.some(p => p.id === initialProject) ? initialProject : (projects[0]?.id ?? ''))
  const [adding, setAdding] = useState<string | null>(null)
  const pr = projects.find(x => x.id === cur)
  if (!pr) return <p className="p-6 text-[13px] text-gray-400">No projects yet.</p>

  const people = data.people.filter(p => !/^anonymous$/i.test(p.name))
  const nameOf = new Map(people.map(p => [p.id, p.name]))
  const works = new Set(data.assignments.filter(a => a.project_id === pr.id).map(a => a.user_id))
  const indentName = indentNameFor(pr, data.indentProjects)
  const hiddenFor = new Set(indentName ? data.hiddenIndents.filter(h => h.project_name === indentName).map(h => h.user_id) : [])
  const k = (c: string) => `${pr.id}|${c}`
  const eligible = (role: string) => people.filter(p => p.ccRole === role || p.role === 'admin')

  return (
    <div className="flex flex-col gap-4">
      <Picker items={projects.map(x => ({ key: x.id, label: x.label, sub: x.isGroup ? 'group' : undefined }))} value={cur} onPick={setCur} placeholder="Find a project" />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="flex flex-col gap-4">
          <Block title="Who signs, in order" hint={pr.isGroup ? 'A group rolls up its children; its own signers are optional.' : 'Amber means nobody is named, so the inbox falls back to anyone holding that role.'}>
            {STAGES.map(s => {
              const holders = data.approvers.filter(a => a.project_id === pr.id && a.role === s.role)
              const missing = holders.length === 0 && !pr.isGroup
              const cellKey = k(s.role)
              return (
                <div key={s.role} className={cn('grid grid-cols-[110px_1fr] gap-2 items-start py-2 border-t border-gray-100 first:border-t-0 rounded-md', missing && 'bg-amber-50/70 -mx-2 px-2')}>
                  <span className="text-[14px] text-gray-900 pt-1">{s.label}</span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {holders.map(h => (
                      <span key={h.user_id} className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white pl-3 pr-1 py-0.5 text-[13px] text-gray-800 min-h-[32px]">
                        {nameOf.get(h.user_id) ?? 'Unknown'}
                        <button type="button" title="Remove" disabled={busy === `${cellKey}|${h.user_id}`} onClick={() => run(`${cellKey}|${h.user_id}`, () => setApprover(pr.id, s.role, h.user_id, false))}
                          className="inline-flex h-6 w-6 items-center justify-center rounded-full text-gray-400 hover:text-rose-600 hover:bg-rose-50">
                          {busy === `${cellKey}|${h.user_id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                        </button>
                      </span>
                    ))}
                    {adding === cellKey ? (
                      <select autoFocus defaultValue="" aria-label={`Add a ${s.label}`} onBlur={() => setAdding(null)}
                        onChange={e => { const uid = e.target.value; setAdding(null); if (uid) run(`${cellKey}|${uid}`, () => setApprover(pr.id, s.role, uid, true)) }}
                        className="h-8 rounded-lg border border-gray-300 text-[13px] px-1 max-w-[200px]">
                        <option value="">Pick…</option>
                        {eligible(s.role).filter(p => !holders.some(h => h.user_id === p.id)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    ) : (
                      <button type="button" onClick={() => setAdding(cellKey)}
                        className={cn('inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[12px] min-h-[32px]', missing ? 'border-amber-400 bg-white text-amber-900 font-semibold' : 'border-dashed border-gray-300 text-gray-500 hover:text-gray-800 hover:border-gray-400')}>
                        <Plus className="h-3 w-3" />{missing ? 'set — nobody signs this' : 'add'}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
            <p className="text-[12px] text-gray-400">Only people whose Cost Control role matches the stage are offered.</p>
          </Block>

          <Block title="Bills desk" hint="Who moves this project’s bills between stages">
            <Link href="/bills-booking/admin" className="inline-flex items-center gap-1 text-[13px] font-semibold text-indigo-700 hover:underline min-h-[36px]">Open the bills desks <ArrowRight className="h-3 w-3" /></Link>
          </Block>
        </div>

        <div className="flex flex-col gap-4">
          <Block title="Who works on it" hint={pr.isGroup ? 'People are assigned to the projects inside a group, not the group.' : 'Lit means assigned'}>
            {!pr.isGroup && (
              <div className="flex flex-wrap gap-1.5">
                {people.map(p => {
                  const on = works.has(p.id)
                  return <ToggleChip key={p.id} on={on} busy={busy === k(p.id)} label={p.name} title={p.roleLabel} onClick={() => run(k(p.id), () => setAssignment(p.id, pr.id, !on))} />
                })}
              </div>
            )}
          </Block>

          <Block title="Who sees its indents" hint={indentName ? `IN4 calls it “${indentName}”. Unlit means hidden from that person on the tracker.` : 'IN4 has no project by this name, so there are no indents to show or hide.'}>
            {indentName && (
              <div className="flex flex-wrap gap-1.5">
                {people.map(p => {
                  const on = !hiddenFor.has(p.id)
                  return <ToggleChip key={p.id} on={on} busy={busy === k('ind|' + p.id)} label={p.name} title={p.roleLabel} onClick={() => run(k('ind|' + p.id), () => setIndentHidden(p.id, indentName, on))} />
                })}
              </div>
            )}
          </Block>

          <Block title="Everything else about this project">
            <Link href={`/cost-control/projects/${pr.id}/setup`} className="inline-flex items-center gap-1 text-[13px] font-semibold text-indigo-700 hover:underline min-h-[36px]">Project setup — code, area, budget source <ArrowRight className="h-3 w-3" /></Link>
          </Block>
        </div>
      </div>
    </div>
  )
}
