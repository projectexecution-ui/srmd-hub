'use client'
// The six People grids. One shared Grid shell (pinned first column, pinned
// header, search, hide-Anonymous), one cell type per grid.

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2, AlertTriangle, Search, X, Plus, Bell, Mail, Smartphone, Send, EyeOff, Eye } from 'lucide-react'
import { cn } from '@/lib/utils'
import { setGrant, setApprover, setAssignment, setIndentHidden, setBillsAssignment, setChannel } from './actions'
import type { GrantKey, Result } from '@/lib/revamp/people-grants'

export interface Person { id: string; name: string; role: string; roleLabel: string; ccRole: string }
export interface ProjectRow { id: string; label: string; name: string; isGroup: boolean }
export interface PeopleData {
  people: Person[]
  projects: ProjectRow[]
  grants: Record<GrantKey, string[]>
  approvers: Array<{ project_id: string; user_id: string; role: string }>
  assignments: Array<{ user_id: string; project_id: string }>
  hiddenIndents: Array<{ user_id: string; project_name: string }>
  indentProjects: string[]
  billsCodes: Array<{ code: string; label: string }>
  billsAssignments: Record<string, string[]>
  prefs: Array<{ userId: string; in_app: boolean; email: boolean; web_push: boolean; telegramLinked: boolean }>
  prefsAvailable: boolean
}

type TabId = 'powers' | 'signs' | 'works' | 'indents' | 'bills' | 'alerts'
const TABS: Array<{ id: TabId; label: string; hint: string }> = [
  { id: 'powers',  label: 'Powers',          hint: 'The "who may" lists: Accounts tab, archive sheets, rename names, manual upload' },
  { id: 'signs',   label: 'Who signs',       hint: 'Each project’s Project Head, Atm Head and Trustee' },
  { id: 'works',   label: 'Who works where', hint: 'People assigned to projects' },
]

const isAnon = (p: Person) => /^anonymous$/i.test(p.name)

export function PeopleClient({ data, initialTab }: { data: PeopleData; initialTab?: string }) {
  const [tab, setTab] = useState<TabId>((TABS.some(t => t.id === initialTab) ? initialTab : 'powers') as TabId)
  const [q, setQ] = useState('')
  const [hideAnon, setHideAnon] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const router = useRouter()
  const [, start] = useTransition()

  const people = useMemo(() => {
    const s = q.trim().toLowerCase()
    return data.people.filter(p => (!hideAnon || !isAnon(p)) && (!s || p.name.toLowerCase().includes(s) || p.roleLabel.toLowerCase().includes(s)))
  }, [data.people, q, hideAnon])
  const projects = useMemo(() => {
    const s = q.trim().toLowerCase()
    return data.projects.filter(p => !s || p.label.toLowerCase().includes(s) || p.name.toLowerCase().includes(s))
  }, [data.projects, q])

  /** Run one cell's action: optimistic UI is the caller's; we only surface errors and refresh. */
  function run(key: string, fn: () => Promise<Result>) {
    setBusy(key); setError(null)
    start(async () => {
      const r = await fn()
      setBusy(null)
      if (!r.ok) { setError(r.message ?? 'Could not save.'); return }
      router.refresh()
    })
  }

  const current = TABS.find(t => t.id === tab)!
  return (
    <section className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 px-3 pt-3">
        {TABS.map(t => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)}
            className={cn('rounded-full px-3 py-1.5 text-[13px] font-medium min-h-[36px]', tab === t.id ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200')}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-gray-100">
        <p className="text-[12px] text-gray-500 flex-1 min-w-[16rem]">{current.hint}</p>
        <label className="relative">
          <Search className="h-3.5 w-3.5 text-gray-400 absolute left-2 top-1/2 -translate-y-1/2" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={tab === 'signs' ? 'Find a project' : 'Find a person'} className="h-9 rounded-lg border border-gray-200 pl-7 pr-2 text-[13px] w-56" />
        </label>
        {tab !== 'signs' && (
          <label className="inline-flex items-center gap-1.5 text-[12px] text-gray-600 select-none">
            <input type="checkbox" checked={hideAnon} onChange={e => setHideAnon(e.target.checked)} /> hide “Anonymous”
          </label>
        )}
      </div>
      {error && <p className="px-4 py-2 text-[12px] text-rose-700 border-b border-rose-100 bg-rose-50 inline-flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5" />{error}</p>}

      {tab === 'powers'  && <PowersGrid people={people} grants={data.grants} busy={busy} run={run} />}
      {tab === 'signs'   && <SignsGrid projects={projects} people={data.people} approvers={data.approvers} busy={busy} run={run} />}
      {tab === 'works'   && <TickGrid people={people} cols={data.projects.filter(p => !p.isGroup).map(p => ({ key: p.id, label: p.label, title: p.name }))}
        isOn={(u, c) => data.assignments.some(a => a.user_id === u && a.project_id === c)} busy={busy}
        onFlip={(u, c, on) => run(`${u}|${c}`, () => setAssignment(u, c, on))} onLabel="works on it" offLabel="not on it" />}
      {tab === 'indents' && <TickGrid people={people} cols={data.indentProjects.map(n => ({ key: n, label: n, title: n }))}
        isOn={(u, c) => !data.hiddenIndents.some(h => h.user_id === u && h.project_name === c)} busy={busy}
        onFlip={(u, c, on) => run(`${u}|${c}`, () => setIndentHidden(u, c, !on))} onLabel="sees it" offLabel="hidden" onIcon={Eye} offIcon={EyeOff} />}
      {tab === 'bills'   && <TickGrid people={people} cols={data.billsCodes.map(c => ({ key: c.code, label: c.code, title: c.label }))}
        isOn={(u, c) => (data.billsAssignments[u] ?? []).includes(c)} busy={busy}
        onFlip={(u, c, on) => run(`${u}|${c}`, () => setBillsAssignment(u, c, on))} onLabel="in their digest" offLabel="not in their digest" />}
      {tab === 'alerts'  && <AlertsGrid people={people} prefs={data.prefs} available={data.prefsAvailable} busy={busy} run={run} />}
    </section>
  )
}

/* ── shared shell ─────────────────────────────────────────────────────────── */

function Shell({ firstHeader, cols, children }: { firstHeader: string; cols: Array<{ key: string; label: string; title?: string }>; children: React.ReactNode }) {
  return (
    <div className="overflow-auto max-h-[70vh]">
      <table className="min-w-full border-separate border-spacing-0 text-sm table-fixed">
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-30 bg-gray-50 border-b border-gray-200 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500 w-[240px] min-w-[240px] max-w-[240px]">{firstHeader}</th>
            {cols.map(c => (
              <th key={c.key} className="sticky top-0 z-20 bg-gray-50 border-b border-gray-200 px-1 py-2 text-center align-bottom w-[96px] min-w-[96px]" title={c.title ?? c.label}>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-600 leading-tight break-words">{c.label}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

function RoleRows({ people, colCount, render }: { people: Person[]; colCount: number; render: (p: Person) => React.ReactNode }) {
  const byRole = useMemo(() => {
    const m = new Map<string, Person[]>()
    for (const p of people) m.set(p.roleLabel, [...(m.get(p.roleLabel) ?? []), p])
    return [...m.entries()]
  }, [people])
  return (
    <>
      {byRole.map(([role, list]) => (
        <RoleGroup key={role} role={role} colCount={colCount}>
          {list.map(p => (
            <tr key={p.id}>
              <td className="sticky left-0 z-10 bg-white border-b border-gray-100 px-3 py-1.5 w-[240px] min-w-[240px] max-w-[240px]">
                <div className="text-[13px] text-gray-900 truncate" title={p.name}>{p.name}</div>
              </td>
              {render(p)}
            </tr>
          ))}
        </RoleGroup>
      ))}
      {people.length === 0 && <tr><td colSpan={colCount} className="px-3 py-6 text-center text-[13px] text-gray-400">Nobody matches.</td></tr>}
    </>
  )
}
function RoleGroup({ role, colCount, children }: { role: string; colCount: number; children: React.ReactNode }) {
  return (
    <>
      <tr><td colSpan={colCount} className="sticky left-0 bg-white px-3 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">{role}</td></tr>
      {children}
    </>
  )
}

function Tick({ on, busy, title, onClick, OnIcon = Check, OffIcon }: { on: boolean; busy: boolean; title: string; onClick: () => void; OnIcon?: React.ComponentType<{ className?: string }>; OffIcon?: React.ComponentType<{ className?: string }> }) {
  return (
    <button type="button" disabled={busy} onClick={onClick} title={title}
      className={cn('inline-flex h-7 w-7 items-center justify-center rounded-md border', on ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-gray-200 bg-white text-gray-300 hover:border-gray-300 hover:text-gray-500')}>
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : on ? <OnIcon className="h-3.5 w-3.5" /> : OffIcon ? <OffIcon className="h-3.5 w-3.5" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
    </button>
  )
}

/* ── grids ────────────────────────────────────────────────────────────────── */

function TickGrid({ people, cols, isOn, busy, onFlip, onLabel, offLabel, onIcon, offIcon }: {
  people: Person[]; cols: Array<{ key: string; label: string; title?: string }>; isOn: (userId: string, col: string) => boolean
  busy: string | null; onFlip: (userId: string, col: string, on: boolean) => void; onLabel: string; offLabel: string
  onIcon?: React.ComponentType<{ className?: string }>; offIcon?: React.ComponentType<{ className?: string }>
}) {
  return (
    <Shell firstHeader="Person" cols={cols}>
      <RoleRows people={people} colCount={cols.length + 1} render={p => cols.map(c => {
        const on = isOn(p.id, c.key)
        return (
          <td key={c.key} className="border-b border-gray-100 px-1 py-1 text-center">
            <Tick on={on} busy={busy === `${p.id}|${c.key}`} title={`${p.name} — ${c.title ?? c.label}: ${on ? onLabel : offLabel}. Tap to change.`} onClick={() => onFlip(p.id, c.key, !on)} OnIcon={onIcon} OffIcon={offIcon} />
          </td>
        )
      })} />
    </Shell>
  )
}

const POWERS: Array<{ key: GrantKey; label: string; title: string }> = [
  { key: 'accounts',      label: 'Accounts tab',   title: 'May open a project’s Accounts tab (admins always)' },
  { key: 'archive',       label: 'Archive sheets', title: 'May archive and restore working sheets (admins always)' },
  { key: 'rename',        label: 'Rename names',   title: 'May rename categories, tabs and pills (admins always)' },
  { key: 'manual_upload', label: 'Manual upload',  title: 'May open Manual upload (IN4 fallback) and switch it on (admins always)' },
]
function PowersGrid({ people, grants, busy, run }: { people: Person[]; grants: Record<GrantKey, string[]>; busy: string | null; run: (k: string, fn: () => Promise<Result>) => void }) {
  return (
    <Shell firstHeader="Person" cols={POWERS}>
      <RoleRows people={people.filter(p => p.role !== 'admin')} colCount={POWERS.length + 1} render={p => POWERS.map(c => {
        const on = grants[c.key].includes(p.id)
        return (
          <td key={c.key} className="border-b border-gray-100 px-1 py-1 text-center">
            <Tick on={on} busy={busy === `${p.id}|${c.key}`} title={`${p.name} — ${c.title}: ${on ? 'yes' : 'no'}. Tap to change.`} onClick={() => run(`${p.id}|${c.key}`, () => setGrant(c.key, p.id, !on))} />
          </td>
        )
      })} />
    </Shell>
  )
}

const STAGES: Array<{ role: 'project_head' | 'head' | 'founder'; label: string }> = [
  { role: 'project_head', label: 'Project Head' }, { role: 'head', label: 'Atm Head' }, { role: 'founder', label: 'Trustee' },
]
function SignsGrid({ projects, people, approvers, busy, run }: { projects: ProjectRow[]; people: Person[]; approvers: PeopleData['approvers']; busy: string | null; run: (k: string, fn: () => Promise<Result>) => void }) {
  const [adding, setAdding] = useState<string | null>(null)
  const nameOf = new Map(people.map(p => [p.id, p.name]))
  const eligible = (role: string) => people.filter(p => p.ccRole === role || p.role === 'admin')
  return (
    <div className="overflow-auto max-h-[70vh]">
      <table className="min-w-full border-separate border-spacing-0 text-sm table-fixed">
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-30 bg-gray-50 border-b border-gray-200 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500 w-[240px] min-w-[240px] max-w-[240px]">Project</th>
            {STAGES.map(s => <th key={s.role} className="sticky top-0 z-20 bg-gray-50 border-b border-gray-200 px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-600 w-[260px] min-w-[260px]">{s.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {projects.map(pr => (
            <tr key={pr.id}>
              <td className="sticky left-0 z-10 bg-white border-b border-gray-100 px-3 py-1.5 w-[240px] min-w-[240px] max-w-[240px]">
                <div className="text-[13px] text-gray-900 truncate" title={pr.name}>{pr.label}{pr.isGroup && <span className="ml-1.5 text-[10px] uppercase text-gray-400">group</span>}</div>
              </td>
              {STAGES.map(s => {
                const holders = approvers.filter(a => a.project_id === pr.id && a.role === s.role)
                const cellKey = `${pr.id}|${s.role}`
                const isAdding = adding === cellKey
                const missing = holders.length === 0
                return (
                  <td key={s.role} className={cn('border-b border-gray-100 px-2 py-1 align-top', missing && !pr.isGroup && 'bg-amber-50/60')}>
                    <div className="flex flex-wrap items-center gap-1">
                      {holders.map(h => (
                        <span key={h.user_id} className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white pl-2 pr-1 py-0.5 text-[12px] text-gray-800">
                          {nameOf.get(h.user_id) ?? 'Unknown'}
                          <button type="button" disabled={busy === `${cellKey}|${h.user_id}`} title="Remove" onClick={() => run(`${cellKey}|${h.user_id}`, () => setApprover(pr.id, s.role, h.user_id, false))}
                            className="inline-flex h-5 w-5 items-center justify-center rounded text-gray-400 hover:text-rose-600 hover:bg-rose-50">
                            {busy === `${cellKey}|${h.user_id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                          </button>
                        </span>
                      ))}
                      {isAdding ? (
                        <select autoFocus defaultValue="" onBlur={() => setAdding(null)}
                          onChange={e => { const uid = e.target.value; setAdding(null); if (uid) run(`${cellKey}|${uid}`, () => setApprover(pr.id, s.role, uid, true)) }}
                          className="h-7 rounded-md border border-gray-300 text-[12px] px-1 max-w-[180px]">
                          <option value="">Pick…</option>
                          {eligible(s.role).filter(p => !holders.some(h => h.user_id === p.id)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      ) : (
                        <button type="button" onClick={() => setAdding(cellKey)} title={`Add a ${s.label}`}
                          className={cn('inline-flex h-7 items-center gap-1 rounded-md border px-1.5 text-[11px]', missing ? 'border-amber-300 text-amber-800 bg-white hover:bg-amber-50' : 'border-transparent text-gray-300 hover:text-gray-600 hover:border-gray-200')}>
                          <Plus className="h-3 w-3" />{missing && 'set'}
                        </button>
                      )}
                    </div>
                  </td>
                )
              })}
            </tr>
          ))}
          {projects.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-[13px] text-gray-400">No project matches.</td></tr>}
        </tbody>
      </table>
      <p className="px-4 py-2 text-[11px] text-gray-400">Amber = no one signs that stage on that project; the inbox then falls back to anyone holding the role. Only people whose Cost Control role matches the stage are offered.</p>
    </div>
  )
}

const CHANNELS: Array<{ key: 'in_app' | 'email' | 'web_push'; label: string; Icon: React.ComponentType<{ className?: string }> }> = [
  { key: 'in_app', label: 'In-app', Icon: Bell }, { key: 'email', label: 'E-mail', Icon: Mail }, { key: 'web_push', label: 'Phone', Icon: Smartphone },
]
function AlertsGrid({ people, prefs, available, busy, run }: { people: Person[]; prefs: PeopleData['prefs']; available: boolean; busy: string | null; run: (k: string, fn: () => Promise<Result>) => void }) {
  const byUser = new Map(prefs.map(p => [p.userId, p]))
  const cols = [...CHANNELS.map(c => ({ key: c.key, label: c.label })), { key: 'telegram', label: 'Telegram', title: 'Linked by the person themself on their Settings page' }]
  if (!available) return <p className="px-4 py-6 text-[13px] text-gray-500">The server has no service key, so per-person channel preferences cannot be read here.</p>
  return (
    <Shell firstHeader="Person" cols={cols}>
      <RoleRows people={people} colCount={cols.length + 1} render={p => {
        const pref = byUser.get(p.id) ?? { userId: p.id, in_app: true, email: true, web_push: false, telegramLinked: false }
        return (
          <>
            {CHANNELS.map(c => (
              <td key={c.key} className="border-b border-gray-100 px-1 py-1 text-center">
                <Tick on={pref[c.key]} busy={busy === `${p.id}|${c.key}`} title={`${p.name} — ${c.label}: ${pref[c.key] ? 'on' : 'off'}. Tap to change.`} onClick={() => run(`${p.id}|${c.key}`, () => setChannel(p.id, c.key, !pref[c.key]))} OnIcon={c.Icon} />
              </td>
            ))}
            <td className="border-b border-gray-100 px-1 py-1 text-center">
              <span className={cn('inline-flex h-7 w-7 items-center justify-center rounded-md border', pref.telegramLinked ? 'border-sky-200 bg-sky-50 text-sky-700' : 'border-gray-100 text-gray-200')} title={pref.telegramLinked ? 'Telegram linked' : 'Telegram not linked — the person links it on their own Settings page'}>
                <Send className="h-3.5 w-3.5" />
              </span>
            </td>
          </>
        )
      }} />
    </Shell>
  )
}
