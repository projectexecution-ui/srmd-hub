'use client'

// Stakeholders — the people and firms on this project, and what each one is
// responsible for.
//
// A DIRECTORY, NOT A TABLE. Each person here is six short facts — name, part,
// discipline, how to reach them, and whether they answer for their discipline
// — and a table spends a whole row on that while making the phone version a
// different screen. Cards carry all six, reflow from one column to three, and
// are the same object on a phone as on a laptop.
//
// The coverage strip above the cards is the reason to open the tab at all: it
// shows, at a glance, which disciplines have somebody and which have nobody.
// Configuration stays behind buttons — Aksha, 12 Sep 2026: hidden, and shown
// when required.

import { useMemo, useState, useTransition } from 'react'
import { Users, Mail, Phone, Star } from 'lucide-react'
import { formatINR } from '@/lib/utils'
import { ORG_LABEL, ORG_ORDER, type Discipline, type OrgKind, type Stakeholder } from '@/lib/site-register/types'
import {
  applyCopy, planCopy, removeStakeholder, restoreStakeholder,
  saveStakeholder, setProjectDisciplines, type CopyPlanLine,
} from '@/lib/site-register/actions'
import {
  Avatar, Button, EmptyPanel, Field, FIELD, Label, Metric, Modal,
  Notice, Pill, SectionHead, Segmented, SURFACE,
} from './ui'

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
   * server when false; this only decides whether the card shows a footer.
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

  const active = useMemo(() => props.people.filter(p => p.isActive), [props.people])
  const past = useMemo(() => props.people.filter(p => !p.isActive), [props.people])
  const shown = useMemo(() => {
    const base = showPast ? props.people : active
    return group === 'all' ? base : base.filter(p => p.orgKind === group)
  }, [props.people, active, group, showPast])

  const consultants = active.filter(p => p.orgKind === 'consultant')
  const committed = active.reduce((s, p) => s + (p.orderValue ?? 0), 0)
  const enabled = props.disciplines.filter(d => props.enabledIds.includes(d.id))
  const coveredIds = new Set(active.filter(p => p.disciplineId).map(p => p.disciplineId as string))

  const openEdit = (p: Stakeholder | null) => { setEditing(p); setOverlay('person') }

  return (
    <section className="space-y-3.5">
      <SectionHead
        title="Stakeholders"
        subtitle={<>Everyone attached to <b className="text-gray-700">{props.projectName}</b> and their part in it. Consultants are a
          group here — each one pinned to its IN4 party, so what it has been ordered comes from IN4 rather than from anyone typing.</>}
        actions={props.canConfigure && (
          <>
            <Button kind="primary" onClick={() => openEdit(null)}>Add a stakeholder</Button>
            <Button onClick={() => setOverlay('disciplines')}>Disciplines</Button>
            <Button onClick={() => setOverlay('copy')}>Copy to…</Button>
          </>
        )}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <Metric label="On the project" value={active.length} lead
          note={past.length ? `${past.length} no longer on it` : 'all current'} />
        <Metric
          label="Disciplines in use"
          value={props.configured ? enabled.length : 'All'}
          note={props.configured ? `of ${props.disciplines.length} available` : 'not narrowed for this project yet'}
        />
        <Metric label="Covered" value={props.configured ? `${enabled.filter(d => coveredIds.has(d.id)).length}` : coveredIds.size}
          tone={props.gaps.length ? 'amber' : 'emerald'}
          note={props.gaps.length ? `${props.gaps.length} with nobody named` : 'every discipline has someone'}
          bar={enabled.length ? { of: enabled.length, value: enabled.filter(d => coveredIds.has(d.id)).length } : undefined}
        />
        {props.canSeeMoney
          ? <Metric label="Committed by order" value={committed ? formatINR(committed) : '—'} note="from IN4, by party" />
          : <Metric label="Consultants" value={consultants.length} note={consultants.length ? 'appointed' : 'none appointed'} />}
      </div>

      {/* ── Coverage: the reason to open this tab ───────────────────────── */}
      {props.configured && enabled.length > 0 && (
        <div className={`${SURFACE} p-3.5`}>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <Label>Discipline coverage</Label>
            {props.gaps.length > 0 && (
              <p className="text-[12px] text-amber-800">
                An entry raised against a discipline with nobody named has nowhere to go — it stays with whoever raised it.
              </p>
            )}
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {enabled.map(d => {
              const covered = coveredIds.has(d.id)
              const lead = active.find(p => p.disciplineId === d.id && p.isLead)
              return (
                <span
                  key={d.id}
                  title={lead ? `${d.name} — ${lead.name}` : covered ? d.name : `${d.name} — nobody named`}
                  className={`inline-flex items-center gap-1.5 rounded-full py-1 pl-2 pr-2.5 text-[12px] font-semibold ring-1
                    ${covered ? 'bg-white text-gray-700 ring-gray-200' : 'bg-amber-50 text-amber-900 ring-amber-300'}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${covered ? 'bg-emerald-500' : 'bg-amber-500'}`} aria-hidden />
                  {d.name}
                  {lead && <Avatar name={lead.name} />}
                </span>
              )
            })}
          </div>
          {props.gaps.length > 0 && props.canConfigure && (
            <button onClick={() => openEdit(null)} className="mt-2.5 text-[12px] font-semibold text-amber-900 hover:underline">
              Name someone for {props.gaps.length === 1 ? props.gaps[0].name : `${props.gaps.length} disciplines`}
            </button>
          )}
        </div>
      )}

      {/* ── Who, by register ───────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          size="sm"
          value={group}
          onChange={setGroup}
          options={[
            { key: 'all' as const, label: 'Everyone', count: active.length },
            ...ORG_ORDER.map(o => ({ key: o, label: ORG_LABEL[o], count: active.filter(p => p.orgKind === o).length })),
          ]}
        />
        {past.length > 0 && (
          <label className="ml-auto inline-flex min-h-[36px] cursor-pointer items-center gap-2 text-[12px] text-gray-600">
            <input type="checkbox" checked={showPast} onChange={e => setShowPast(e.target.checked)} className="h-4 w-4 accent-indigo-600" />
            Include {past.length} no longer on the project
          </label>
        )}
      </div>

      {shown.length === 0 ? (
        <EmptyPanel
          icon={<Users className="h-5 w-5" />}
          title={props.people.length === 0 ? 'Nobody is on this project yet' : 'Nobody in this group'}
          description={props.people.length === 0
            ? 'Add the architect, the site engineer and the main contractor first — those three are what make the register address itself.'
            : 'Try another group, or add someone.'}
          action={props.canConfigure
            ? <Button kind="primary" onClick={() => openEdit(null)}>Add a stakeholder</Button>
            : undefined}
        />
      ) : (
        // One grid at every width — the card is the same object on a phone as
        // on a laptop, so there is no second rendering to keep in step.
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map(p => (
            <article
              key={p.id}
              className={`${SURFACE} flex flex-col p-3.5 transition-shadow ${p.isActive ? 'hover:shadow-[0_2px_10px_rgba(16,24,40,0.07)]' : 'opacity-60'}`}
            >
              <div className="flex items-start gap-2.5">
                <Avatar name={p.name} size="lg" />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-[13px] font-semibold leading-snug text-gray-900">
                    <span className="truncate">{p.name}</span>
                    {p.isLead && <Star className="h-3 w-3 shrink-0 fill-amber-400 text-amber-500" aria-label="Answers for this discipline" />}
                  </p>
                  <p className="truncate text-[12px] text-gray-600">{p.roleOnProject ?? ORG_LABEL[p.orgKind]}</p>
                </div>
                {props.canConfigure && (
                  <RowActions p={p} onEdit={() => openEdit(p)} projectId={props.projectId} />
                )}
              </div>

              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                {p.disciplineName ? <Pill tone="slate">{p.disciplineName}</Pill> : <span className="text-[11px] text-gray-400">No discipline</span>}
                <Pill tone="slate">{ORG_LABEL[p.orgKind]}</Pill>
                {!p.isActive && <Pill tone="slate">No longer on the project</Pill>}
              </div>

              {p.notes && <p className="mt-2 text-[11px] leading-relaxed text-gray-500">{p.notes}</p>}

              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                {p.email && (
                  <a href={`mailto:${p.email}`}
                    className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-gray-50 px-2.5 text-[12px] font-semibold text-gray-700 ring-1 ring-gray-200 hover:bg-gray-100">
                    <Mail className="h-3.5 w-3.5" /> E-mail
                  </a>
                )}
                {p.phone && (
                  <a href={`tel:${p.phone}`}
                    className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-gray-50 px-2.5 text-[12px] font-semibold text-gray-700 ring-1 ring-gray-200 hover:bg-gray-100">
                    <Phone className="h-3.5 w-3.5" /> Call
                  </a>
                )}
                {!p.email && !p.phone && (
                  <span className="text-[11px] text-amber-800">
                    {p.in4PartyId ? `Pinned to IN4 party #${p.in4PartyId} — no contact recorded` : 'No contact recorded'}
                  </span>
                )}
              </div>

              {props.canSeeMoney && (
                <div className="mt-auto border-t border-gray-100 pt-2.5 text-[12px] tabular-nums">
                  {p.orderValue != null ? (
                    <div className="flex items-baseline gap-2">
                      <span className="font-semibold text-gray-900">{formatINR(p.orderValue)}</span>
                      <span className="text-[11px] text-gray-500">
                        paid {formatINR(p.paid ?? 0)} · {p.orders} order{p.orders === 1 ? '' : 's'}
                      </span>
                    </div>
                  ) : (
                    <span className="text-[11px] text-gray-400">
                      {p.in4PartyId ? 'No orders on this project' : 'Not pinned to IN4'}
                    </span>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {!props.canConfigure && (
        <p className="px-1 text-[11px] text-gray-500">
          Who is on the project, and which disciplines it uses, are set by an admin or an Atm Head.
        </p>
      )}

      {overlay === 'disciplines' && <DisciplinePanel {...props} onClose={() => setOverlay('none')} />}
      {overlay === 'person' && <PersonPanel {...props} editing={editing} onClose={() => { setOverlay('none'); setEditing(null) }} />}
      {overlay === 'copy' && <CopyPanel {...props} onClose={() => setOverlay('none')} />}
    </section>
  )
}

function RowActions({ p, projectId, onEdit }: { p: Stakeholder; projectId: string; onEdit: () => void }) {
  const [pending, start] = useTransition()
  return (
    <div className="flex shrink-0 items-center gap-1">
      <button onClick={onEdit} className="rounded px-1.5 py-1 text-[11px] font-semibold text-gray-500 hover:bg-gray-100 hover:text-gray-900">
        Edit
      </button>
      <button
        disabled={pending}
        onClick={() => start(async () => {
          if (p.isActive) await removeStakeholder(p.id, projectId)
          else await restoreStakeholder(p.id, projectId)
        })}
        className="rounded px-1.5 py-1 text-[11px] font-semibold text-gray-400 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
      >
        {p.isActive ? 'Remove' : 'Restore'}
      </button>
    </div>
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
    <Modal
      title="Disciplines on this project"
      subtitle="Only the ones ticked are offered when raising an entry or naming a stakeholder."
      onClose={onClose}
      width="lg"
    >
      <div className="grid gap-1.5 sm:grid-cols-2">
        {disciplines.map(d => {
          const on = chosen.has(d.id)
          const inUse = used.has(d.id)
          return (
            <button
              key={d.id}
              onClick={() => toggle(d.id)}
              aria-pressed={on}
              className={`flex min-h-[44px] items-center gap-2.5 rounded-xl px-3 py-2 text-left ring-1 transition-colors
                ${on ? 'bg-indigo-50/70 ring-indigo-300' : 'bg-white ring-gray-200 hover:bg-gray-50'}`}
            >
              <span className={`grid h-4 w-4 shrink-0 place-items-center rounded ring-1 ${on ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white ring-gray-300'}`} aria-hidden>
                {on && <span className="text-[10px] leading-none">✓</span>}
              </span>
              <span className={`text-[13px] ${on ? 'font-semibold text-indigo-900' : 'text-gray-600'}`}>{d.name}</span>
              {inUse && <span className="ml-auto text-[11px] text-gray-500">in use</span>}
            </button>
          )
        })}
      </div>
      <p className="mt-3 text-[12px] leading-relaxed text-gray-500">
        Switching one off does not remove anyone already named in it — they stay, and the discipline is simply not offered for
        anything new.{used.size > 0 && ` ${used.size} of these have someone named.`}
      </p>
      {error && <div className="mt-2"><Notice>{error}</Notice></div>}
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          kind="primary"
          disabled={pending}
          onClick={() => start(async () => {
            const r = await setProjectDisciplines(projectId, [...chosen])
            if (!r.ok) setError(r.error ?? 'That did not save.'); else onClose()
          })}
        >
          {pending ? 'Saving…' : `Save — ${chosen.size} on`}
        </Button>
      </div>
    </Modal>
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
    <Modal
      title={editing ? 'Edit stakeholder' : 'Add a stakeholder'}
      subtitle={editing ? editing.name : 'A person or firm, and what they are responsible for here.'}
      onClose={onClose}
    >
      <div className="space-y-3.5">
        {error && <Notice>{error}</Notice>}

        <Field label="Which register">
          <Segmented
            size="sm"
            value={orgKind}
            onChange={setOrgKind}
            options={ORG_ORDER.map(o => ({ key: o, label: ORG_LABEL[o] }))}
          />
        </Field>

        {orgKind === 'team' ? (
          <Field label="Who" hint="A team member is a CT Hub user, so entries assigned to them reach them in the hub.">
            <select
              value={userId}
              onChange={e => {
                setUserId(e.target.value)
                const u = users.find(x => x.id === e.target.value)
                if (u) { setName(u.name); setEmail(u.email ?? '') }
              }}
              className={FIELD}
            >
              <option value="">Choose a CT Hub user…</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name} — {u.role}</option>)}
            </select>
          </Field>
        ) : orgKind === 'authority' ? (
          <Field label="Name" hint="Authorities are typed in — IN4 holds no register for them.">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. DGVCL — Valsad" className={FIELD} />
          </Field>
        ) : (
          <div className="space-y-2.5">
            <Field label="Pin to the IN4 party">
              {chosenParty ? (
                <div className="flex items-center gap-2 rounded-xl bg-indigo-50 px-3 py-2 ring-1 ring-indigo-200">
                  <p className="text-[13px] font-semibold text-indigo-900">{chosenParty.name}</p>
                  {chosenParty.city && <p className="text-[11px] text-indigo-700">{chosenParty.city}</p>}
                  <button onClick={() => { setPartyId(''); setPartyQ('') }} className="ml-auto text-[12px] font-semibold text-indigo-700 hover:underline">
                    Change
                  </button>
                </div>
              ) : (
                <>
                  <input value={partyQ} onChange={e => setPartyQ(e.target.value)}
                    placeholder="Type two letters of the firm's name" className={FIELD} />
                  {matches.length > 0 && (
                    <div className="mt-1 max-h-48 divide-y divide-gray-100 overflow-y-auto rounded-xl ring-1 ring-gray-200">
                      {matches.map(p => (
                        <button
                          key={`${p.kind}-${p.id}`}
                          onClick={() => { setPartyId(String(p.id)); if (!name) setName(p.name) }}
                          className="min-h-[44px] w-full px-3 py-2 text-left hover:bg-gray-50"
                        >
                          <p className="text-[13px] text-gray-900">{p.name}</p>
                          <p className="text-[11px] text-gray-500">{p.kind}{p.city ? ` · ${p.city}` : ''}</p>
                        </button>
                      ))}
                    </div>
                  )}
                  {partyQ.trim().length >= 2 && matches.length === 0 && (
                    <p className="mt-1 text-[12px] text-gray-500">
                      No IN4 party matches. Type the name below and leave it unpinned — the order value is simply blank.
                    </p>
                  )}
                </>
              )}
            </Field>
            <Field label="Name shown here">
              <input value={name} onChange={e => setName(e.target.value)} placeholder="The firm's name" className={FIELD} />
            </Field>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Discipline">
            <select value={disciplineId} onChange={e => setDisciplineId(e.target.value)} className={FIELD}>
              <option value="">None</option>
              {enabled.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <Field label="Part on this project">
            <input value={role} onChange={e => setRole(e.target.value)} placeholder="e.g. Lead Architect, Site Engineer" className={FIELD} />
          </Field>
          <Field label="E-mail">
            <input value={email} onChange={e => setEmail(e.target.value)} inputMode="email" className={FIELD} />
          </Field>
          <Field label="Phone">
            <input value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" className={FIELD} />
          </Field>
        </div>

        <label className={`flex cursor-pointer items-start gap-2.5 rounded-xl p-3 ring-1 ${disciplineId ? 'bg-white ring-gray-200' : 'bg-gray-50 ring-gray-100 opacity-60'}`}>
          <input type="checkbox" checked={isLead} disabled={!disciplineId} onChange={e => setIsLead(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-indigo-600" />
          <span className="text-[13px] leading-relaxed text-gray-700">
            <b>Answers for this discipline.</b> New entries of this discipline are addressed to them without anyone choosing.
            One per discipline; naming a new one replaces the old.
          </span>
        </label>

        <Field label="Note">
          <input value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="Anything worth knowing about their involvement" className={FIELD} />
        </Field>

        <div className="flex justify-end gap-2 pt-1">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            kind="primary"
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
                name, roleOnProject: role, email, phone,
                isLead: isLead && !!disciplineId,
                notes,
              })
              if (!r.ok) setError(r.error ?? 'That did not save.'); else onClose()
            })}
          >
            {pending ? 'Saving…' : editing ? 'Save changes' : 'Add to the project'}
          </Button>
        </div>
      </div>
    </Modal>
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
    <Modal
      title={`Copy from ${projectName}`}
      subtitle="Set one project up properly, then give the rest the same shape in a click."
      onClose={onClose}
      width="lg"
    >
      {done ? (
        <div className="space-y-3">
          <Notice tone="emerald">Copied to {targets.size} project{targets.size === 1 ? '' : 's'}. Nothing already there was changed.</Notice>
          <Button kind="primary" onClick={onClose}>Done</Button>
        </div>
      ) : (
        <div className="space-y-4">
          <Field label="What to copy">
            <div className="space-y-1">
              <label className="flex min-h-[36px] cursor-pointer items-center gap-2 text-[13px] text-gray-700">
                <input type="checkbox" checked={withDisciplines} onChange={e => { setWithDisciplines(e.target.checked); setPlan(null) }}
                  className="h-4 w-4 accent-indigo-600" />
                Which disciplines the project uses
              </label>
              <label className="flex min-h-[36px] cursor-pointer items-center gap-2 text-[13px] text-gray-700">
                <input type="checkbox" checked={withPeople} onChange={e => { setWithPeople(e.target.checked); setPlan(null) }}
                  className="h-4 w-4 accent-indigo-600" />
                The people and firms, with their disciplines and parts
              </label>
            </div>
          </Field>

          <Field label="To which projects">
            <div className="grid max-h-56 gap-1.5 overflow-y-auto sm:grid-cols-2">
              {otherProjects.map(p => {
                const on = targets.has(p.id)
                return (
                  <label key={p.id}
                    className={`flex min-h-[40px] cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] ring-1 transition-colors
                      ${on ? 'bg-indigo-50/70 text-indigo-900 ring-indigo-300' : 'bg-white text-gray-700 ring-gray-200 hover:bg-gray-50'}`}>
                    <input type="checkbox" checked={on} onChange={() => toggle(p.id)} className="h-4 w-4 accent-indigo-600" />
                    {p.name}
                  </label>
                )
              })}
            </div>
          </Field>

          <Field label="If a project already has something">
            <div className="space-y-1">
              <label className="flex cursor-pointer items-start gap-2 text-[13px] text-gray-700">
                <input type="radio" checked={mode === 'add'} onChange={() => { setMode('add'); setPlan(null) }} className="mt-1 accent-indigo-600" />
                <span><b>Add what is missing.</b> Nothing already there is changed or removed.</span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 text-[13px] text-gray-700">
                <input type="radio" checked={mode === 'match'} onChange={() => { setMode('match'); setPlan(null) }} className="mt-1 accent-indigo-600" />
                <span><b>Make the disciplines match exactly.</b> Also switches off disciplines {projectName} does not use. People are never removed.</span>
              </label>
            </div>
          </Field>

          {error && <Notice>{error}</Notice>}

          {plan && (
            <div className="rounded-xl bg-indigo-50/70 p-3.5 ring-1 ring-indigo-200">
              <p className="mb-1.5 text-[12px] font-bold text-indigo-900">This is exactly what will happen</p>
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
            <Button onClick={onClose}>Cancel</Button>
            {!plan ? (
              <Button
                disabled={pending || targets.size === 0 || (!withDisciplines && !withPeople)}
                onClick={() => start(async () => {
                  const r = await planCopy(projectId, [...targets], { disciplines: withDisciplines, people: withPeople, mode })
                  if (!r.ok) setError(r.error ?? 'That could not be worked out.'); else { setError(null); setPlan(r.lines) }
                })}
              >
                {pending ? 'Checking…' : 'Show me what will happen'}
              </Button>
            ) : (
              <Button
                kind="primary"
                disabled={pending}
                onClick={() => start(async () => {
                  const r = await applyCopy(projectId, [...targets], { disciplines: withDisciplines, people: withPeople, mode })
                  if (!r.ok) setError(r.error ?? 'That did not save.'); else setDone(true)
                })}
              >
                {pending ? 'Copying…' : 'Copy now'}
              </Button>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
