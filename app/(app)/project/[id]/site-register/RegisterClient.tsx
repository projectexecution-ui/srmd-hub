'use client'

// The register — every entry raised on the project, and who each one is with.
//
// LAYOUT. Two renderings of the same list, as every screen in this app has: a
// wide table from xl (its minimum width is 1,000px and the workspace container
// gives 1,008px at 1280 — at md it overflowed on a laptop), and a stack of
// cards below that. Touch a column here and change the card too.
//
// READING ORDER. A person opens this to answer one question — what needs me —
// so the screen answers it in this order: the four figures, then the view
// switch already set to their own list, then the rows. Overdue rows carry a
// rail and a full red age bar, so lateness is a SHAPE before it is a number.
//
// GROUPING is the quiet power here. Fifty entries flat is a scroll; the same
// fifty by assignee is a conversation with four people.

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ClipboardList, Search, Plus } from 'lucide-react'
import { MentionTextarea } from '@/components/mentions/MentionTextarea'
import { formatDate, formatINR } from '@/lib/utils'
import {
  KINDS, KIND_BY_KEY, PRIORITY_LABEL, STATUS_LABEL,
  applyFilter, daysBetween, daysOverdue, daysWaiting, defaultAssignee, defaultDueDate,
  isLive, sortRegister, summarise,
  type Priority, type RegisterFilter, type RegisterRow, type Stakeholder, type ThreadKind, type Tone,
} from '@/lib/site-register/types'
import { raiseEntry } from '@/lib/site-register/actions'
import type { AssigneeOption, PersonOption } from '@/lib/site-register/queries'
import { EntryDrawer } from './EntryDrawer'
import {
  Avatar, AgeBar, Button, Chip, EmptyPanel, Field, FIELD, Label, Metric, Modal,
  Notice, Pill, SectionHead, Segmented, Status, SURFACE,
} from './ui'

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
  stakeholderRecords: Stakeholder[]
  categories: Array<{ id: string; name: string; subs: Array<{ id: string; name: string }> }>
  disciplines: Array<{ id: string; name: string }>
  closedDurations: number[]
  escalationDays: number
  openEntryId: string | null
}

type GroupBy = 'none' | 'assignee' | 'category' | 'kind'

const GROUPS: Array<{ key: GroupBy; label: string }> = [
  { key: 'none', label: 'No grouping' },
  { key: 'assignee', label: 'By person' },
  { key: 'category', label: 'By category' },
  { key: 'kind', label: 'By type' },
]

/** The status a row shows, as one decision — used by the table, the card and
 *  the drawer, so they can never disagree. */
export function statusOf(r: RegisterRow): { tone: Tone; text: string; over: number } {
  const over = daysOverdue(r.dueOn)
  if (r.status === 'closed') return { tone: 'emerald', text: 'Closed', over: 0 }
  if (r.status === 'cancelled') return { tone: 'slate', text: 'Cancelled', over: 0 }
  if (over > 0) return { tone: 'rose', text: `Overdue ${over}d`, over }
  if (r.status === 'responded') return { tone: 'sky', text: 'Responded', over: 0 }
  return { tone: 'slate', text: STATUS_LABEL[r.status], over: 0 }
}

export function RegisterClient(props: RegisterClientProps) {
  const [filter, setFilter] = useState<RegisterFilter>(props.initialFilter)
  const [kinds, setKinds] = useState<Set<ThreadKind>>(new Set())
  const [groupBy, setGroupBy] = useState<GroupBy>('none')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(props.openEntryId)
  const [raising, setRaising] = useState(false)
  const [cursor, setCursor] = useState(-1)
  const searchRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  const summary = useMemo(
    () => summarise(props.rows, props.myId, props.closedDurations),
    [props.rows, props.myId, props.closedDurations],
  )
  const counts = useMemo(() => ({
    mine: applyFilter(props.rows, 'mine', 'all', props.myId).length,
    overdue: applyFilter(props.rows, 'overdue', 'all', props.myId).length,
    live: applyFilter(props.rows, 'live', 'all', props.myId).length,
    closed: applyFilter(props.rows, 'closed', 'all', props.myId).length,
  }), [props.rows, props.myId])

  const shown = useMemo(() => {
    const base = applyFilter(props.rows, filter, 'all', props.myId)
      .filter(r => kinds.size === 0 || kinds.has(r.kind))
    const needle = q.trim().toLowerCase()
    const searched = needle
      ? base.filter(r => [r.ref, r.title, r.categoryName, r.subCategoryName, r.assignedToName, r.location, r.raisedByName]
          .some(v => (v ?? '').toLowerCase().includes(needle)))
      : base
    return sortRegister(searched)
  }, [props.rows, filter, kinds, q, props.myId])

  // Grouped, in the order the groups should be worked: the reader's own first
  // when grouping by person, otherwise most rows first.
  const sections = useMemo(() => {
    if (groupBy === 'none') return [{ key: 'all', label: '', rows: shown }]
    const by = new Map<string, RegisterRow[]>()
    for (const r of shown) {
      const k = groupBy === 'assignee' ? (r.assignedToName ?? 'Unassigned')
        : groupBy === 'category' ? (r.categoryName ?? 'No category')
        : KIND_BY_KEY[r.kind].label
      const arr = by.get(k)
      if (arr) arr.push(r); else by.set(k, [r])
    }
    return [...by.entries()]
      .map(([label, rows]) => ({ key: label, label, rows }))
      .sort((a, b) => b.rows.length - a.rows.length || a.label.localeCompare(b.label))
  }, [shown, groupBy])

  const flat = useMemo(
    () => sections.filter(s => !collapsed.has(s.key)).flatMap(s => s.rows),
    [sections, collapsed],
  )

  // Keyboard: / to search, j/k to move, Enter to open, Escape to clear.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (open || raising) return
      const el = e.target as HTMLElement | null
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      if (e.key === '/' && !typing) { e.preventDefault(); searchRef.current?.focus(); return }
      if (typing) return
      if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(flat.length - 1, c + 1)) }
      else if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(0, c - 1)) }
      else if (e.key === 'Enter' && cursor >= 0 && flat[cursor]) { e.preventDefault(); setOpen(flat[cursor].id) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [flat, cursor, open, raising])

  useEffect(() => {
    if (cursor < 0 || !flat[cursor]) return
    document.getElementById(`entry-${flat[cursor].id}`)?.scrollIntoView({ block: 'nearest' })
  }, [cursor, flat])

  const toggleKind = (k: ThreadKind) => {
    const next = new Set(kinds)
    if (next.has(k)) next.delete(k); else next.add(k)
    setKinds(next)
    setCursor(-1)
  }
  const toggleSection = (key: string) => {
    const next = new Set(collapsed)
    if (next.has(key)) next.delete(key); else next.add(key)
    setCollapsed(next)
  }

  return (
    <section className="space-y-3.5">
      <SectionHead
        title="Discussions"
        subtitle={<>Site issues, requests for information, instructions, decisions and non-conformances on{' '}
          <b className="text-gray-700">{props.scopeAll ? 'every project you can see' : props.projectName}</b>. Each is assigned to one
          person, with a date it is due back.</>}
        actions={props.canWrite && (
          <Button kind="primary" onClick={() => setRaising(true)}>
            <Plus className="h-3.5 w-3.5" /> New entry
          </Button>
        )}
      />

      {/* The four figures, in the order they are acted on. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <Metric
          label="Assigned to me" value={summary.mine} lead
          note={summary.mine ? 'open with you now' : 'nothing waiting on you'}
          bar={summary.live > 0 ? { of: summary.live, value: summary.mine } : undefined}
        />
        <Metric
          label="Overdue" value={summary.overdue} tone={summary.overdue ? 'rose' : 'slate'}
          note={summary.overdue ? 'past the response date' : 'everything within its date'}
          bar={summary.live > 0 ? { of: summary.live, value: summary.overdue } : undefined}
        />
        <Metric
          label="Cost impact" value={summary.costTotal ? formatINR(summary.costTotal) : '—'} tone="amber"
          note={`${summary.costCount} entr${summary.costCount === 1 ? 'y' : 'ies'} carrying a figure`}
        />
        <Metric
          label="Average days to close" value={summary.avgDaysToClose ?? '—'}
          note={summary.avgDaysToClose == null ? 'nothing closed yet' : 'over everything closed'}
        />
      </div>

      {/* Command bar: the view, the search, and the two shaping controls. */}
      <div className={`${SURFACE} p-2.5 space-y-2.5`}>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            value={filter}
            onChange={v => { setFilter(v); setCursor(-1) }}
            options={[
              { key: 'mine', label: 'Assigned to me', count: counts.mine, tone: 'sky' },
              { key: 'overdue', label: 'Overdue', count: counts.overdue, tone: 'rose' },
              { key: 'live', label: 'Open', count: counts.live },
              { key: 'closed', label: 'Closed', count: counts.closed },
            ]}
          />
          <label className="relative ml-auto min-w-[200px] flex-1 sm:flex-none sm:w-72">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
            <input
              ref={searchRef}
              value={q}
              onChange={e => { setQ(e.target.value); setCursor(-1) }}
              placeholder="Search reference, subject, person   /"
              aria-label="Search the register"
              className={`${FIELD} pl-8 text-[12px] min-h-[36px]`}
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {KINDS.map(k => (
            <Chip key={k.key} on={kinds.has(k.key)} onClick={() => toggleKind(k.key)}>
              {k.label}
            </Chip>
          ))}
          {/* Its own line below the type chips until there is room beside
              them — at 760px the two rows ran together and the group control
              read as a sixth chip. */}
          <div className="flex basis-full items-center gap-2 sm:basis-auto sm:ml-auto">
            <Label>Group</Label>
            <Segmented size="sm" value={groupBy} onChange={setGroupBy} options={GROUPS} />
          </div>
        </div>
      </div>

      {shown.length === 0 ? (
        <EmptyPanel
          icon={<ClipboardList className="h-5 w-5" />}
          title={props.rows.length === 0 ? 'Nothing has been raised yet' : 'Nothing matches this view'}
          description={props.rows.length === 0
            ? 'The first site issue, query or instruction raised here will appear with whoever it is assigned to and the date it is due back.'
            : 'Try a wider view, clear the type filters, or empty the search.'}
          action={props.rows.length === 0 && props.canWrite
            ? <Button kind="primary" onClick={() => setRaising(true)}>Raise the first entry</Button>
            : <Button onClick={() => { setFilter('live'); setKinds(new Set()); setQ('') }}>Show every open entry</Button>}
        />
      ) : (
        <div className="space-y-2.5">
          {sections.map(section => {
            const isCollapsed = collapsed.has(section.key)
            return (
              <div key={section.key} className={groupBy === 'none' ? '' : 'space-y-1.5'}>
                {groupBy !== 'none' && (
                  <button
                    onClick={() => toggleSection(section.key)}
                    aria-expanded={!isCollapsed}
                    className="flex w-full items-center gap-2 px-1 py-1 text-left min-h-[36px]"
                  >
                    <span className="text-gray-400 text-[11px] w-3">{isCollapsed ? '▸' : '▾'}</span>
                    {groupBy === 'assignee' && <Avatar name={section.label} />}
                    <span className="text-[13px] font-semibold text-gray-800">{section.label}</span>
                    <span className="text-[11px] text-gray-400 tabular-nums">{section.rows.length}</span>
                    {section.rows.some(r => daysOverdue(r.dueOn) > 0 && isLive(r.status)) && (
                      <Pill tone="rose">{section.rows.filter(r => daysOverdue(r.dueOn) > 0 && isLive(r.status)).length} overdue</Pill>
                    )}
                    <span className="ml-auto h-px flex-1 bg-gray-100" aria-hidden />
                  </button>
                )}

                {!isCollapsed && (
                  <>
                    {/* ── Desktop ─────────────────────────────────────── */}
                    <div className={`hidden xl:block overflow-hidden ${SURFACE}`}>
                      <div className="overflow-auto max-h-[640px]">
                        <table className="w-full text-[13px]" style={{ minWidth: 1000 }}>
                          <thead className="sticky top-0 z-10 bg-gray-50/95 backdrop-blur">
                            <tr className="text-left text-[11px] uppercase tracking-[0.06em] text-gray-500 border-b border-gray-200">
                              <th className="px-3 py-2 font-semibold w-[136px]">Reference</th>
                              <th className="px-3 py-2 font-semibold">Subject</th>
                              <th className="px-3 py-2 font-semibold w-[186px]">Category</th>
                              <th className="px-3 py-2 font-semibold w-[178px]">Assigned to</th>
                              <th className="px-3 py-2 font-semibold w-[112px]">Response due</th>
                              <th className="px-3 py-2 font-semibold w-[108px] text-right">Cost impact</th>
                              <th className="px-3 py-2 font-semibold w-[116px]">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {section.rows.map(r => {
                              const k = KIND_BY_KEY[r.kind]
                              const st = statusOf(r)
                              const waiting = daysWaiting(r.assignedAt)
                              const allowed = r.dueOn && r.assignedAt
                                ? Math.max(1, daysBetween(r.assignedAt.slice(0, 10), r.dueOn.slice(0, 10)))
                                : k.defaultDays
                              const focused = flat[cursor]?.id === r.id
                              return (
                                <tr
                                  key={r.id}
                                  id={`entry-${r.id}`}
                                  onClick={() => setOpen(r.id)}
                                  className={`group cursor-pointer transition-colors ${focused ? 'bg-indigo-50/70' : 'hover:bg-gray-50/80'}`}
                                >
                                  <td className="relative px-3 py-2.5 align-top">
                                    {st.over > 0 && <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r bg-rose-500" aria-hidden />}
                                    <Pill tone={k.tone} strong>{r.ref}</Pill>
                                  </td>
                                  <td className="px-3 py-2.5 align-top">
                                    <p className="font-semibold text-gray-900 leading-snug">{r.title}</p>
                                    <p className="mt-0.5 text-[11px] text-gray-500">
                                      {k.label} · raised by {r.raisedByName ?? 'someone'}
                                      {r.priority === 'critical' && <span className="text-rose-700 font-semibold"> · Critical</span>}
                                      {r.priority === 'high' && <span className="text-amber-700 font-semibold"> · High</span>}
                                      {r.escalated && <span className="text-amber-700 font-semibold"> · escalated</span>}
                                      {props.scopeAll && <span className="text-indigo-700 font-semibold"> · {r.projectName}</span>}
                                      {r.posts > 1 && <span className="text-gray-400"> · {r.posts} replies</span>}
                                    </p>
                                  </td>
                                  <td className="px-3 py-2.5 align-top text-[12px] text-gray-600">
                                    <p className="text-gray-800">{r.categoryName ?? '—'}</p>
                                    {r.subCategoryName && <p className="truncate">{r.subCategoryName}</p>}
                                    {r.location && <p className="text-gray-400">{r.location}</p>}
                                  </td>
                                  <td className="px-3 py-2.5 align-top">
                                    <div className="flex items-start gap-2">
                                      <Avatar name={r.assignedToName} />
                                      <div className="min-w-0">
                                        <p className="text-[12px] font-semibold text-gray-800 leading-tight truncate">
                                          {r.assignedToName ?? 'Unassigned'}
                                        </p>
                                        {isLive(r.status) && (
                                          <>
                                            <p className={`text-[11px] ${st.over > 0 ? 'text-rose-700 font-semibold' : 'text-gray-500'}`}>
                                              {waiting === 0 ? 'since today' : `${waiting} day${waiting === 1 ? '' : 's'}`}
                                            </p>
                                            <AgeBar elapsed={waiting} allowed={allowed} over={st.over > 0} />
                                          </>
                                        )}
                                      </div>
                                    </div>
                                  </td>
                                  <td className={`px-3 py-2.5 align-top text-[12px] tabular-nums ${st.over > 0 ? 'text-rose-700 font-bold' : 'text-gray-700'}`}>
                                    {r.dueOn ? formatDate(r.dueOn) : '—'}
                                  </td>
                                  <td className={`px-3 py-2.5 align-top text-right text-[12px] tabular-nums ${r.costImpact ? 'text-amber-800 font-semibold' : 'text-gray-300'}`}>
                                    {r.costImpact ? formatINR(r.costImpact) : '—'}
                                  </td>
                                  <td className="px-3 py-2.5 align-top"><Status tone={st.tone}>{st.text}</Status></td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* ── Phone and tablet ───────────────────────────── */}
                    <div className={`xl:hidden overflow-hidden divide-y divide-gray-100 ${SURFACE}`}>
                      {section.rows.map(r => {
                        const k = KIND_BY_KEY[r.kind]
                        const st = statusOf(r)
                        const waiting = daysWaiting(r.assignedAt)
                        return (
                          <button
                            key={r.id}
                            id={`entry-${r.id}`}
                            onClick={() => setOpen(r.id)}
                            className="relative w-full px-3.5 py-3 text-left hover:bg-gray-50 min-h-[44px]"
                          >
                            {st.over > 0 && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r bg-rose-500" aria-hidden />}
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Pill tone={k.tone} strong>{r.ref}</Pill>
                              {r.priority === 'critical' && <Pill tone="rose">Critical</Pill>}
                              <span className="ml-auto"><Status tone={st.tone}>{st.text}</Status></span>
                            </div>
                            <p className="mt-1.5 text-[13px] font-semibold text-gray-900 leading-snug">{r.title}</p>
                            <p className="mt-0.5 text-[12px] text-gray-500">
                              {[r.categoryName, r.subCategoryName].filter(Boolean).join(' › ') || k.label}
                              {r.location ? ` · ${r.location}` : ''}
                              {props.scopeAll ? ` · ${r.projectName}` : ''}
                            </p>
                            <div className="mt-2 flex items-center gap-2">
                              <Avatar name={r.assignedToName} />
                              <p className="text-[12px] text-gray-600 truncate">
                                {r.assignedToName ?? 'Unassigned'}
                                {isLive(r.status) && ` · ${waiting === 0 ? 'today' : `${waiting}d`}`}
                              </p>
                              <p className={`ml-auto text-[12px] tabular-nums shrink-0 ${st.over > 0 ? 'text-rose-700 font-bold' : 'text-gray-500'}`}>
                                {r.dueOn ? `due ${formatDate(r.dueOn)}` : 'no date'}
                              </p>
                            </div>
                            {r.costImpact ? (
                              <p className="mt-1 text-[12px] font-semibold text-amber-800 tabular-nums">
                                Cost impact {formatINR(r.costImpact)}
                              </p>
                            ) : null}
                          </button>
                        )
                      })}
                    </div>
                  </>
                )}
              </div>
            )
          })}

          <p className="px-1 text-[11px] text-gray-400">
            {shown.length} shown · <b className="font-semibold text-gray-500">/</b> to search,{' '}
            <b className="font-semibold text-gray-500">j</b> / <b className="font-semibold text-gray-500">k</b> to move,{' '}
            <b className="font-semibold text-gray-500">Enter</b> to open
          </p>
        </div>
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
        <RaiseForm {...props} onClose={() => setRaising(false)} onDone={id => { setRaising(false); setOpen(id) }} />
      )}
    </section>
  )
}

/* ── Raising ─────────────────────────────────────────────────────────────
 * Two steps on purpose. Choosing the type first is what lets the rest of the
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
  // Stakeholders answer it: the named lead for that discipline fills in the
  // moment a discipline is chosen.
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
        projectId, kind, title, body,
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
    <Modal
      title={kind ? KIND_BY_KEY[kind].label : 'New entry'}
      subtitle={kind ? 'Four fields and it is raised.' : 'Choose what it is — everything after that is short.'}
      onClose={onClose}
      width="lg"
    >
      {!kind ? (
        <div className="grid sm:grid-cols-2 gap-2">
          {KINDS.map(k => (
            <button
              key={k.key}
              onClick={() => pickKind(k.key)}
              className={`group rounded-xl bg-white p-3.5 text-left ring-1 ring-gray-200 transition-all hover:ring-indigo-300 hover:shadow-[0_2px_8px_rgba(16,24,40,0.06)] min-h-[44px]`}
            >
              <div className="flex items-center gap-2">
                <Pill tone={k.tone} strong>{k.code}</Pill>
                <p className="text-[13px] font-semibold text-gray-900">{k.label}</p>
              </div>
              <p className="mt-1.5 text-[12px] leading-relaxed text-gray-600">{k.purpose}</p>
              <p className="mt-1.5 text-[11px] text-gray-400">
                Response in {k.defaultDays} working day{k.defaultDays === 1 ? '' : 's'}
              </p>
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-3.5">
          {error && <Notice>{error}</Notice>}

          <Field label="Subject">
            <input value={title} onChange={e => setTitle(e.target.value)} maxLength={200}
              placeholder="One line — what this is about" className={FIELD} />
          </Field>

          <Field label="Description">
            <MentionTextarea value={body} onChange={(v, ids) => { setBody(v); setMentions(ids) }}
              rows={4} maxLength={8000}
              placeholder={kind === 'instruction' ? 'What is to be done or stopped, and by when' : 'What was seen, and what is needed'} />
          </Field>

          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Category">
              <select value={categoryId} onChange={e => { setCategoryId(e.target.value); setSubId('') }} className={FIELD}>
                <option value="">Not tied to one</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Sub-category">
              <select value={subId} onChange={e => setSubId(e.target.value)} disabled={!subs.length}
                className={`${FIELD} disabled:bg-gray-50 disabled:text-gray-400`}>
                <option value="">{subs.length ? 'Not tied to one' : 'Choose a category first'}</option>
                {subs.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Discipline">
              <select value={disciplineId} onChange={e => pickDiscipline(e.target.value)} className={FIELD}>
                <option value="">None</option>
                {disciplines.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
            <Field label="Location on site">
              <input value={location} onChange={e => setLocation(e.target.value)} placeholder="Block, floor or area" className={FIELD} />
            </Field>
          </div>

          <Field label="Assigned to" hint="Filled in from this project's Stakeholders the moment a discipline is chosen.">
            <select value={assigned} onChange={e => setAssigned(e.target.value)} className={FIELD}>
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
              <input type="date" value={due} onChange={e => setDue(e.target.value)} className={FIELD} />
            </Field>
            <Field label="Priority">
              <select value={priority} onChange={e => setPriority(e.target.value as Priority)} className={FIELD}>
                {(['low', 'normal', 'high', 'critical'] as Priority[]).map(p =>
                  <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
              </select>
            </Field>
          </div>

          {!showCost ? (
            <button onClick={() => setShowCost(true)} className="text-[12px] font-semibold text-indigo-700 hover:underline">
              + This has a cost impact
            </button>
          ) : (
            <div className="rounded-xl bg-amber-50/60 p-3 ring-1 ring-amber-200 space-y-2">
              <Field label="Cost impact">
                <input value={cost} onChange={e => setCost(e.target.value)} inputMode="decimal"
                  placeholder="Amount in rupees" className={`${FIELD} tabular-nums`} />
              </Field>
              <input value={costNote} onChange={e => setCostNote(e.target.value)}
                placeholder="What the figure covers" className={FIELD} />
              <p className="text-[11px] text-gray-600">No budget moves from here. It marks the entry so the money is not forgotten.</p>
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <Button kind="ghost" onClick={() => setKind(null)}>Back</Button>
            <div className="ml-auto flex items-center gap-2">
              {!assigned && <p className="text-[11px] text-gray-500">Choose who it is assigned to</p>}
              <Button kind="primary" onClick={submit} disabled={pending || !title.trim() || !body.trim() || !assigned}>
                {pending ? 'Saving…' : 'Raise it'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}
