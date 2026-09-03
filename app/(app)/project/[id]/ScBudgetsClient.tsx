'use client'
import { useMemo, useState, useTransition } from 'react'
import { Printer, Check, ChevronDown, X, Save } from 'lucide-react'
import {
  MEASURES, UNITS, buildRows, filterLines, totalRow, formatCell, pdfColumnsOf,
  describeSelection, measure, usableBuckets, toSaved,
  type SourceLine, type Selection, type MeasureId, type Grouping, type Unit, type Bucket,
} from '@/lib/revamp/sc-budgets'
import { saveScLayout } from './sc-budgets-actions'

/**
 * SC Budgets — the top-management report.
 *
 * Three freedoms Aksha asked for, kept genuinely separate:
 *   1. which ROWS    — any mix of projects, categories and sub-categories
 *   2. which AMOUNT  — the measure in each column, and the unit (₹ / L / Cr)
 *   3. which COLUMNS go into the PDF, which need not be all of them
 *
 * Print → PDF via the browser, the same way every other Budget vs Actual report
 * page does it (`no-print` + window.print() + an @media print block), so it
 * comes out looking like the reports the HOD already receives.
 */
export function ScBudgetsClient({ lines, projectName, projectId, openOn, allProjects, saved }: {
  lines: SourceLine[]
  projectName: string
  projectId: string
  /** This project, plus its children when it is a group. */
  openOn: string[]
  allProjects: Array<{ id: string; name: string }>
  /** The layout saved for this project, already validated server-side. */
  saved: Selection
}) {
  // Opens on THIS project — you arrived from inside it — but every other
  // project can be added, because the report is a portfolio hand-out.
  const [s, setS] = useState<Selection>(() => ({ ...saved, projectIds: openOn }))
  const [open, setOpen] = useState<'projects' | 'clubs' | 'cats' | 'cols' | null>(null)
  const [note, setNote] = useState<{ ok: boolean; message: string } | null>(null)
  const [saving, startSave] = useTransition()

  const set = (patch: Partial<Selection>) => { setS(prev => ({ ...prev, ...patch })); setNote(null) }
  const toggle = <T,>(list: T[], v: T): T[] =>
    list.includes(v) ? list.filter(x => x !== v) : [...list, v]
  const setBucket = (i: number, patch: Partial<Bucket>) =>
    set({ buckets: s.buckets.map((b, j) => (j === i ? { ...b, ...patch } : b)) })

  const usable = useMemo(() => usableBuckets(s.buckets), [s.buckets])

  const projectNames = useMemo(
    () => new Map(allProjects.map(p => [p.id, p.name])), [allProjects])

  // Categories and sub-categories available from the chosen projects only, so
  // the picker never offers something that would produce an empty report.
  const inScope = useMemo(
    () => lines.filter(l => s.projectIds.length === 0 || s.projectIds.includes(l.projectId)),
    [lines, s.projectIds])

  const cats = useMemo(() => {
    const m = new Map<string, string>()
    for (const l of inScope) m.set(l.disciplineCode, `${l.disciplineCode} ${l.disciplineName}`)
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
  }, [inScope])

  const subs = useMemo(() => {
    const m = new Map<string, string>()
    for (const l of inScope) {
      if (!l.subCode) continue
      if (s.disciplineCodes.length > 0 && !s.disciplineCodes.includes(l.disciplineCode)) continue
      m.set(l.subCode, `${l.subCode} ${l.subName ?? ''}`.trim())
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
  }, [inScope, s.disciplineCodes])

  const filtered = useMemo(() => filterLines(lines, s), [lines, s])
  const rows = useMemo(() => buildRows(filtered, s), [filtered, s])
  const total = useMemo(() => totalRow(rows, filtered), [rows, filtered])
  const printCols = pdfColumnsOf(s)

  const Panel = ({ id, label, count, children }: {
    id: 'projects' | 'clubs' | 'cats' | 'cols'; label: string; count: string; children: React.ReactNode
  }) => (
    <div className="relative">
      <button
        onClick={() => setOpen(open === id ? null : id)}
        aria-expanded={open === id}
        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 text-xs font-semibold text-gray-700 min-h-[44px] hover:bg-gray-50"
      >
        {label} <span className="font-normal text-gray-400">{count}</span>
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open === id ? 'rotate-180' : ''}`} />
      </button>
      {open === id && (
        <div className="absolute z-20 mt-1 w-[min(92vw,26rem)] max-h-[60vh] overflow-auto rounded-lg border border-gray-200 bg-white p-2 shadow-lg">
          {children}
        </div>
      )}
    </div>
  )

  const Pick = ({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) => (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs min-h-[40px] ${
        on ? 'bg-indigo-50 text-indigo-900 font-semibold' : 'text-gray-700 hover:bg-gray-50'
      }`}
    >
      <span className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border ${
        on ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-gray-300'
      }`}>
        {on && <Check className="h-3 w-3" />}
      </span>
      <span className="min-w-0 truncate">{children}</span>
    </button>
  )

  return (
    <div className="space-y-3">
      {/* ── Controls — never printed ── */}
      <div className="no-print space-y-2">
        <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 px-3 py-2">
          <p className="text-xs text-indigo-900">
            <b>Top management only.</b> Atm Heads and admin. Not engineers, not back-office,
            not the coordinator.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* No "All projects" — Aksha, 2026-09-03: "dont want all projects
              option in respective project". You are standing in a project, so
              the report is about it; a group opens covering its children, and
              a sibling can still be added deliberately. */}
          <Panel id="projects" label="Projects" count={String(s.projectIds.length)}>
            <p className="px-2 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
              This project{openOn.length > 1 ? ' and its sub-projects' : ''}
            </p>
            {allProjects.filter(p => openOn.includes(p.id)).map(p => (
              <Pick key={p.id} on={s.projectIds.includes(p.id)}
                onClick={() => set({ projectIds: toggle(s.projectIds, p.id), subCodes: [] })}>
                {p.name}
              </Pick>
            ))}
            {allProjects.some(p => !openOn.includes(p.id)) && (
              <>
                <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                  Add another project
                </p>
                {allProjects.filter(p => !openOn.includes(p.id)).map(p => (
                  <Pick key={p.id} on={s.projectIds.includes(p.id)}
                    onClick={() => set({ projectIds: toggle(s.projectIds, p.id), subCodes: [] })}>
                    {p.name}
                  </Pick>
                ))}
              </>
            )}
          </Panel>

          {/* Clubbing — the thing Aksha actually meant by "mix". */}
          <Panel id="clubs" label="Club lines" count={usable.length ? String(usable.length) : 'none'}>
            <p className="px-2 pb-1.5 pt-0.5 text-[11px] text-gray-500">
              Put two or more categories or sub-categories together under one name.
              Anything not clubbed stays as it is.
            </p>
            {s.buckets.map((b, i) => (
              <div key={b.id} className="rounded-lg border border-gray-200 p-2 mb-2">
                <div className="flex gap-1.5">
                  <input
                    value={b.name}
                    onChange={e => setBucket(i, { name: e.target.value })}
                    placeholder="Name this line, e.g. Finishes"
                    className="flex-1 rounded border border-gray-300 px-2 py-1.5 text-xs min-h-[40px]"
                  />
                  <button
                    onClick={() => set({ buckets: s.buckets.filter(x => x.id !== b.id) })}
                    aria-label={`Remove ${b.name || 'club'}`}
                    className="rounded border border-gray-300 px-2 text-gray-500 hover:bg-gray-50 min-h-[40px]"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <p className="px-0.5 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Categories</p>
                {cats.map(([code, label]) => (
                  <Pick key={code} on={b.disciplineCodes.includes(code)}
                    onClick={() => setBucket(i, { disciplineCodes: toggle(b.disciplineCodes, code) })}>
                    {label}
                  </Pick>
                ))}
                {subs.length > 0 && (
                  <>
                    <p className="px-0.5 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Sub-categories</p>
                    {subs.map(([code, label]) => (
                      <Pick key={code} on={b.subCodes.includes(code)}
                        onClick={() => setBucket(i, { subCodes: toggle(b.subCodes, code) })}>
                        {label}
                      </Pick>
                    ))}
                  </>
                )}
              </div>
            ))}
            <button
              onClick={() => set({ buckets: [...s.buckets, { id: `club-${Date.now()}`, name: '', disciplineCodes: [], subCodes: [] }] })}
              className="w-full rounded-lg border border-dashed border-gray-300 px-2 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50 min-h-[44px]"
            >
              + Club some lines together
            </button>
          </Panel>

          <Panel id="cats" label="Categories"
            count={`${s.disciplineCodes.length || cats.length}${s.subCodes.length ? ` · ${s.subCodes.length} sub` : ''}`}>
            <p className="px-2 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Categories</p>
            <Pick on={s.disciplineCodes.length === 0} onClick={() => set({ disciplineCodes: [], subCodes: [] })}>
              All categories
            </Pick>
            {cats.map(([code, label]) => (
              <Pick key={code} on={s.disciplineCodes.includes(code)}
                onClick={() => set({ disciplineCodes: toggle(s.disciplineCodes, code), subCodes: [] })}>
                {label}
              </Pick>
            ))}
            {subs.length > 0 && (
              <>
                <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                  Sub-categories — mix freely with the above
                </p>
                <Pick on={s.subCodes.length === 0} onClick={() => set({ subCodes: [] })}>All sub-categories</Pick>
                {subs.map(([code, label]) => (
                  <Pick key={code} on={s.subCodes.includes(code)} onClick={() => set({ subCodes: toggle(s.subCodes, code) })}>
                    {label}
                  </Pick>
                ))}
              </>
            )}
          </Panel>

          <Panel id="cols" label="Columns" count={`${s.columns.length}${s.pdfColumns.length ? ` · ${printCols.length} in PDF` : ''}`}>
            <p className="px-2 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Show these amounts</p>
            {MEASURES.map(m => (
              <Pick key={m.id} on={s.columns.includes(m.id)}
                onClick={() => set({ columns: MEASURES.filter(x => toggle(s.columns, m.id).includes(x.id)).map(x => x.id) })}>
                {m.label}
                {m.confidential && <span className="ml-1 text-[9px] font-bold text-rose-600">CONF</span>}
                <span className="block text-[10px] font-normal text-gray-400">{m.hint}</span>
              </Pick>
            ))}
            <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
              Attach to the PDF — leave empty for all
            </p>
            {s.columns.map(id => (
              <Pick key={id} on={s.pdfColumns.includes(id)} onClick={() => set({ pdfColumns: toggle(s.pdfColumns, id) })}>
                {measure(id).label}
              </Pick>
            ))}
          </Panel>

          {/* Grouping — Aksha's "mix category and sub-category". */}
          <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden">
            {(['category', 'subcategory', 'project'] as Grouping[]).map(g => (
              <button key={g} onClick={() => set({ grouping: g })}
                aria-pressed={s.grouping === g}
                className={`px-3 text-xs font-semibold min-h-[44px] ${
                  s.grouping === g ? 'bg-indigo-700 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}>
                {g === 'subcategory' ? 'Sub-cat' : g === 'category' ? 'Category' : 'Project'}
              </button>
            ))}
          </div>

          {/* The unit — a portfolio report in plain rupees is unreadable. */}
          <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden">
            {UNITS.map(u => (
              <button key={u.id} onClick={() => set({ unit: u.id as Unit })}
                aria-pressed={s.unit === u.id}
                className={`px-3 text-xs font-semibold min-h-[44px] ${
                  s.unit === u.id ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}>
                {u.label}
              </button>
            ))}
          </div>

          <button
            onClick={() => startSave(async () => setNote(await saveScLayout(projectId, toSaved(s))))}
            disabled={saving}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 text-xs font-semibold text-gray-700 min-h-[44px] hover:bg-gray-50 disabled:opacity-40"
          >
            <Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save for this project'}
          </button>

          <button
            onClick={() => window.print()}
            disabled={rows.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-700 px-3.5 text-xs font-semibold text-white min-h-[44px] hover:bg-indigo-800 disabled:opacity-40"
          >
            <Printer className="h-4 w-4" /> Print / Save as PDF
          </button>
        </div>

        {note && (
          <p role="status" className={`text-[11px] flex items-center gap-1 ${note.ok ? 'text-emerald-700' : 'text-rose-700'}`}>
            {note.ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}{note.message}
          </p>
        )}
      </div>

      {/* ── The report itself — this is what prints ── */}
      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden print:border-0 print:rounded-none">
        <header className="px-4 py-3 border-b border-gray-100">
          <h2 className="text-sm font-bold text-gray-900">SC Budgets — {projectName}</h2>
          <p className="text-[11px] text-gray-500 mt-0.5">{describeSelection(s, projectNames)}</p>
        </header>

        {rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-gray-500">
            Nothing matches these picks. Widen the projects or categories above.
          </p>
        ) : (
          <>
            {/* Desktop / print */}
            <div className="overflow-auto max-h-[70vh] hidden md:block print:block print:max-h-none print:overflow-visible">
              <table className="w-full text-[13px]">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 text-left font-semibold text-gray-600 min-w-[240px]">
                      {s.grouping === 'project' ? 'Project' : s.grouping === 'category' ? 'Category' : 'Sub-category'}
                    </th>
                    {printCols.map(id => (
                      <th key={id} className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 text-right font-semibold text-gray-600 w-32">
                        {measure(id).label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.key} className="border-t border-gray-100">
                      <td className="px-3 py-2 text-gray-800">
                        {r.label}
                        <span className="block text-[10px] text-gray-400">{r.sub}</span>
                      </td>
                      {printCols.map(id => (
                        <td key={id} className="px-3 py-2 text-right tabular-nums text-gray-900">
                          {formatCell(r.values[id], id, s.unit)}
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
                    <td className="px-3 py-2 text-gray-900">
                      {total.label}
                      <span className="block text-[10px] font-normal text-gray-500">{total.sub}</span>
                    </td>
                    {printCols.map(id => (
                      <td key={id} className="px-3 py-2 text-right tabular-nums text-gray-900">
                        {formatCell(total.values[id], id, s.unit)}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Phone — the same figures as cards */}
            <div className="md:hidden print:hidden divide-y divide-gray-100 overflow-auto max-h-[70vh]">
              {[...rows, total].map(r => (
                <div key={r.key} className={`px-4 py-3 ${r.key === '__total' ? 'bg-gray-50' : ''}`}>
                  <p className="text-sm font-semibold text-gray-900">{r.label}</p>
                  <p className="text-[10px] text-gray-400">{r.sub}</p>
                  <dl className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1">
                    {printCols.map(id => (
                      <div key={id}>
                        <dt className="text-[10px] text-gray-400">{measure(id).label}</dt>
                        <dd className="text-xs font-semibold tabular-nums text-gray-900">
                          {formatCell(r.values[id], id, s.unit)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Same print rules as the other Budget vs Actual report pages. */}
      <style>{`
        @media print {
          body { background: #fff }
          .no-print { display: none !important }
          tr { page-break-inside: avoid }
          table { -webkit-print-color-adjust: exact; print-color-adjust: exact }
        }
      `}</style>
    </div>
  )
}
