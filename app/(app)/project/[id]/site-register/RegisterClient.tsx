'use client'

// The register — every entry raised on the project, and who each one is with.
//
// Two renderings of the same list, as every screen in this app has: a wide
// table from xl (its minimum width is 1,000px, and the workspace container
// gives 1,008px at 1280 — at md it overflowed on a laptop), and a stack of
// cards below that. Touch a column here and change the card too.

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ClipboardList, Search } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { MentionTextarea } from '@/components/mentions/MentionTextarea'
import { formatDate, formatINR } from '@/lib/utils'
import {
  FILTER_LABEL, KINDS, KIND_BY_KEY, PRIORITY_LABEL, STATUS_LABEL,
  applyFilter, daysOverdue, daysWaiting, defaultAssignee, defaultDueDate,
  isLive, sortRegister, summarise,
  type Priority, type RegisterFilter, type RegisterRow, type Stakeholder, type ThreadKind,
} from '@/lib/site-register/types'
import { raiseEntry } from '@/lib/site-register/actions'
import type { AssigneeOption, PersonOption } from '@/lib/site-register/queries'
import { EntryDrawer } from './EntryDrawer'
import { Counter, Pill, Who } from './ui'

export interface RegisterClientProps {
  projectId: string
  projectName: string
  rows: RegisterRow[]
  myId: string | null
  initialFilter: RegisterFilter
  scopeAll: boolean
  canWrite: boolean
  people: PersonOption[]
  stakeholders: AssigneeOption[]
  /** For the coverage hint when a discipline has nobody named. */
  stakeholderRecords: Stakeholder[]
  categories: Array<{ id: string; name: string; subs: Array<{ id: string; name: string }> }>
  disciplines: Array<{ id: string; name: string }>
  closedDurations: number[]
  escalationDays: number
  openEntryId: string | null
}

const FILTERS: RegisterFilter[] = ['mine', 'overdue', 'live', 'cost', 'closed']

export function RegisterClient(props: RegisterClientProps) {
  const [filter, setFilter] = useState<RegisterFilter>(props.initialFilter)
  const [kind, setKind] = useState<ThreadKind | 'all'>('all')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(props.openEntryId)
  const [raising, setRaising] = useState(false)
  const router = useRouter()

  const summary = useMemo(
    () => summarise(props.rows, props.myId, props.closedDurations),
    [props.rows, props.myId, props.closedDurations],
  )

  const shown = useMemo(() => {
    const base = applyFilter(props.rows, filter, kind, props.myId)
    const needle = q.trim().toLowerCase()
    const searched = needle
      ? base.filter(r => [r.ref, r.title, r.categoryName, r.subCategoryName, r.assignedToName, r.location]
          .some(v => (v ?? '').toLowerCase().includes(needle)))
      : base
    return sortRegister(searched)
  }, [props.rows, filter, kind, q, props.myId])

  return (
    <section className="space-y-3">
      <header className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <div>
          <h2 className="text-sm font-bold text-gray-900">Discussions</h2>
          <p className="text-xs text-gray-500">
            Site issues, requests for information, instructions, decisions and non-conformances on{' '}
            {props.scopeAll ? 'every project you can see' : props.projectName}. Each one is assigned to a person, with a date it is due back.
          </p>
        </div>
        {props.canWrite && (
          <button
            onClick={() => setRaising(true)}
            className="ml-auto rounded-lg bg-indigo-700 px-3.5 text-xs font-semibold text-white hover:bg-indigo-800 min-h-[44px]"
          >
            New entry
          </button>
        )}
      </header>

      {/* Counters — what a person needs to know before reading a single row. */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <Counter label="Assigned to me" value={summary.mine} note={summary.mine ? 'open with you now' : 'nothing with you'} emphasise />
        <Counter label="Overdue" value={summary.overdue} tone={summary.overdue ? 'rose' : 'slate'} note={`past the response date`} />
        <Counter label="Open" value={summary.live} note="still to be settled" />
        <Counter label="Cost impact" value={summary.costTotal ? formatINR(summary.costTotal) : '—'} tone="amber" note={`${summary.costCount} entr${summary.costCount === 1 ? 'y' : 'ies'} flagged`} />
        <Counter label="Average days to close" value={summary.avgDaysToClose ?? '—'} note={summary.avgDaysToClose == null ? 'nothing closed yet' : 'over everything closed'} />
      </div>

      {/* Filters. The kind row first, because that is how people think about
          what they are looking for; the state row second. */}
      <div className="rounded-lg border border-gray-200 bg-white p-2.5 space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip on={kind === 'all'} onClick={() => setKind('all')}>All kinds</Chip>
          {KINDS.map(k => (
            <Chip key={k.key} on={kind === k.key} onClick={() => setKind(k.key)}>{k.label}</Chip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.map(f => (
            <Chip key={f} on={filter === f} dark onClick={() => setFilter(f)}>{FILTER_LABEL[f]}</Chip>
          ))}
          <label className="relative ml-auto">
            <Search className="h-3.5 w-3.5 text-gray-400 absolute left-2 top-1/2 -translate-y-1/2" />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Search reference, subject, person"
              aria-label="Search the register"
              className="w-full sm:w-64 text-[12px] border border-gray-300 rounded-md pl-7 pr-2 py-1.5 min-h-[36px]"
            />
          </label>
          <span className="text-[12px] text-gray-500 tabular-nums">{shown.length} shown</span>
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white">
          <EmptyState
            icon={<ClipboardList className="h-8 w-8" />}
            title={props.rows.length === 0 ? 'Nothing has been raised yet' : 'Nothing matches this filter'}
            description={props.rows.length === 0
              ? 'The first site issue, query or instruction raised on this project will appear here, with whoever it is assigned to and the date it is due back.'
              : 'Try a wider filter, or clear the search.'}
            action={props.rows.length === 0 && props.canWrite
              ? <button onClick={() => setRaising(true)} className="rounded-lg bg-indigo-700 px-3.5 text-xs font-semibold text-white min-h-[44px]">Raise the first entry</button>
              : <button onClick={() => { setFilter('live'); setKind('all'); setQ('') }} className="text-[13px] font-semibold text-indigo-700">Show every open entry</button>}
          />
        </div>
      ) : (
        <>
          {/* ── Desktop ─────────────────────────────────────────────────── */}
          <div className="hidden xl:block rounded-lg border border-gray-200 bg-white overflow-hidden">
            <div className="overflow-auto max-h-[620px]">
              <table className="w-full text-[13px]" style={{ minWidth: 1000 }}>
                <thead className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200">
                  <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500">
                    <th className="px-3 py-2 font-semibold w-[132px]">Reference</th>
                    <th className="px-3 py-2 font-semibold">Subject</th>
                    <th className="px-3 py-2 font-semibold w-[190px]">Category</th>
                    <th className="px-3 py-2 font-semibold w-[180px]">Assigned to</th>
                    <th className="px-3 py-2 font-semibold w-[104px]">Response due</th>
                    <th className="px-3 py-2 font-semibold w-[110px] text-right">Cost impact</th>
                    <th className="px-3 py-2 font-semibold w-[116px]">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {shown.map(r => {
                    const over = daysOverdue(r.dueOn)
                    const k = KIND_BY_KEY[r.kind]
                    return (
                      <tr
                        key={r.id}
                        onClick={() => setOpen(r.id)}
                        className={`cursor-pointer hover:bg-indigo-50/40 ${over > 0 && isLive(r.status) ? 'bg-rose-50/40' : ''}`}
                      >
                        <td className="px-3 py-2.5 align-top"><Pill tone={k.tone} strong>{r.ref}</Pill></td>
                        <td className="px-3 py-2.5 align-top">
                          <p className="font-semibold text-gray-900 leading-snug">{r.title}</p>
                          <p className="text-[11px] text-gray-500 mt-0.5">
                            {k.label} · raised by {r.raisedByName ?? 'someone'}
                            {r.priority === 'critical' && <span className="text-rose-700 font-semibold"> · Critical</span>}
                            {r.escalated && <span className="text-amber-700 font-semibold"> · escalated</span>}
                            {props.scopeAll && <span className="text-indigo-700 font-semibold"> · {r.projectName}</span>}
                          </p>
                        </td>
                        <td className="px-3 py-2.5 align-top text-[12px] text-gray-600">
                          <p className="text-gray-800">{r.categoryName ?? '—'}</p>
                          {r.subCategoryName && <p>{r.subCategoryName}</p>}
                          {r.location && <p className="text-gray-400">{r.location}</p>}
                        </td>
                        <td className="px-3 py-2.5 align-top">
                          <div className="flex items-start gap-2">
                            <Who name={r.assignedToName} />
                            <div>
                              <p className="text-[12px] font-semibold text-gray-800 leading-tight">{r.assignedToName ?? 'Unassigned'}</p>
                              {isLive(r.status) && (
                                <p className={`text-[11px] ${over > 0 ? 'text-rose-700 font-semibold' : 'text-gray-500'}`}>
                                  {daysWaiting(r.assignedAt) === 0 ? 'since today' : `${daysWaiting(r.assignedAt)} days`}
                                </p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className={`px-3 py-2.5 align-top text-[12px] tabular-nums ${over > 0 && isLive(r.status) ? 'text-rose-700 font-bold' : 'text-gray-700'}`}>
                          {r.dueOn ? formatDate(r.dueOn) : '—'}
                        </td>
                        <td className={`px-3 py-2.5 align-top text-[12px] tabular-nums text-right ${r.costImpact ? 'text-amber-800 font-semibold' : 'text-gray-300'}`}>
                          {r.costImpact ? formatINR(r.costImpact) : '—'}
                        </td>
                        <td className="px-3 py-2.5 align-top">
                          <Pill tone={r.status === 'closed' ? 'emerald' : over > 0 ? 'rose' : r.status === 'responded' ? 'sky' : 'slate'}>
                            {over > 0 && isLive(r.status) ? `Overdue ${over}d` : STATUS_LABEL[r.status]}
                          </Pill>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Phone and tablet ────────────────────────────────────────── */}
          <div className="xl:hidden rounded-lg border border-gray-200 bg-white divide-y divide-gray-100 overflow-hidden">
            {shown.map(r => {
              const over = daysOverdue(r.dueOn)
              const k = KIND_BY_KEY[r.kind]
              return (
                <button
                  key={r.id}
                  onClick={() => setOpen(r.id)}
                  className={`w-full text-left px-3.5 py-3 hover:bg-gray-50 min-h-[44px] ${over > 0 && isLive(r.status) ? 'border-l-2 border-l-rose-500' : ''}`}
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Pill tone={k.tone} strong>{r.ref}</Pill>
                    {r.priority === 'critical' && <Pill tone="rose">Critical</Pill>}
                    <Pill tone={r.status === 'closed' ? 'emerald' : over > 0 ? 'rose' : r.status === 'responded' ? 'sky' : 'slate'}>
                      {over > 0 && isLive(r.status) ? `Overdue ${over}d` : STATUS_LABEL[r.status]}
                    </Pill>
                    {props.scopeAll && <span className="text-[11px] font-semibold text-indigo-700">{r.projectName}</span>}
                  </div>
                  <p className="text-[13px] font-semibold text-gray-900 mt-1.5 leading-snug">{r.title}</p>
                  <p className="text-[12px] text-gray-500 mt-0.5">
                    {[r.categoryName, r.subCategoryName].filter(Boolean).join(' › ') || k.label}
                    {r.location ? ` · ${r.location}` : ''}
                  </p>
                  <div className="flex items-center gap-2 mt-2">
                    <Who name={r.assignedToName} />
                    <p className="text-[12px] text-gray-600">
                      {r.assignedToName ?? 'Unassigned'}
                      {isLive(r.status) && ` · ${daysWaiting(r.assignedAt) === 0 ? 'today' : `${daysWaiting(r.assignedAt)}d`}`}
                    </p>
                    <p className={`ml-auto text-[12px] tabular-nums ${over > 0 && isLive(r.status) ? 'text-rose-700 font-bold' : 'text-gray-500'}`}>
                      {r.dueOn ? `due ${formatDate(r.dueOn)}` : 'no date'}
                    </p>
                  </div>
                  {r.costImpact ? (
                    <p className="text-[12px] text-amber-800 font-semibold tabular-nums mt-1">Cost impact {formatINR(r.costImpact)}</p>
                  ) : null}
                </button>
              )
            })}
          </div>
        </>
      )}

      {open && (
        <EntryDrawer
          key={open}
          entryId={open}
          onClose={() => setOpen(null)}
          onChanged={() => router.refresh()}
          people={props.people}
          stakeholders={props.stakeholders}
          canWrite={props.canWrite}
        />
      )}

      {raising && (
        <RaiseForm
          {...props}
          onClose={() => setRaising(false)}
          onDone={id => { setRaising(false); setOpen(id) }}
        />
      )}
    </section>
  )
}

function Chip({ on, dark, onClick, children }: { on: boolean; dark?: boolean; onClick: () => void; children: React.ReactNode }) {
  const active = dark ? 'bg-gray-900 border-gray-900 text-white' : 'bg-indigo-600 border-indigo-600 text-white'
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`px-2.5 py-1.5 rounded-md text-[12px] font-semibold border min-h-[36px] ${on ? active : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'}`}
    >
      {children}
    </button>
  )
}

/* ── Raising ─────────────────────────────────────────────────────────────
 * Two steps on purpose. Choosing the kind first is what lets the rest of the
 * form be short: it sets the response allowance, the default priority and the
 * words on the description box. Nobody types a reference number.
 */
function RaiseForm({
  projectId, categories, disciplines, people, stakeholders, stakeholderRecords, onClose, onDone,
}: RegisterClientProps & { onClose: () => void; onDone: (id: string) => void }) {
  const [kind, setKind] = useState<ThreadKind | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [mentions, setMentions] = useState<string[]>([])
  const [categoryId, setCategoryId] = useState('')
  const [subId, setSubId] = useState('')
  const [disciplineId, setDisciplineId] = useState('')
  const [assigned, setAssigned] = useState('')
  const [priority, setPriority] = useState<Priority>('normal')
  const [due, setDue] = useState('')
  const [location, setLocation] = useState('')
  const [showCost, setShowCost] = useState(false)
  const [cost, setCost] = useState('')
  const [costNote, setCostNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const subs = categories.find(c => c.id === categoryId)?.subs ?? []

  const pickKind = (k: ThreadKind) => {
    setKind(k)
    setDue(defaultDueDate(k))
    if (k === 'ncr' || k === 'instruction') setPriority('high')
  }

  // Addressing it is the step people get wrong, so the project's own
  // Stakeholders answer it: the named lead for that discipline is filled in
  // the moment a discipline is chosen.
  const pickDiscipline = (id: string) => {
    setDisciplineId(id)
    const lead = defaultAssignee(id || null, stakeholderRecords)
    if (lead) setAssigned(lead.userId ? lead.userId : `s:${lead.id}`)
  }

  const submit = () => {
    if (!kind) return
    const isStake = assigned.startsWith('s:')
    start(async () => {
      const res = await raiseEntry({
        projectId,
        kind,
        title,
        body,
        disciplineId: disciplineId || null,
        categoryId: categoryId || null,
        subCategoryId: subId || null,
        location: location || null,
        priority,
        assignedTo: isStake ? null : (assigned || null),
        assignedStakeholderId: isStake ? assigned.slice(2) : null,
        dueOn: due || null,
        costImpact: showCost && cost ? Number(cost.replace(/[^0-9.]/g, '')) : null,
        costNote: showCost ? costNote : null,
        mentionIds: mentions,
      })
      if (!res.ok) { setError(res.error ?? 'It could not be saved.'); return }
      onDone(res.id!)
    })
  }

  return (
    <>
      <div className="fixed inset-0 bg-gray-900/40 z-40" onClick={onClose} aria-hidden />
      <div className="fixed inset-0 z-50 grid place-items-center p-3 pointer-events-none">
        <div className="bg-white rounded-xl w-full max-w-[620px] max-h-[88vh] overflow-y-auto shadow-2xl pointer-events-auto">
          <div className="px-5 py-4 border-b border-gray-200 flex items-start gap-3 sticky top-0 bg-white z-10">
            <div>
              <p className="text-[15px] font-bold text-gray-900">New entry</p>
              <p className="text-[12px] text-gray-500">
                {kind ? KIND_BY_KEY[kind].label : 'Choose what it is. Everything after that is short.'}
              </p>
            </div>
            <button onClick={onClose} className="ml-auto text-gray-400 text-xl leading-none px-2 min-h-[44px]" aria-label="Close">&times;</button>
          </div>

          {!kind ? (
            <div className="p-4 grid sm:grid-cols-2 gap-2">
              {KINDS.map(k => (
                <button
                  key={k.key}
                  onClick={() => pickKind(k.key)}
                  className="text-left rounded-lg border border-gray-200 bg-white p-3 hover:border-indigo-300 hover:bg-indigo-50/40 min-h-[44px]"
                >
                  <p className="text-[13px] font-bold text-gray-900">{k.label}</p>
                  <p className="text-[12px] text-gray-600 mt-0.5 leading-snug">{k.purpose}</p>
                  <p className="text-[11px] text-gray-400 mt-1">Reference {k.code} · response in {k.defaultDays} working day{k.defaultDays === 1 ? '' : 's'}</p>
                </button>
              ))}
            </div>
          ) : (
            <div className="p-4 space-y-3">
              {error && <p className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-800">{error}</p>}

              <Field label="Subject">
                <input value={title} onChange={e => setTitle(e.target.value)} maxLength={200}
                  placeholder="One line — what this is about"
                  className="w-full text-[13px] border border-gray-300 rounded px-2 py-2 min-h-[40px]" />
              </Field>

              <Field label="Description">
                <MentionTextarea value={body} onChange={(v, ids) => { setBody(v); setMentions(ids) }}
                  rows={4} maxLength={8000}
                  placeholder={kind === 'instruction' ? 'What is to be done or stopped, and by when' : 'What was seen, and what is needed'} />
              </Field>

              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Category">
                  <select value={categoryId} onChange={e => { setCategoryId(e.target.value); setSubId('') }}
                    className="w-full text-[13px] border border-gray-300 rounded px-2 py-2 bg-white min-h-[40px]">
                    <option value="">Not tied to one</option>
                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </Field>
                <Field label="Sub-category">
                  <select value={subId} onChange={e => setSubId(e.target.value)} disabled={!subs.length}
                    className="w-full text-[13px] border border-gray-300 rounded px-2 py-2 bg-white min-h-[40px] disabled:bg-gray-50">
                    <option value="">{subs.length ? 'Not tied to one' : 'Choose a category first'}</option>
                    {subs.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </Field>
                <Field label="Discipline">
                  <select value={disciplineId} onChange={e => pickDiscipline(e.target.value)}
                    className="w-full text-[13px] border border-gray-300 rounded px-2 py-2 bg-white min-h-[40px]">
                    <option value="">None</option>
                    {disciplines.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </Field>
                <Field label="Location on site">
                  <input value={location} onChange={e => setLocation(e.target.value)} placeholder="Block, floor or area"
                    className="w-full text-[13px] border border-gray-300 rounded px-2 py-2 min-h-[40px]" />
                </Field>
              </div>

              <Field label="Assigned to" hint="Filled in from this project's Stakeholders when a discipline is chosen.">
                <select value={assigned} onChange={e => setAssigned(e.target.value)}
                  className="w-full text-[13px] border border-gray-300 rounded px-2 py-2 bg-white min-h-[40px]">
                  <option value="">Choose a person or firm…</option>
                  <optgroup label="CT Hub users">
                    {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </optgroup>
                  {stakeholders.length > 0 && (
                    <optgroup label="Project stakeholders">
                      {stakeholders.map(s => (
                        <option key={s.id} value={`s:${s.id}`}>{s.name}{s.discipline ? ` — ${s.discipline}` : ''}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </Field>

              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Response due">
                  <input type="date" value={due} onChange={e => setDue(e.target.value)}
                    className="w-full text-[13px] border border-gray-300 rounded px-2 py-2 min-h-[40px]" />
                </Field>
                <Field label="Priority">
                  <select value={priority} onChange={e => setPriority(e.target.value as Priority)}
                    className="w-full text-[13px] border border-gray-300 rounded px-2 py-2 bg-white min-h-[40px]">
                    {(['low', 'normal', 'high', 'critical'] as Priority[]).map(p =>
                      <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
                  </select>
                </Field>
              </div>

              {!showCost ? (
                <button onClick={() => setShowCost(true)} className="text-[12px] font-semibold text-indigo-700">
                  + This has a cost impact
                </button>
              ) : (
                <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 space-y-2">
                  <Field label="Cost impact">
                    <input value={cost} onChange={e => setCost(e.target.value)} inputMode="decimal" placeholder="Amount in rupees"
                      className="w-full text-[13px] border border-gray-300 rounded px-2 py-2 min-h-[40px] tabular-nums" />
                  </Field>
                  <input value={costNote} onChange={e => setCostNote(e.target.value)} placeholder="What the figure covers"
                    className="w-full text-[13px] border border-gray-300 rounded px-2 py-2 min-h-[40px]" />
                  <p className="text-[11px] text-gray-600">No budget moves from here. It marks the entry so the money is not forgotten.</p>
                </div>
              )}

              <div className="flex items-center gap-2 pt-1">
                <button onClick={() => setKind(null)} className="text-[12px] font-semibold text-gray-600 min-h-[40px]">Back</button>
                <button
                  onClick={submit}
                  disabled={pending || !title.trim() || !body.trim() || !assigned}
                  className="ml-auto rounded-lg bg-indigo-700 px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50 min-h-[44px]"
                >
                  {pending ? 'Saving…' : 'Raise it'}
                </button>
              </div>
              {!assigned && <p className="text-[11px] text-gray-500 text-right">Choose who it is assigned to — an entry always has someone responsible.</p>}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">{label}</p>
      {children}
      {hint && <p className="text-[11px] text-gray-500 mt-1">{hint}</p>}
    </div>
  )
}
