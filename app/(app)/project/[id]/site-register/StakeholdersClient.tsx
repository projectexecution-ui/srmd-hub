'use client'

// Stakeholders — the people and firms on this project, grouped, with the
// consultants' own order value read from IN4.
//
// The reading screen carries no configuration. Which disciplines the project
// uses, who is on it and copying either elsewhere all live behind buttons that
// only appear for someone who may use them, and each opens a panel over the
// page rather than sitting on it.

import { useMemo, useState, useTransition } from 'react'
import { Users } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { formatINR } from '@/lib/utils'
import { ORG_LABEL, ORG_ORDER, type Discipline, type OrgKind, type Stakeholder } from '@/lib/site-register/types'
import {
  applyCopy, planCopy, removeStakeholder, restoreStakeholder,
  saveStakeholder, setProjectDisciplines, type CopyPlanLine,
} from '@/lib/site-register/actions'
import { Counter, Pill, Who } from './ui'

interface Party { id: number; kind: string; name: string; city: string | null }
interface User { id: string; name: string; role: string; email: string | null }

export interface StakeholdersClientProps {
  projectId: string
  projectName: string
  initialGroup: OrgKind | 'all'
  canConfigure: boolean
  /**
   * May this person see what a party has been ordered and paid? Follows the
   * contractor-report module, which is off for contractor, engineer and
   * site_staff — so this tab can never show a contractor another contractor's
   * account while /reports refuses them. The figures are stripped on the
   * server when false; this only decides whether the column exists.
   */
  canSeeMoney: boolean
  disciplines: Discipline[]
  enabledIds: string[]
  /** False until someone narrows the list — see StakeholderData.configured. */
  configured: boolean
  people: Stakeholder[]
  gaps: Discipline[]
  parties: Party[]
  users: User[]
  otherProjects: Array<{ id: string; name: string }>
}

type Overlay = 'none' | 'disciplines' | 'person' | 'copy'

export function StakeholdersClient(props: StakeholdersClientProps) {
  const [group, setGroup] = useState<OrgKind | 'all'>(props.initialGroup)
  const [overlay, setOverlay] = useState<Overlay>('none')
  const [editing, setEditing] = useState<Stakeholder | null>(null)
  const [showPast, setShowPast] = useState(false)

  const active = props.people.filter(p => p.isActive)
  const past = props.people.filter(p => !p.isActive)
  const shown = useMemo(() => {
    const base = showPast ? props.people : active
    return group === 'all' ? base : base.filter(p => p.orgKind === group)
  }, [props.people, active, group, showPast])

  const consultants = active.filter(p => p.orgKind === 'consultant')
  const committed = active.reduce((s, p) => s + (p.orderValue ?? 0), 0)
  const enabled = props.disciplines.filter(d => props.enabledIds.includes(d.id))

  const openEdit = (p: Stakeholder | null) => { setEditing(p); setOverlay('person') }

  return (
    <section className="space-y-3">
      <header className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div>
          <h2 className="text-sm font-bold text-gray-900">Stakeholders</h2>
          <p className="text-xs text-gray-500">
            Everyone attached to {props.projectName} and their part in it. Consultants are a group here — their order value
            comes from IN4 by the party each one is pinned to.
          </p>
        </div>
        {props.canConfigure && (
          <div className="ml-auto flex flex-wrap gap-1.5">
            <button onClick={() => openEdit(null)} className="rounded-lg bg-indigo-700 px-3.5 text-xs font-semibold text-white hover:bg-indigo-800 min-h-[44px]">
              Add a stakeholder
            </button>
            <button onClick={() => setOverlay('disciplines')} className="rounded-lg border border-gray-300 bg-white px-3 text-xs font-semibold text-gray-700 min-h-[44px]">
              Disciplines
            </button>
            <button onClick={() => setOverlay('copy')} className="rounded-lg border border-gray-300 bg-white px-3 text-xs font-semibold text-gray-700 min-h-[44px]">
              Copy to…
            </button>
          </div>
        )}
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Counter label="On the project" value={active.length} note={past.length ? `${past.length} no longer on it` : 'all current'} />
        <Counter
          label="Disciplines in use"
          value={props.configured ? enabled.length : 'All'}
          note={props.configured ? `of ${props.disciplines.length} available` : 'not narrowed for this project yet'}
        />
        <Counter label="Consultants" value={consultants.length} note={consultants.length ? 'appointed' : 'none appointed'} />
        {props.canSeeMoney
          ? <Counter label="Committed by order" value={committed ? formatINR(committed) : '—'} note="from IN4, by party" tone="slate" />
          : <Counter label="Pinned to IN4" value={active.filter(p => p.in4PartyId != null).length} note="their orders are on WO / PO" tone="slate" />}
      </div>

      {/* The reason to open this tab: a discipline the project says it uses,
          with nobody to send anything to. */}
      {props.gaps.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3.5">
          <p className="text-[13px] font-bold text-amber-900">
            {props.gaps.length === 1 ? 'One discipline has nobody named' : `${props.gaps.length} disciplines have nobody named`}
          </p>
          <p className="text-[12px] text-amber-900 mt-0.5">
            An entry raised against {props.gaps.length === 1 ? 'it' : 'these'} has nowhere to go, so it stays with whoever raised it.
          </p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {props.gaps.map(d => <Pill key={d.id} tone="amber">{d.name}</Pill>)}
          </div>
          {props.canConfigure && (
            <button onClick={() => openEdit(null)} className="mt-2 text-[12px] font-semibold text-amber-900 underline">
              Name someone
            </button>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <GroupChip on={group === 'all'} onClick={() => setGroup('all')} count={active.length}>Everyone</GroupChip>
        {ORG_ORDER.map(o => (
          <GroupChip key={o} on={group === o} onClick={() => setGroup(o)} count={active.filter(p => p.orgKind === o).length}>
            {ORG_LABEL[o]}
          </GroupChip>
        ))}
        {past.length > 0 && (
          <label className="ml-auto inline-flex items-center gap-2 text-[12px] text-gray-600 cursor-pointer min-h-[36px]">
            <input type="checkbox" checked={showPast} onChange={e => setShowPast(e.target.checked)} className="h-4 w-4 accent-indigo-600" />
            Include {past.length} no longer on the project
          </label>
        )}
      </div>

      {shown.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white">
          <EmptyState
            icon={<Users className="h-8 w-8" />}
            title={props.people.length === 0 ? 'Nobody is on this project yet' : 'Nobody in this group'}
            description={props.people.length === 0
              ? 'Add the architect, the site engineer and the main contractor first — those three make the register route itself.'
              : 'Try another group, or add someone.'}
            action={props.canConfigure
              ? <button onClick={() => openEdit(null)} className="rounded-lg bg-indigo-700 px-3.5 text-xs font-semibold text-white min-h-[44px]">Add a stakeholder</button>
              : undefined}
          />
        </div>
      ) : (
        <>
          {/* ── Desktop ─────────────────────────────────────────────────── */}
          <div className="hidden xl:block rounded-lg border border-gray-200 bg-white overflow-hidden">
            <div className="overflow-auto">
              <table className="w-full text-[13px]" style={{ minWidth: 920 }}>
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500">
                    <th className="px-3 py-2 font-semibold">Name</th>
                    <th className="px-3 py-2 font-semibold w-[160px]">Discipline</th>
                    <th className="px-3 py-2 font-semibold w-[180px]">Part on this project</th>
                    <th className="px-3 py-2 font-semibold w-[190px]">Contact</th>
                    {props.canSeeMoney && <th className="px-3 py-2 font-semibold w-[150px] text-right">Order value / paid</th>}
                    {props.canConfigure && <th className="px-3 py-2 font-semibold w-[92px]" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {shown.map(p => (
                    <tr key={p.id} className={p.isActive ? 'hover:bg-gray-50' : 'bg-gray-50/70 text-gray-400'}>
                      <td className="px-3 py-2.5 align-top">
                        <div className="flex items-start gap-2">
                          <Who name={p.name} />
                          <div>
                            <p className="text-[13px] font-semibold text-gray-900 leading-snug">
                              {p.name}
                              {p.isLead && <span className="ml-1.5"><Pill tone="emerald">Lead</Pill></span>}
                              {!p.isActive && <span className="ml-1.5"><Pill>No longer on the project</Pill></span>}
                            </p>
                            <p className="text-[11px] text-gray-500">{ORG_LABEL[p.orgKind]}{p.notes ? ` · ${p.notes}` : ''}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 align-top text-[12px] text-gray-700">{p.disciplineName ?? '—'}</td>
                      <td className="px-3 py-2.5 align-top text-[12px] text-gray-700">{p.roleOnProject ?? '—'}</td>
                      <td className="px-3 py-2.5 align-top text-[11px] text-gray-500 break-all">
                        {p.email ?? p.phone ?? (p.in4PartyId ? `IN4 party #${p.in4PartyId}` : <span className="text-amber-800 font-semibold">No contact recorded</span>)}
                      </td>
                      {props.canSeeMoney && (
                      <td className="px-3 py-2.5 align-top text-right text-[12px] tabular-nums">
                        {p.orderValue != null ? (
                          <>
                            <p className="font-semibold text-gray-900">{formatINR(p.orderValue)}</p>
                            <p className="text-[11px] text-gray-500">paid {formatINR(p.paid ?? 0)} · {p.orders} order{p.orders === 1 ? '' : 's'}</p>
                          </>
                        ) : p.in4PartyId ? (
                          <span className="text-gray-400">no orders here</span>
                        ) : (
                          <span className="text-gray-300">not pinned to IN4</span>
                        )}
                      </td>
                      )}
                      {props.canConfigure && (
                        <td className="px-3 py-2.5 align-top text-right">
                          <RowActions p={p} onEdit={() => openEdit(p)} projectId={props.projectId} />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Phone and tablet ────────────────────────────────────────── */}
          <div className="xl:hidden rounded-lg border border-gray-200 bg-white divide-y divide-gray-100">
            {shown.map(p => (
              <div key={p.id} className={`px-3.5 py-3 ${p.isActive ? '' : 'bg-gray-50/70'}`}>
                <div className="flex items-start gap-2">
                  <Who name={p.name} />
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-gray-900 leading-snug">
                      {p.name}
                      {p.isLead && <span className="ml-1.5"><Pill tone="emerald">Lead</Pill></span>}
                    </p>
                    <p className="text-[12px] text-gray-600">{p.roleOnProject ?? ORG_LABEL[p.orgKind]}</p>
                    <p className="text-[11px] text-gray-400">{p.disciplineName ?? 'No discipline'}</p>
                    {props.canSeeMoney && p.orderValue != null && (
                      <p className="text-[12px] text-gray-700 tabular-nums mt-1">{formatINR(p.orderValue)} · paid {formatINR(p.paid ?? 0)}</p>
                    )}
                  </div>
                  <div className="ml-auto flex flex-col items-end gap-1">
                    {p.email && <a href={`mailto:${p.email}`} className="text-[12px] font-semibold text-indigo-700 min-h-[44px] flex items-center">E-mail</a>}
                    {p.phone && <a href={`tel:${p.phone}`} className="text-[12px] font-semibold text-indigo-700 min-h-[44px] flex items-center">Call</a>}
                    {props.canConfigure && (
                      <button onClick={() => openEdit(p)} className="text-[12px] font-semibold text-gray-600 min-h-[44px]">Edit</button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {!props.canConfigure && (
        <p className="text-[12px] text-gray-500">
          Who is on the project, and which disciplines it uses, are set by an admin or an Atm Head.
        </p>
      )}

      {overlay === 'disciplines' && (
        <DisciplinePanel {...props} onClose={() => setOverlay('none')} />
      )}
      {overlay === 'person' && (
        <PersonPanel {...props} editing={editing} onClose={() => { setOverlay('none'); setEditing(null) }} />
      )}
      {overlay === 'copy' && (
        <CopyPanel {...props} onClose={() => setOverlay('none')} />
      )}
    </section>
  )
}

function GroupChip({ on, count, onClick, children }: { on: boolean; count: number; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`px-2.5 py-1.5 rounded-md text-[12px] font-semibold border min-h-[36px] ${on ? 'bg-gray-900 border-gray-900 text-white' : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'}`}
    >
      {children} <span className="opacity-70 tabular-nums">{count}</span>
    </button>
  )
}

function RowActions({ p, projectId, onEdit }: { p: Stakeholder; projectId: string; onEdit: () => void }) {
  const [pending, start] = useTransition()
  return (
    <div className="flex justify-end gap-2">
      <button onClick={onEdit} className="text-[12px] font-semibold text-gray-600 hover:text-gray-900">Edit</button>
      <button
        disabled={pending}
        onClick={() => start(async () => { if (p.isActive) await removeStakeholder(p.id, projectId); else await restoreStakeholder(p.id, projectId) })}
        className="text-[12px] font-semibold text-gray-400 hover:text-rose-700 disabled:opacity-50"
      >
        {p.isActive ? 'Remove' : 'Restore'}
      </button>
    </div>
  )
}

/* ── Overlay shell ───────────────────────────────────────────────────────── */

function Overlay({ title, subtitle, onClose, children, wide }: {
  title: string; subtitle?: string; onClose: () => void; children: React.ReactNode; wide?: boolean
}) {
  return (
    <>
      <div className="fixed inset-0 bg-gray-900/40 z-40" onClick={onClose} aria-hidden />
      <div className="fixed inset-0 z-50 grid place-items-center p-3 pointer-events-none">
        <div className={`bg-white rounded-xl w-full ${wide ? 'max-w-[720px]' : 'max-w-[560px]'} max-h-[88vh] overflow-y-auto shadow-2xl pointer-events-auto`}>
          <div className="px-5 py-4 border-b border-gray-200 flex items-start gap-3 sticky top-0 bg-white z-10">
            <div>
              <p className="text-[15px] font-bold text-gray-900">{title}</p>
              {subtitle && <p className="text-[12px] text-gray-500">{subtitle}</p>}
            </div>
            <button onClick={onClose} className="ml-auto text-gray-400 text-xl leading-none px-2 min-h-[44px]" aria-label="Close">&times;</button>
          </div>
          <div className="p-5">{children}</div>
        </div>
      </div>
    </>
  )
}

/* ── Which disciplines this project uses ─────────────────────────────────── */

function DisciplinePanel({ projectId, disciplines, enabledIds, people, onClose }: StakeholdersClientProps & { onClose: () => void }) {
  const [chosen, setChosen] = useState<Set<string>>(new Set(enabledIds))
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const used = new Set(people.filter(p => p.isActive && p.disciplineId).map(p => p.disciplineId as string))

  const toggle = (id: string) => {
    const next = new Set(chosen)
    if (next.has(id)) next.delete(id); else next.add(id)
    setChosen(next)
  }

  return (
    <Overlay
      title="Disciplines on this project"
      subtitle="Only the ones ticked are offered when raising an entry or naming a stakeholder."
      onClose={onClose}
      wide
    >
      <div className="grid sm:grid-cols-2 gap-1.5">
        {disciplines.map(d => {
          const on = chosen.has(d.id)
          const inUse = used.has(d.id)
          return (
            <button
              key={d.id}
              onClick={() => toggle(d.id)}
              className={`flex items-center gap-2 text-left rounded-lg border px-3 py-2 min-h-[44px] ${on ? 'border-indigo-300 bg-indigo-50' : 'border-gray-200 bg-white'}`}
            >
              <span className={`text-[15px] leading-none ${on ? 'text-indigo-600' : 'text-gray-300'}`}>{on ? '☑' : '☐'}</span>
              <span className={`text-[13px] ${on ? 'font-semibold text-indigo-900' : 'text-gray-600'}`}>{d.name}</span>
              {inUse && <span className="ml-auto text-[11px] text-gray-500">in use</span>}
            </button>
          )
        })}
      </div>
      <p className="text-[12px] text-gray-500 mt-3">
        Switching one off does not remove anyone already named in it — they stay, and the discipline is simply not offered for
        anything new. {used.size > 0 && `${used.size} of these have someone named.`}
      </p>
      {error && <p className="mt-2 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-800">{error}</p>}
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="px-3.5 py-2 rounded-md border border-gray-300 text-[13px] font-semibold text-gray-700 min-h-[40px]">Cancel</button>
        <button
          disabled={pending}
          onClick={() => start(async () => {
            const r = await setProjectDisciplines(projectId, [...chosen])
            if (!r.ok) setError(r.error ?? 'That did not save.'); else onClose()
          })}
          className="px-3.5 py-2 rounded-md bg-indigo-700 text-white text-[13px] font-semibold disabled:opacity-50 min-h-[40px]"
        >
          {pending ? 'Saving…' : `Save — ${chosen.size} on`}
        </button>
      </div>
    </Overlay>
  )
}

/* ── Adding or editing one stakeholder ───────────────────────────────────── */

function PersonPanel({
  projectId, disciplines, enabledIds, parties, users, editing, onClose,
}: StakeholdersClientProps & { editing: Stakeholder | null; onClose: () => void }) {
  const [orgKind, setOrgKind] = useState<OrgKind>(editing?.orgKind ?? 'consultant')
  const [name, setName] = useState(editing?.name ?? '')
  const [userId, setUserId] = useState(editing?.userId ?? '')
  const [partyId, setPartyId] = useState(editing?.in4PartyId ? String(editing.in4PartyId) : '')
  const [partyQ, setPartyQ] = useState('')
  const [disciplineId, setDisciplineId] = useState(editing?.disciplineId ?? '')
  const [role, setRole] = useState(editing?.roleOnProject ?? '')
  const [email, setEmail] = useState(editing?.email ?? '')
  const [phone, setPhone] = useState(editing?.phone ?? '')
  const [isLead, setIsLead] = useState(editing?.isLead ?? false)
  const [notes, setNotes] = useState(editing?.notes ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const enabled = disciplines.filter(d => enabledIds.includes(d.id))
  const partyKind = orgKind === 'vendor' ? 'supplier' : 'contractor'
  const matches = useMemo(() => {
    const q = partyQ.trim().toLowerCase()
    if (q.length < 2) return []
    return parties.filter(p => p.name.toLowerCase().includes(q)).slice(0, 40)
  }, [parties, partyQ])
  const chosenParty = parties.find(p => String(p.id) === partyId)

  return (
    <Overlay
      title={editing ? 'Edit stakeholder' : 'Add a stakeholder'}
      subtitle={editing ? editing.name : 'A person or firm, and what they are responsible for here.'}
      onClose={onClose}
    >
      <div className="space-y-3">
        {error && <p className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-800">{error}</p>}

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Which register</p>
          <div className="flex flex-wrap gap-1.5">
            {ORG_ORDER.map(o => (
              <button
                key={o}
                onClick={() => setOrgKind(o)}
                className={`px-2.5 py-1.5 rounded-md text-[12px] font-semibold border min-h-[36px] ${orgKind === o ? 'bg-gray-900 border-gray-900 text-white' : 'bg-white border-gray-300 text-gray-600'}`}
              >
                {ORG_LABEL[o]}
              </button>
            ))}
          </div>
        </div>

        {orgKind === 'team' ? (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Who</p>
            <select
              value={userId}
              onChange={e => {
                setUserId(e.target.value)
                const u = users.find(x => x.id === e.target.value)
                if (u) { setName(u.name); setEmail(u.email ?? '') }
              }}
              className="w-full text-[13px] border border-gray-300 rounded px-2 py-2 bg-white min-h-[40px]"
            >
              <option value="">Choose a CT Hub user…</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name} — {u.role}</option>)}
            </select>
            <p className="text-[11px] text-gray-500 mt-1">A team member is a CT Hub user, so entries assigned to them reach them in the hub.</p>
          </div>
        ) : orgKind === 'authority' ? (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Name</p>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. DGVCL — Valsad"
              className="w-full text-[13px] border border-gray-300 rounded px-2 py-2 min-h-[40px]" />
            <p className="text-[11px] text-gray-500 mt-1">Authorities are typed in — IN4 holds no register for them.</p>
          </div>
        ) : (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Pin to the IN4 party</p>
            {chosenParty ? (
              <div className="flex items-center gap-2 rounded border border-indigo-200 bg-indigo-50 px-3 py-2">
                <p className="text-[13px] font-semibold text-indigo-900">{chosenParty.name}</p>
                {chosenParty.city && <p className="text-[11px] text-indigo-700">{chosenParty.city}</p>}
                <button onClick={() => { setPartyId(''); setPartyQ('') }} className="ml-auto text-[12px] font-semibold text-indigo-700">Change</button>
              </div>
            ) : (
              <>
                <input value={partyQ} onChange={e => setPartyQ(e.target.value)} placeholder="Type two letters of the firm's name"
                  className="w-full text-[13px] border border-gray-300 rounded px-2 py-2 min-h-[40px]" />
                {matches.length > 0 && (
                  <div className="mt-1 max-h-48 overflow-y-auto rounded border border-gray-200 divide-y divide-gray-100">
                    {matches.map(p => (
                      <button
                        key={`${p.kind}-${p.id}`}
                        onClick={() => { setPartyId(String(p.id)); if (!name) setName(p.name) }}
                        className="w-full text-left px-3 py-2 hover:bg-gray-50 min-h-[44px]"
                      >
                        <p className="text-[13px] text-gray-900">{p.name}</p>
                        <p className="text-[11px] text-gray-500">{p.kind}{p.city ? ` · ${p.city}` : ''}</p>
                      </button>
                    ))}
                  </div>
                )}
                {partyQ.trim().length >= 2 && matches.length === 0 && (
                  <p className="text-[12px] text-gray-500 mt-1">No IN4 party matches. Type the name below and leave it unpinned — the order value will simply be blank.</p>
                )}
              </>
            )}
            <div className="mt-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Name shown here</p>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="The firm's name"
                className="w-full text-[13px] border border-gray-300 rounded px-2 py-2 min-h-[40px]" />
            </div>
          </div>
        )}

        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Discipline</p>
            <select value={disciplineId} onChange={e => setDisciplineId(e.target.value)}
              className="w-full text-[13px] border border-gray-300 rounded px-2 py-2 bg-white min-h-[40px]">
              <option value="">None</option>
              {enabled.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Part on this project</p>
            <input value={role} onChange={e => setRole(e.target.value)} placeholder="e.g. Lead Architect, Site Engineer"
              className="w-full text-[13px] border border-gray-300 rounded px-2 py-2 min-h-[40px]" />
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">E-mail</p>
            <input value={email} onChange={e => setEmail(e.target.value)} inputMode="email"
              className="w-full text-[13px] border border-gray-300 rounded px-2 py-2 min-h-[40px]" />
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Phone</p>
            <input value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel"
              className="w-full text-[13px] border border-gray-300 rounded px-2 py-2 min-h-[40px]" />
          </div>
        </div>

        <label className={`flex items-start gap-2 rounded-lg border p-3 cursor-pointer ${disciplineId ? 'border-gray-200' : 'border-gray-100 opacity-50'}`}>
          <input type="checkbox" checked={isLead} disabled={!disciplineId} onChange={e => setIsLead(e.target.checked)} className="mt-0.5 h-4 w-4 accent-indigo-600" />
          <span className="text-[13px] text-gray-700">
            <b>Answers for this discipline.</b> New entries of this discipline are addressed to them without anyone choosing.
            One person or firm per discipline; naming a new one replaces the old.
          </span>
        </label>

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Note</p>
          <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Anything worth knowing about their involvement"
            className="w-full text-[13px] border border-gray-300 rounded px-2 py-2 min-h-[40px]" />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-3.5 py-2 rounded-md border border-gray-300 text-[13px] font-semibold text-gray-700 min-h-[40px]">Cancel</button>
          <button
            disabled={pending || name.trim().length < 2}
            onClick={() => start(async () => {
              const r = await saveStakeholder({
                id: editing?.id ?? null,
                projectId,
                disciplineId: disciplineId || null,
                orgKind,
                userId: orgKind === 'team' ? (userId || null) : null,
                in4PartyKind: partyId ? partyKind : null,
                in4PartyId: partyId ? Number(partyId) : null,
                name,
                roleOnProject: role,
                email,
                phone,
                isLead: isLead && !!disciplineId,
                notes,
              })
              if (!r.ok) setError(r.error ?? 'That did not save.'); else onClose()
            })}
            className="px-3.5 py-2 rounded-md bg-indigo-700 text-white text-[13px] font-semibold disabled:opacity-50 min-h-[40px]"
          >
            {pending ? 'Saving…' : editing ? 'Save changes' : 'Add to the project'}
          </button>
        </div>
      </div>
    </Overlay>
  )
}

/* ── Copying this project's people to others ─────────────────────────────── */

function CopyPanel({ projectId, projectName, otherProjects, onClose }: StakeholdersClientProps & { onClose: () => void }) {
  const [targets, setTargets] = useState<Set<string>>(new Set())
  const [withDisciplines, setWithDisciplines] = useState(true)
  const [withPeople, setWithPeople] = useState(true)
  const [mode, setMode] = useState<'add' | 'match'>('add')
  const [plan, setPlan] = useState<CopyPlanLine[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [pending, start] = useTransition()

  const toggle = (id: string) => {
    const next = new Set(targets)
    if (next.has(id)) next.delete(id); else next.add(id)
    setTargets(next)
    setPlan(null)
  }

  return (
    <Overlay
      title={`Copy from ${projectName}`}
      subtitle="Set one project up properly, then give the rest the same shape in a click."
      onClose={onClose}
      wide
    >
      {done ? (
        <div className="space-y-3">
          <p className="text-[13px] text-gray-800">Copied to {targets.size} project{targets.size === 1 ? '' : 's'}.</p>
          <p className="text-[12px] text-gray-500">Nothing that was already there was changed. Open any of them to check.</p>
          <button onClick={onClose} className="px-3.5 py-2 rounded-md bg-indigo-700 text-white text-[13px] font-semibold min-h-[40px]">Done</button>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">What to copy</p>
            <label className="flex items-center gap-2 text-[13px] text-gray-700 cursor-pointer min-h-[36px]">
              <input type="checkbox" checked={withDisciplines} onChange={e => { setWithDisciplines(e.target.checked); setPlan(null) }} className="h-4 w-4 accent-indigo-600" />
              Which disciplines the project uses
            </label>
            <label className="flex items-center gap-2 text-[13px] text-gray-700 cursor-pointer min-h-[36px]">
              <input type="checkbox" checked={withPeople} onChange={e => { setWithPeople(e.target.checked); setPlan(null) }} className="h-4 w-4 accent-indigo-600" />
              The people and firms, with their disciplines and parts
            </label>
          </div>

          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">To which projects</p>
            <div className="grid sm:grid-cols-2 gap-1.5 max-h-56 overflow-y-auto">
              {otherProjects.map(p => (
                <label key={p.id} className="flex items-center gap-2 text-[13px] text-gray-700 cursor-pointer border border-gray-200 rounded px-2 py-1.5 min-h-[40px]">
                  <input type="checkbox" checked={targets.has(p.id)} onChange={() => toggle(p.id)} className="h-4 w-4 accent-indigo-600" />
                  {p.name}
                </label>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">If a project already has something</p>
            <label className="flex gap-2 items-start text-[13px] text-gray-700 cursor-pointer">
              <input type="radio" checked={mode === 'add'} onChange={() => { setMode('add'); setPlan(null) }} className="mt-1 accent-indigo-600" />
              <span><b>Add what is missing.</b> Nothing already there is changed or removed.</span>
            </label>
            <label className="flex gap-2 items-start text-[13px] text-gray-700 cursor-pointer mt-1">
              <input type="radio" checked={mode === 'match'} onChange={() => { setMode('match'); setPlan(null) }} className="mt-1 accent-indigo-600" />
              <span><b>Make the disciplines match exactly.</b> Also switches off disciplines {projectName} does not use. People are never removed.</span>
            </label>
          </div>

          {error && <p className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-800">{error}</p>}

          {plan && (
            <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3">
              <p className="text-[12px] font-bold text-indigo-900 mb-1.5">This is exactly what will happen</p>
              <div className="space-y-1.5">
                {plan.map(l => (
                  <p key={l.projectId} className="text-[13px] text-gray-800">
                    <b>{l.projectName}</b> — {l.disciplinesAdded} discipline{l.disciplinesAdded === 1 ? '' : 's'} switched on,{' '}
                    {l.peopleAdded} added{l.alreadyThere ? `, ${l.alreadyThere} already there and left alone` : ''}.
                    {l.conflicts.map((c, i) => <span key={i} className="block text-[12px] text-amber-800">· {c}</span>)}
                  </p>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="px-3.5 py-2 rounded-md border border-gray-300 text-[13px] font-semibold text-gray-700 min-h-[40px]">Cancel</button>
            {!plan ? (
              <button
                disabled={pending || targets.size === 0 || (!withDisciplines && !withPeople)}
                onClick={() => start(async () => {
                  const r = await planCopy(projectId, [...targets], { disciplines: withDisciplines, people: withPeople, mode })
                  if (!r.ok) setError(r.error ?? 'That could not be worked out.'); else { setError(null); setPlan(r.lines) }
                })}
                className="px-3.5 py-2 rounded-md bg-gray-900 text-white text-[13px] font-semibold disabled:opacity-50 min-h-[40px]"
              >
                {pending ? 'Checking…' : 'Show me what will happen'}
              </button>
            ) : (
              <button
                disabled={pending}
                onClick={() => start(async () => {
                  const r = await applyCopy(projectId, [...targets], { disciplines: withDisciplines, people: withPeople, mode })
                  if (!r.ok) setError(r.error ?? 'That did not save.'); else setDone(true)
                })}
                className="px-3.5 py-2 rounded-md bg-indigo-700 text-white text-[13px] font-semibold disabled:opacity-50 min-h-[40px]"
              >
                {pending ? 'Copying…' : 'Copy now'}
              </button>
            )}
          </div>
        </div>
      )}
    </Overlay>
  )
}
