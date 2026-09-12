'use client'

// Decisions & Specifications — category → sub-category → the specification
// agreed against it.
//
// WHAT THE SCREEN IS FOR. Not "browse the tree" — the tree is only the shape.
// It is for answering "what is still unsettled, and which of those is about to
// hold up an order". So the flagged rows are lifted OUT of the tree into a
// lane at the top, where they are read before anything is expanded, and the
// tree below is the full picture for whoever wants it.
//
// Reading and configuring stay apart. The page shows only what the project
// says is applicable; choosing what is applicable is one button, for admins,
// and it opens the full list over the page. A screen that mixed the two would
// put ninety checkboxes in front of someone who only wanted to know what the
// tile is.

import { useMemo, useState, useTransition } from 'react'
import { ClipboardCheck, AlertTriangle } from 'lucide-react'
import { formatDate, todayISO } from '@/lib/utils'
import {
  DECISION_LABEL, FLAG_WINDOW_DAYS, daysBetween, isFlagged, summariseDecisions,
  type DecisionCategory, type DecisionRow, type Tone,
} from '@/lib/site-register/types'
import {
  copyApplicability, fetchDecisionHistory, recordDecision, setApplicability, setDecisionState,
} from '@/lib/site-register/actions'
import {
  Button, EmptyPanel, Field, FIELD, Metric, Modal, Notice,
  Pill, Ring, SectionHead, Segmented, Status, SURFACE,
} from './ui'

export interface DecisionsClientProps {
  projectId: string
  projectName: string
  categories: DecisionCategory[]
  /** The second pill: every applicable sub-category as one flat list, rather
   *  than nested under its category. */
  flat: boolean
  canConfigure: boolean
  canRecord: boolean
  disciplines: Array<{ id: string; name: string }>
  users: Array<{ id: string; name: string }>
  otherProjects: Array<{ id: string; name: string }>
}

type View = 'outstanding' | 'flagged' | 'approved' | 'all'

/** What one row's state looks like — decided once, used by the lane, the tree
 *  and the flat list. */
function stateOf(row: DecisionRow): { tone: Tone; text: string; flagged: boolean; daysLeft: number | null } {
  const flagged = isFlagged(row)
  const daysLeft = row.requiredBy ? daysBetween(todayISO(), row.requiredBy.slice(0, 10)) : null
  if (row.status === 'approved') return { tone: 'emerald', text: DECISION_LABEL.approved, flagged: false, daysLeft }
  if (flagged) return { tone: 'rose', text: daysLeft != null && daysLeft < 0 ? `${-daysLeft} days late` : 'Needed soon', flagged, daysLeft }
  if (row.status === 'under_review') return { tone: 'sky', text: DECISION_LABEL.under_review, flagged, daysLeft }
  if (row.status === 'superseded') return { tone: 'slate', text: DECISION_LABEL.superseded, flagged, daysLeft }
  return { tone: 'amber', text: DECISION_LABEL.pending, flagged, daysLeft }
}

export function DecisionsClient(props: DecisionsClientProps) {
  const [view, setView] = useState<View>('outstanding')
  const [opened, setOpened] = useState<Set<string>>(new Set())
  const [manage, setManage] = useState(false)
  const [copying, setCopying] = useState(false)
  const [editing, setEditing] = useState<DecisionRow | null>(null)

  const summary = useMemo(() => summariseDecisions(props.categories), [props.categories])
  const applicable = useMemo(() => props.categories.flatMap(c => c.rows).filter(r => r.isApplicable), [props.categories])
  const flagged = useMemo(
    () => applicable.filter(r => isFlagged(r)).sort((a, b) => (a.requiredBy ?? '').localeCompare(b.requiredBy ?? '')),
    [applicable],
  )

  const cats = useMemo(() => {
    const visible = (r: DecisionRow) => {
      if (!r.isApplicable) return false
      if (view === 'approved') return r.status === 'approved'
      if (view === 'outstanding') return r.status !== 'approved'
      if (view === 'flagged') return isFlagged(r)
      return true
    }
    return props.categories
      .map(c => ({ ...c, shown: c.rows.filter(visible) }))
      .filter(c => c.shown.length > 0)
  }, [props.categories, view])

  const flatRows = useMemo(() => cats.flatMap(c => c.shown), [cats])

  // With a filter on, the answer is short, so categories open. On "Everything"
  // it would be a wall, so they start closed.
  const isOpen = (id: string) => (view === 'all' ? opened.has(id) : !opened.has(id))
  const toggle = (id: string) => {
    const next = new Set(opened)
    if (next.has(id)) next.delete(id); else next.add(id)
    setOpened(next)
  }

  return (
    <section className="space-y-3.5">
      <SectionHead
        title="Decisions & Specifications"
        subtitle={<>What has to be settled on <b className="text-gray-700">{props.projectName}</b>, against the same categories the budget
          uses — so a specification sits where its money sits. Only the sub-categories the project says need a decision are shown.</>}
        actions={props.canConfigure && (
          <>
            <Button onClick={() => setManage(true)}>Choose what applies</Button>
            <Button onClick={() => setCopying(true)}>Copy to…</Button>
          </>
        )}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <Metric label="Needs a decision" value={summary.applicable} note={`of ${summary.total} sub-categories`} />
        <Metric
          label="Settled" value={summary.approved} tone="emerald"
          note={summary.applicable ? `${Math.round((summary.approved / summary.applicable) * 100)}% of what applies` : '—'}
          bar={summary.applicable ? { of: summary.applicable, value: summary.approved } : undefined}
        />
        <Metric label="Outstanding" value={summary.outstanding} tone="amber" note="no specification yet" />
        <Metric
          label={`Needed within ${FLAG_WINDOW_DAYS} days`} value={summary.flagged}
          tone={summary.flagged ? 'rose' : 'slate'} lead={summary.flagged > 0}
          note={summary.flagged ? 'procurement is waiting on these' : 'nothing is holding an order'}
        />
      </div>

      {/* ── The lane: what will hold up an order ────────────────────────── */}
      {flagged.length > 0 && (
        <div className="overflow-hidden rounded-xl bg-rose-50/60 ring-1 ring-rose-200">
          <div className="flex items-center gap-2 border-b border-rose-200/70 px-3.5 py-2.5">
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
            <p className="text-[13px] font-semibold text-rose-900">
              {flagged.length} specification{flagged.length === 1 ? '' : 's'} needed within {FLAG_WINDOW_DAYS} days and not settled
            </p>
            <span className="ml-auto text-[11px] text-rose-700">soonest first</span>
          </div>
          <ul className="divide-y divide-rose-200/50">
            {flagged.slice(0, 6).map(r => {
              const st = stateOf(r)
              return (
                <li key={r.subCategoryId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-gray-900">{r.subCategoryName}</p>
                    <p className="text-[11px] text-gray-600">
                      {r.categoryName}{r.ownerName ? ` · with ${r.ownerName}` : ' · nobody named'}
                      {r.openRefs.length > 0 && <span className="font-semibold text-indigo-700"> · {r.openRefs.join(', ')}</span>}
                    </p>
                  </div>
                  <p className="text-[12px] font-bold tabular-nums text-rose-700">
                    {st.daysLeft != null && st.daysLeft < 0 ? `${-st.daysLeft} days late` : `${st.daysLeft} days left`}
                  </p>
                  {props.canRecord && r.id && (
                    <Button onClick={() => setEditing(r)}>Record</Button>
                  )}
                </li>
              )
            })}
          </ul>
          {flagged.length > 6 && (
            <button onClick={() => setView('flagged')} className="w-full px-3.5 py-2 text-left text-[12px] font-semibold text-rose-800 hover:bg-rose-100/60">
              Show all {flagged.length} →
            </button>
          )}
        </div>
      )}

      <div className={`${SURFACE} flex flex-wrap items-center gap-2 p-2.5`}>
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { key: 'outstanding' as const, label: 'Outstanding', count: summary.outstanding, tone: 'amber' },
            { key: 'flagged' as const, label: 'Needed soon', count: summary.flagged, tone: 'rose' },
            { key: 'approved' as const, label: 'Settled', count: summary.approved, tone: 'emerald' },
            { key: 'all' as const, label: 'Everything', count: summary.applicable },
          ]}
        />
        <span className="ml-auto text-[12px] tabular-nums text-gray-500">
          {flatRows.length} row{flatRows.length === 1 ? '' : 's'}
        </span>
      </div>

      {flatRows.length === 0 ? (
        <EmptyPanel
          icon={<ClipboardCheck className="h-5 w-5" />}
          title={summary.applicable === 0 ? 'Nothing is marked as needing a decision yet' : 'Nothing in this view'}
          description={summary.applicable === 0
            ? 'Most sub-categories need no specification decision. Tick the ones that do — the tile, the sanitaryware, the lift — and they appear here with who owes the answer and when it is needed.'
            : 'Everything in this view is settled. Try another one.'}
          action={props.canConfigure && summary.applicable === 0
            ? <Button kind="primary" onClick={() => setManage(true)}>Choose what applies</Button>
            : <Button onClick={() => setView('all')}>Show everything applicable</Button>}
        />
      ) : props.flat ? (
        /* ── Sub-category wise: one flat list, category named on each row ── */
        <div className={`${SURFACE} divide-y divide-gray-100 overflow-hidden`}>
          {flatRows.map(r => (
            <DecisionLine key={r.subCategoryId} row={r} showCategory canRecord={props.canRecord} onEdit={() => setEditing(r)} />
          ))}
        </div>
      ) : (
        /* ── Category wise: the tree ────────────────────────────────────── */
        <div className={`${SURFACE} overflow-hidden`}>
          {cats.map((c, i) => {
            const open = isOpen(c.categoryId)
            const approved = c.rows.filter(r => r.isApplicable && r.status === 'approved').length
            const total = c.rows.filter(r => r.isApplicable).length
            const late = c.shown.filter(r => isFlagged(r)).length
            return (
              <div key={c.categoryId} className={i > 0 ? 'border-t border-gray-100' : ''}>
                <button
                  onClick={() => toggle(c.categoryId)}
                  aria-expanded={open}
                  className="flex min-h-[52px] w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-gray-50/80"
                >
                  <span className="w-3 shrink-0 text-[11px] text-gray-400">{open ? '▾' : '▸'}</span>
                  <Ring done={approved} total={total} />
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-gray-900">{c.name}</p>
                    <p className="text-[11px] tabular-nums text-gray-500">
                      {approved} of {total} settled
                      {c.shown.length !== total && ` · ${c.shown.length} shown`}
                    </p>
                  </div>
                  <span className="ml-auto flex shrink-0 items-center gap-1.5">
                    {late > 0 && <Pill tone="rose">{late} needed soon</Pill>}
                    {total - approved > 0 && <Pill tone="amber">{total - approved} outstanding</Pill>}
                  </span>
                </button>

                {open && (
                  <div className="bg-gray-50/50 pb-1 pl-8">
                    <div className="divide-y divide-gray-100 border-l border-gray-200">
                      {c.shown.map(r => (
                        <DecisionLine key={r.subCategoryId} row={r} canRecord={props.canRecord} onEdit={() => setEditing(r)} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {!props.canConfigure && (
        <p className="px-1 text-[11px] text-gray-500">
          Which sub-categories need a decision is set by an admin or an Atm Head.
        </p>
      )}

      {manage && <ApplicabilityPanel {...props} onClose={() => setManage(false)} />}
      {copying && <CopyPanel {...props} onClose={() => setCopying(false)} />}
      {editing && <RecordPanel {...props} row={editing} onClose={() => setEditing(null)} />}
    </section>
  )
}

/* ── One row, in both renderings ─────────────────────────────────────────── */

function DecisionLine({ row, showCategory, canRecord, onEdit }: {
  row: DecisionRow; showCategory?: boolean; canRecord: boolean; onEdit: () => void
}) {
  const st = stateOf(row)
  return (
    <div className={`relative flex items-start gap-3 py-2.5 pl-3.5 pr-3.5 ${st.flagged ? 'bg-rose-50/40' : 'bg-white'}`}>
      {st.flagged && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r bg-rose-500" aria-hidden />}
      <div className="min-w-0 flex-1">
        {showCategory && <p className="text-[11px] text-gray-400">{row.categoryName}</p>}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-[13px] font-semibold text-gray-800">{row.subCategoryName}</p>
          <Status tone={st.tone}>{st.text}</Status>
          {row.revision > 1 && <Pill tone="slate">Revision {row.revision}</Pill>}
          {row.openRefs.map(ref => (
            <span key={ref} className="text-[11px] font-semibold text-indigo-700">↔ {ref}</span>
          ))}
        </div>

        {row.status === 'approved' && row.spec ? (
          <>
            <p className="mt-1 whitespace-pre-wrap break-words text-[12px] leading-relaxed text-gray-700">{row.spec}</p>
            <p className="mt-0.5 text-[11px] text-gray-500">
              {row.decidedByName ?? 'Recorded'}{row.decidedOn ? ` · ${formatDate(row.decidedOn)}` : ''}
              {row.revision > 1 && ' · earlier specifications kept'}
            </p>
          </>
        ) : (
          <p className={`mt-0.5 text-[11px] ${st.flagged ? 'font-semibold text-rose-700' : 'text-gray-500'}`}>
            {row.ownerName ? `With ${row.ownerName}` : 'Nobody named yet'}
            {row.requiredBy
              ? ` · needed by ${formatDate(row.requiredBy)}${st.daysLeft != null ? ` (${st.daysLeft < 0 ? `${-st.daysLeft} days late` : `${st.daysLeft} days left`})` : ''}`
              : ' · no date set'}
          </p>
        )}
      </div>
      {canRecord && row.id && (
        <button onClick={onEdit} className="shrink-0 rounded-lg px-2 py-1.5 text-[12px] font-semibold text-indigo-700 hover:bg-indigo-50">
          {row.status === 'approved' ? 'Revise' : 'Record'}
        </button>
      )}
    </div>
  )
}

/* ── Choosing what applies — the whole tree, with tick boxes ─────────────── */

function ApplicabilityPanel({ projectId, categories, onClose }: DecisionsClientProps & { onClose: () => void }) {
  const startingSet = useMemo(
    () => new Set(categories.flatMap(c => c.rows.filter(r => r.isApplicable).map(r => r.subCategoryId as string))),
    [categories],
  )
  const [picked, setPicked] = useState<Set<string>>(() => new Set(startingSet))
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const toggleSub = (id: string) => {
    const next = new Set(picked)
    if (next.has(id)) next.delete(id); else next.add(id)
    setPicked(next)
  }
  const toggleCat = (c: DecisionCategory) => {
    const ids = c.rows.map(r => r.subCategoryId as string)
    const all = ids.every(id => picked.has(id))
    const next = new Set(picked)
    ids.forEach(id => (all ? next.delete(id) : next.add(id)))
    setPicked(next)
  }
  const toggleOpen = (id: string) => {
    const next = new Set(open)
    if (next.has(id)) next.delete(id); else next.add(id)
    setOpen(next)
  }

  const added = [...picked].filter(id => !startingSet.has(id))
  const removed = [...startingSet].filter(id => !picked.has(id))
  const total = categories.reduce((s, c) => s + c.rows.length, 0)

  return (
    <Modal
      title="Choose what needs a decision"
      subtitle="Tick a category to take all of it. A half-ticked category shows a dash."
      onClose={onClose}
      width="lg"
    >
      <div className="max-h-[50vh] divide-y divide-gray-100 overflow-y-auto rounded-xl ring-1 ring-gray-200">
        {categories.map(c => {
          const ids = c.rows.map(r => r.subCategoryId as string)
          const on = ids.filter(id => picked.has(id)).length
          const opened = open.has(c.categoryId)
          return (
            <div key={c.categoryId}>
              <div className="flex items-center gap-2.5 px-3 py-2">
                <button
                  onClick={() => toggleCat(c)}
                  aria-label={`Toggle ${c.name}`}
                  className={`grid h-4 w-4 shrink-0 place-items-center rounded ring-1
                    ${on === 0 ? 'bg-white ring-gray-300' : on === ids.length ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-indigo-100 ring-indigo-400'}`}
                >
                  {on === ids.length ? <span className="text-[10px] leading-none">✓</span>
                    : on > 0 ? <span className="h-0.5 w-2 rounded bg-indigo-600" /> : null}
                </button>
                <button onClick={() => toggleOpen(c.categoryId)} aria-expanded={opened}
                  className="flex min-h-[36px] flex-1 items-center gap-2 text-left">
                  <span className="w-3 text-[11px] text-gray-400">{opened ? '▾' : '▸'}</span>
                  <span className="text-[13px] font-semibold text-gray-900">{c.name}</span>
                  <span className="text-[11px] tabular-nums text-gray-500">{on} of {ids.length}</span>
                </button>
              </div>
              {opened && (
                <div className="pb-2 pl-9">
                  {c.rows.map(r => {
                    const id = r.subCategoryId as string
                    const on2 = picked.has(id)
                    return (
                      <button key={id} onClick={() => toggleSub(id)}
                        className="flex min-h-[36px] w-full items-center gap-2.5 py-1.5 text-left">
                        <span className={`grid h-4 w-4 shrink-0 place-items-center rounded ring-1 ${on2 ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white ring-gray-300'}`}>
                          {on2 && <span className="text-[10px] leading-none">✓</span>}
                        </span>
                        <span className={`text-[13px] ${on2 ? 'font-medium text-gray-900' : 'text-gray-500'}`}>{r.subCategoryName}</span>
                        {r.status === 'approved' && <span className="ml-auto text-[11px] text-emerald-700">has a specification</span>}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <p className="mt-3 text-[12px] leading-relaxed text-gray-500">
        {picked.size} of {total} sub-categories marked.
        {added.length > 0 && ` ${added.length} newly ticked.`}
        {removed.length > 0 && ` ${removed.length} unticked — any specification already recorded on those is kept, just not shown.`}
      </p>
      {error && <div className="mt-2"><Notice>{error}</Notice></div>}

      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          kind="primary"
          disabled={pending}
          onClick={() => start(async () => {
            if (added.length) {
              const r = await setApplicability(projectId, added, true)
              if (!r.ok) { setError(r.error ?? 'That did not save.'); return }
            }
            if (removed.length) {
              const r = await setApplicability(projectId, removed, false)
              if (!r.ok) { setError(r.error ?? 'That did not save.'); return }
            }
            onClose()
          })}
        >
          {pending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </Modal>
  )
}

/* ── Recording a specification ───────────────────────────────────────────── */

function RecordPanel({ projectId, row, users, onClose }: DecisionsClientProps & { row: DecisionRow; onClose: () => void }) {
  const [spec, setSpec] = useState(row.spec ?? '')
  const [note, setNote] = useState('')
  const [requiredBy, setRequiredBy] = useState(row.requiredBy?.slice(0, 10) ?? '')
  const [owner, setOwner] = useState('')
  const [history, setHistory] = useState<Array<{ revision: number; spec: string | null; by: string | null; on: string | null; note: string | null }> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  return (
    <Modal
      title={row.status === 'approved' ? 'Revise the specification' : 'Record the specification'}
      subtitle={`${row.categoryName} › ${row.subCategoryName}`}
      onClose={onClose}
    >
      <div className="space-y-3.5">
        {error && <Notice>{error}</Notice>}

        {row.status === 'approved' && (
          <Notice tone="amber">
            <b>This already has a specification.</b> Saving a new one keeps the old as revision {row.revision} — nothing is
            overwritten, so &ldquo;we changed it in July&rdquo; always has a record.
          </Notice>
        )}

        <Field label="The specification">
          <textarea
            value={spec}
            onChange={e => setSpec(e.target.value)}
            rows={4}
            maxLength={4000}
            placeholder="Make, model, size, finish, rate basis — enough that a work order can be written from it"
            className={`${FIELD} min-h-[96px] leading-relaxed`}
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Needed by" hint={`Within ${FLAG_WINDOW_DAYS} days and still unsettled, it is flagged at the top of the page.`}>
            <input type="date" value={requiredBy} onChange={e => setRequiredBy(e.target.value)} className={FIELD} />
          </Field>
          <Field label="With whom">
            <select value={owner} onChange={e => setOwner(e.target.value)} className={FIELD}>
              <option value="">{row.ownerName ? `Unchanged — ${row.ownerName}` : 'Nobody named'}</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </Field>
        </div>

        <Field label="Note">
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Why this was chosen (optional)" className={FIELD} />
        </Field>

        {row.revision > 0 && (
          <div>
            <button
              onClick={() => { if (!history && row.id) fetchDecisionHistory(row.id).then(setHistory) }}
              className="text-[12px] font-semibold text-indigo-700 hover:underline"
            >
              {history ? 'Earlier specifications' : 'Show earlier specifications'}
            </button>
            {history && (
              <div className="mt-2 divide-y divide-gray-100 rounded-xl ring-1 ring-gray-200">
                {history.length === 0
                  ? <p className="px-3 py-2 text-[12px] text-gray-500">Nothing earlier recorded.</p>
                  : history.map(h => (
                      <div key={h.revision} className="px-3 py-2">
                        <p className="text-[11px] text-gray-500">
                          Revision {h.revision}{h.on ? ` · ${formatDate(h.on)}` : ''}{h.by ? ` · ${h.by}` : ''}
                        </p>
                        <p className="whitespace-pre-wrap text-[13px] text-gray-700">{h.spec ?? '—'}</p>
                        {h.note && <p className="text-[11px] text-gray-500">{h.note}</p>}
                      </div>
                    ))}
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
          {!spec.trim() && (
            <p className="mr-auto text-[11px] leading-tight text-gray-500">
              With no specification written this saves only the date and who it is with.
            </p>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button
            kind="primary"
            disabled={pending || !row.id}
            onClick={() => start(async () => {
              if (!row.id) return
              // The date and owner save whether or not a specification is
              // written, so someone can set "needed by" first and settle the
              // specification later — which is the usual order on site.
              const patch = await setDecisionState(row.id, projectId, {
                requiredBy: requiredBy || null,
                ownerId: owner || undefined,
              })
              if (!patch.ok) { setError(patch.error ?? 'That did not save.'); return }
              if (!spec.trim()) { onClose(); return }
              const r = await recordDecision(row.id, projectId, spec, note)
              if (!r.ok) { setError(r.error ?? 'That did not save.'); return }
              onClose()
            })}
          >
            {pending ? 'Saving…' : spec.trim() ? 'Record it as settled' : 'Save the date and owner'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/* ── Copying the ticks to other projects ─────────────────────────────────── */

function CopyPanel({ projectId, projectName, otherProjects, onClose }: DecisionsClientProps & { onClose: () => void }) {
  const [targets, setTargets] = useState<Set<string>>(new Set())
  const [result, setResult] = useState<{ copied: number; skipped: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const toggle = (id: string) => {
    const next = new Set(targets)
    if (next.has(id)) next.delete(id); else next.add(id)
    setTargets(next)
  }

  return (
    <Modal
      title={`Copy what applies, from ${projectName}`}
      subtitle="Only the ticks are copied. A specification belongs to its own project and is never carried across."
      onClose={onClose}
      width="lg"
    >
      {result ? (
        <div className="space-y-3">
          <Notice tone="emerald">
            {result.copied} sub-categor{result.copied === 1 ? 'y' : 'ies'} marked across {targets.size} project{targets.size === 1 ? '' : 's'}.
            {result.skipped > 0 && ` ${result.skipped} were skipped because those projects do not have that sub-category switched on in their own budget.`}
          </Notice>
          <Button kind="primary" onClick={onClose}>Done</Button>
        </div>
      ) : (
        <div className="space-y-4">
          <Field label="To which projects">
            <div className="grid max-h-64 gap-1.5 overflow-y-auto sm:grid-cols-2">
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
          {error && <Notice>{error}</Notice>}
          <div className="flex justify-end gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button
              kind="primary"
              disabled={pending || targets.size === 0}
              onClick={() => start(async () => {
                const r = await copyApplicability(projectId, [...targets])
                if (!r.ok) setError(r.error ?? 'That did not save.'); else setResult({ copied: r.copied, skipped: r.skipped })
              })}
            >
              {pending ? 'Copying…' : 'Copy'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
