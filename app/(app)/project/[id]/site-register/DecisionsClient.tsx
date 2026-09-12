'use client'

// The decision tree: category → sub-category → the specification agreed.
//
// Reading and configuring are separated on purpose. The page shows only what
// the project says is applicable; choosing what is applicable is one button,
// for admins, and it opens the full list with tick boxes over the page. A
// screen that mixed the two would put 91 checkboxes in front of someone who
// only wanted to read what the tile is.

import { useMemo, useState, useTransition } from 'react'
import { ClipboardCheck } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { formatDate, todayISO } from '@/lib/utils'
import {
  DECISION_LABEL, FLAG_WINDOW_DAYS, daysBetween, isFlagged, summariseDecisions,
  type DecisionCategory, type DecisionRow,
} from '@/lib/site-register/types'
import {
  copyApplicability, fetchDecisionHistory, recordDecision, setApplicability, setDecisionState,
} from '@/lib/site-register/actions'
import { Counter, Pill } from './ui'

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
const VIEWS: Array<{ key: View; label: string }> = [
  { key: 'outstanding', label: 'Outstanding' },
  { key: 'flagged', label: 'Needed soon' },
  { key: 'approved', label: 'Approved' },
  { key: 'all', label: 'Everything applicable' },
]

export function DecisionsClient(props: DecisionsClientProps) {
  const [view, setView] = useState<View>('outstanding')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [manage, setManage] = useState(false)
  const [copying, setCopying] = useState(false)
  const [editing, setEditing] = useState<DecisionRow | null>(null)

  const summary = useMemo(() => summariseDecisions(props.categories), [props.categories])

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

  // With a filter applied the answer is usually short, so everything opens.
  // On "Everything applicable" it would be a wall, so it starts closed.
  const isOpen = (id: string) => (view === 'all' ? open.has(id) : !open.has(id))
  const toggle = (id: string) => {
    const next = new Set(open)
    if (next.has(id)) next.delete(id); else next.add(id)
    setOpen(next)
  }

  return (
    <section className="space-y-3">
      <header className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div>
          <h2 className="text-sm font-bold text-gray-900">Decisions &amp; Specifications</h2>
          <p className="text-xs text-gray-500">
            What has to be settled on {props.projectName}, against the same categories the budget uses. Only the
            sub-categories the project says need a decision are shown.
          </p>
        </div>
        {props.canConfigure && (
          <div className="ml-auto flex flex-wrap gap-1.5">
            <button onClick={() => setManage(true)} className="rounded-lg border border-gray-300 bg-white px-3 text-xs font-semibold text-gray-700 min-h-[44px]">
              Choose what applies
            </button>
            <button onClick={() => setCopying(true)} className="rounded-lg border border-gray-300 bg-white px-3 text-xs font-semibold text-gray-700 min-h-[44px]">
              Copy to…
            </button>
          </div>
        )}
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Counter label="Needs a decision" value={summary.applicable} note={`of ${summary.total} sub-categories`} />
        <Counter label="Approved" value={summary.approved} tone="emerald" note={summary.applicable ? `${Math.round((summary.approved / summary.applicable) * 100)}% settled` : '—'} />
        <Counter label="Outstanding" value={summary.outstanding} tone="amber" note="not yet specified" />
        <Counter label="Needed within 21 days" value={summary.flagged} tone={summary.flagged ? 'rose' : 'slate'} note="procurement is waiting" emphasise={summary.flagged > 0} />
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-2.5 flex flex-wrap items-center gap-1.5">
        {VIEWS.map(v => (
          <button
            key={v.key}
            onClick={() => setView(v.key)}
            aria-pressed={view === v.key}
            className={`px-2.5 py-1.5 rounded-md text-[12px] font-semibold border min-h-[36px] ${view === v.key ? 'bg-gray-900 border-gray-900 text-white' : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'}`}
          >
            {v.label}
          </button>
        ))}
        <span className="ml-auto text-[12px] text-gray-500 tabular-nums">
          {flatRows.length} row{flatRows.length === 1 ? '' : 's'}
        </span>
      </div>

      {flatRows.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white">
          <EmptyState
            icon={<ClipboardCheck className="h-8 w-8" />}
            title={summary.applicable === 0 ? 'Nothing is marked as needing a decision yet' : 'Nothing in this view'}
            description={summary.applicable === 0
              ? 'Most sub-categories need no specification decision. Tick the ones that do — the tile, the sanitaryware, the lift — and they appear here with who owes the answer.'
              : 'Everything in this view is settled. Try another one.'}
            action={props.canConfigure && summary.applicable === 0
              ? <button onClick={() => setManage(true)} className="rounded-lg bg-indigo-700 px-3.5 text-xs font-semibold text-white min-h-[44px]">Choose what applies</button>
              : <button onClick={() => setView('all')} className="text-[13px] font-semibold text-indigo-700">Show everything applicable</button>}
          />
        </div>
      ) : props.flat ? (
        /* ── Sub-category wise: one flat list, category named on each row ── */
        <div className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100">
          {flatRows.map(r => (
            <DecisionLine key={r.subCategoryId} row={r} showCategory canRecord={props.canRecord} onEdit={() => setEditing(r)} />
          ))}
        </div>
      ) : (
        /* ── Category wise: the tree ──────────────────────────────────── */
        <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
          {cats.map(c => {
            const opened = isOpen(c.categoryId)
            const approved = c.shown.filter(r => r.status === 'approved').length
            const flagged = c.shown.filter(r => isFlagged(r)).length
            return (
              <div key={c.categoryId} className="border-b border-gray-100 last:border-0">
                <button
                  onClick={() => toggle(c.categoryId)}
                  aria-expanded={opened}
                  className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-gray-50 text-left min-h-[44px]"
                >
                  <span className="text-gray-400 text-[12px] w-3">{opened ? '▾' : '▸'}</span>
                  <p className="text-[13px] font-bold text-gray-900">{c.name}</p>
                  <span className="text-[11px] text-gray-500 tabular-nums">{c.shown.length} row{c.shown.length === 1 ? '' : 's'}</span>
                  <span className="ml-auto flex gap-1">
                    {flagged > 0 && <Pill tone="rose">{flagged} needed soon</Pill>}
                    {approved > 0 && <Pill tone="emerald">{approved} approved</Pill>}
                  </span>
                </button>
                {opened && (
                  <div className="pl-6 pb-1">
                    {c.shown.map(r => (
                      <div key={r.subCategoryId} className="border-l border-gray-200 pl-3">
                        <DecisionLine row={r} canRecord={props.canRecord} onEdit={() => setEditing(r)} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {!props.canConfigure && (
        <p className="text-[12px] text-gray-500">Which sub-categories need a decision is set by an admin or an Atm Head.</p>
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
  const flagged = isFlagged(row)
  const daysLeft = row.requiredBy ? daysBetween(todayISO(), row.requiredBy.slice(0, 10)) : null
  return (
    <div className={`flex items-start gap-2 py-2 pr-3 ${flagged ? 'bg-rose-50/50' : ''}`}>
      <div className="min-w-0 flex-1">
        {showCategory && <p className="text-[11px] text-gray-400">{row.categoryName}</p>}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-[13px] font-semibold text-gray-800">{row.subCategoryName}</p>
          <Pill tone={row.status === 'approved' ? 'emerald' : flagged ? 'rose' : row.status === 'under_review' ? 'sky' : 'amber'}>
            {DECISION_LABEL[row.status]}
          </Pill>
          {row.revision > 1 && <Pill>Revision {row.revision}</Pill>}
          {row.openRefs.map(ref => (
            <span key={ref} className="text-[11px] font-semibold text-indigo-700">↔ {ref}</span>
          ))}
        </div>

        {row.status === 'approved' && row.spec ? (
          <>
            <p className="text-[12px] text-gray-700 mt-0.5 whitespace-pre-wrap break-words">{row.spec}</p>
            <p className="text-[11px] text-gray-500">
              {row.decidedByName ?? 'Recorded'}{row.decidedOn ? ` · ${formatDate(row.decidedOn)}` : ''}
              {row.revision > 1 && ' · earlier specifications kept'}
            </p>
          </>
        ) : (
          <p className={`text-[11px] mt-0.5 ${flagged ? 'text-rose-700 font-semibold' : 'text-gray-500'}`}>
            {row.ownerName ? `With ${row.ownerName}` : 'Nobody named yet'}
            {row.requiredBy
              ? ` · needed by ${formatDate(row.requiredBy)}${daysLeft != null ? ` (${daysLeft < 0 ? `${-daysLeft} days late` : `${daysLeft} days left`})` : ''}`
              : ' · no date set'}
          </p>
        )}
      </div>
      {canRecord && row.id && (
        <button onClick={onEdit} className="text-[12px] font-semibold text-indigo-700 shrink-0 min-h-[36px]">
          {row.status === 'approved' ? 'Revise' : 'Record'}
        </button>
      )}
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
        <div className={`bg-white rounded-xl w-full ${wide ? 'max-w-[720px]' : 'max-w-[580px]'} max-h-[88vh] overflow-y-auto shadow-2xl pointer-events-auto`}>
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

/* ── Choosing what applies — the whole tree, with tick boxes ─────────────── */

function ApplicabilityPanel({ projectId, categories, onClose }: DecisionsClientProps & { onClose: () => void }) {
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(categories.flatMap(c => c.rows.filter(r => r.isApplicable).map(r => r.subCategoryId as string))),
  )
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const startingSet = useMemo(
    () => new Set(categories.flatMap(c => c.rows.filter(r => r.isApplicable).map(r => r.subCategoryId as string))),
    [categories],
  )

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

  return (
    <Overlay
      title="Choose what needs a decision"
      subtitle="Tick a category to take all of it; the box shows a dash when only some of its rows are ticked."
      onClose={onClose}
      wide
    >
      <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 max-h-[50vh] overflow-y-auto">
        {categories.map(c => {
          const ids = c.rows.map(r => r.subCategoryId as string)
          const on = ids.filter(id => picked.has(id)).length
          const box = on === 0 ? '☐' : on === ids.length ? '☑' : '⊟'
          const opened = open.has(c.categoryId)
          return (
            <div key={c.categoryId}>
              <div className="flex items-center gap-2 px-3 py-2">
                <button onClick={() => toggleCat(c)} aria-label={`Toggle ${c.name}`}
                  className={`text-[16px] leading-none ${on ? 'text-indigo-600' : 'text-gray-300'} min-h-[36px] min-w-[24px]`}>
                  {box}
                </button>
                <button onClick={() => toggleOpen(c.categoryId)} aria-expanded={opened}
                  className="flex-1 text-left flex items-center gap-2 min-h-[36px]">
                  <span className="text-gray-400 text-[12px] w-3">{opened ? '▾' : '▸'}</span>
                  <span className="text-[13px] font-bold text-gray-900">{c.name}</span>
                  <span className="text-[11px] text-gray-500 tabular-nums">{on} of {ids.length}</span>
                </button>
              </div>
              {opened && (
                <div className="pl-9 pb-2">
                  {c.rows.map(r => {
                    const id = r.subCategoryId as string
                    const on2 = picked.has(id)
                    return (
                      <button
                        key={id}
                        onClick={() => toggleSub(id)}
                        className="w-full flex items-center gap-2 text-left py-1.5 min-h-[36px]"
                      >
                        <span className={`text-[15px] leading-none ${on2 ? 'text-indigo-600' : 'text-gray-300'}`}>{on2 ? '☑' : '☐'}</span>
                        <span className={`text-[13px] ${on2 ? 'text-gray-900 font-medium' : 'text-gray-500'}`}>{r.subCategoryName}</span>
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

      <p className="text-[12px] text-gray-500 mt-3">
        {picked.size} of {categories.reduce((s, c) => s + c.rows.length, 0)} sub-categories marked.
        {added.length > 0 && ` ${added.length} newly ticked.`}
        {removed.length > 0 && ` ${removed.length} unticked — any specification already recorded on those is kept, just not shown.`}
      </p>
      {error && <p className="mt-2 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-800">{error}</p>}

      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="px-3.5 py-2 rounded-md border border-gray-300 text-[13px] font-semibold text-gray-700 min-h-[40px]">Cancel</button>
        <button
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
          className="px-3.5 py-2 rounded-md bg-indigo-700 text-white text-[13px] font-semibold disabled:opacity-50 min-h-[40px]"
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Overlay>
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
    <Overlay
      title={row.status === 'approved' ? 'Revise the specification' : 'Record the specification'}
      subtitle={`${row.categoryName} › ${row.subCategoryName}`}
      onClose={onClose}
    >
      <div className="space-y-3">
        {error && <p className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-800">{error}</p>}

        {row.status === 'approved' && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-[12px] text-amber-900">
              <b>This already has a specification.</b> Saving a new one keeps the old as revision {row.revision} — nothing is
              overwritten, so &ldquo;we changed it in July&rdquo; always has a record.
            </p>
          </div>
        )}

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">The specification</p>
          <textarea
            value={spec}
            onChange={e => setSpec(e.target.value)}
            rows={4}
            maxLength={4000}
            placeholder="Make, model, size, finish, rate basis — enough that a work order can be written from it"
            className="w-full text-[13px] border border-gray-300 rounded px-2 py-2"
          />
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Needed by</p>
            <input type="date" value={requiredBy} onChange={e => setRequiredBy(e.target.value)}
              className="w-full text-[13px] border border-gray-300 rounded px-2 py-2 min-h-[40px]" />
            <p className="text-[11px] text-gray-500 mt-1">Within {FLAG_WINDOW_DAYS} days and still unsettled, it is flagged.</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">With whom</p>
            <select value={owner} onChange={e => setOwner(e.target.value)}
              className="w-full text-[13px] border border-gray-300 rounded px-2 py-2 bg-white min-h-[40px]">
              <option value="">{row.ownerName ? `Unchanged — ${row.ownerName}` : 'Nobody named'}</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
        </div>

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Note</p>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Why this was chosen (optional)"
            className="w-full text-[13px] border border-gray-300 rounded px-2 py-2 min-h-[40px]" />
        </div>

        {row.revision > 0 && (
          <div>
            <button
              onClick={() => { if (!history && row.id) fetchDecisionHistory(row.id).then(setHistory) }}
              className="text-[12px] font-semibold text-indigo-700"
            >
              {history ? 'Earlier specifications' : 'Show earlier specifications'}
            </button>
            {history && (
              <div className="mt-2 rounded-lg border border-gray-200 divide-y divide-gray-100">
                {history.length === 0
                  ? <p className="px-3 py-2 text-[12px] text-gray-500">Nothing earlier recorded.</p>
                  : history.map(h => (
                      <div key={h.revision} className="px-3 py-2">
                        <p className="text-[11px] text-gray-500">Revision {h.revision}{h.on ? ` · ${formatDate(h.on)}` : ''}{h.by ? ` · ${h.by}` : ''}</p>
                        <p className="text-[13px] text-gray-700 whitespace-pre-wrap">{h.spec ?? '—'}</p>
                        {h.note && <p className="text-[11px] text-gray-500">{h.note}</p>}
                      </div>
                    ))}
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-3.5 py-2 rounded-md border border-gray-300 text-[13px] font-semibold text-gray-700 min-h-[40px]">Cancel</button>
          <button
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
            className="px-3.5 py-2 rounded-md bg-indigo-700 text-white text-[13px] font-semibold disabled:opacity-50 min-h-[40px]"
          >
            {pending ? 'Saving…' : spec.trim() ? 'Record it as approved' : 'Save the date and owner'}
          </button>
        </div>
        {!spec.trim() && (
          <p className="text-[11px] text-gray-500 text-right">
            With no specification written this only saves the date and who it is with — the row stays outstanding.
          </p>
        )}
      </div>
    </Overlay>
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
    <Overlay
      title={`Copy what applies, from ${projectName}`}
      subtitle="Only the ticks are copied. A specification belongs to its own project and is never carried across."
      onClose={onClose}
      wide
    >
      {result ? (
        <div className="space-y-3">
          <p className="text-[13px] text-gray-800">
            {result.copied} sub-categor{result.copied === 1 ? 'y' : 'ies'} marked across {targets.size} project{targets.size === 1 ? '' : 's'}.
          </p>
          {result.skipped > 0 && (
            <p className="text-[12px] text-gray-500">
              {result.skipped} were skipped because those projects do not have that sub-category switched on in their own budget.
            </p>
          )}
          <button onClick={onClose} className="px-3.5 py-2 rounded-md bg-indigo-700 text-white text-[13px] font-semibold min-h-[40px]">Done</button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-1.5 max-h-64 overflow-y-auto">
            {otherProjects.map(p => (
              <label key={p.id} className="flex items-center gap-2 text-[13px] text-gray-700 cursor-pointer border border-gray-200 rounded px-2 py-1.5 min-h-[40px]">
                <input type="checkbox" checked={targets.has(p.id)} onChange={() => toggle(p.id)} className="h-4 w-4 accent-indigo-600" />
                {p.name}
              </label>
            ))}
          </div>
          {error && <p className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-800">{error}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="px-3.5 py-2 rounded-md border border-gray-300 text-[13px] font-semibold text-gray-700 min-h-[40px]">Cancel</button>
            <button
              disabled={pending || targets.size === 0}
              onClick={() => start(async () => {
                const r = await copyApplicability(projectId, [...targets])
                if (!r.ok) setError(r.error ?? 'That did not save.'); else setResult({ copied: r.copied, skipped: r.skipped })
              })}
              className="px-3.5 py-2 rounded-md bg-indigo-700 text-white text-[13px] font-semibold disabled:opacity-50 min-h-[40px]"
            >
              {pending ? 'Copying…' : 'Copy'}
            </button>
          </div>
        </div>
      )}
    </Overlay>
  )
}
