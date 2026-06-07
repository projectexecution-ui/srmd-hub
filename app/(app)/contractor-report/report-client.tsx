'use client'
// Contractor Report — persisted like Budget vs Actual. The team's data lives
// server-side (contractor_report_state); this page loads it on open, lets you
// update by uploading a fresh generated report (replaces that project), shows
// it on screen with the working columns (Deductions / Retention / Balance)
// hidden by default, and exports the exact 9-column format.

import { useCallback, useEffect, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { QueryError } from '@/components/ui/query-error'
import {
  FileSpreadsheet, UploadCloud, Download, Loader2, Eye, EyeOff, X, Clock,
  CheckCircle2, AlertTriangle, ChevronRight, ChevronDown, ChevronsDownUp, ChevronsUpDown, Layers,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatNumber, cn } from '@/lib/utils'
import { confirm } from '@/components/ui/confirm-dialog'
import {
  parseSourceReport, reconcile, deriveContractor, categorySubtotal, subprojectTotal,
  reportGrandTotal, combineSubprojects, displayCategory, costOf, COST_BASE_OPTIONS,
  type ReportDoc, type RawCategory, type SubprojectGroup, type Totals,
  type CostBase, type ContractorReportSettings,
} from '@/lib/contractor-report'

// Backward-compat: older saved reports stored a flat `categories` array
// (before sub-project grouping). Wrap those into a single section so they
// still render until the user re-uploads.
function normalizeDoc(d: ReportDoc & { categories?: RawCategory[] }): ReportDoc {
  if (d.subprojects && d.subprojects.length) return d
  const cats = d.categories ?? []
  return { ...d, subprojects: cats.length ? [{ name: 'All sub-projects', categories: cats }] : [] }
}

const STATE_URL = '/api/contractor-report/state'

async function parseFile(file: File): Promise<ReportDoc> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(new Uint8Array(buf), { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws) throw new Error('Workbook has no sheets')
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true }) as (string | number | null)[][]
  const parsed = parseSourceReport(rows)
  if (parsed.subprojects.length === 0) {
    throw new Error('No contractor rows found — is this the IN4 “All Types Certificates Details” export (.xlsx)?')
  }
  return {
    id: crypto.randomUUID(),
    projectName: parsed.projectName,
    title: parsed.title,
    subtitle: parsed.subtitle,
    sourceFilename: file.name,
    uploadedAt: new Date().toISOString(),
    subprojects: parsed.subprojects,
    computed: parsed.computed,
    source: parsed.source,
  }
}

type FullState = { reports: ReportDoc[]; settings: ContractorReportSettings }

export default function ContractorReportClient() {
  const [reports, setReports] = useState<ReportDoc[]>([])
  const [costBase, setCostBase] = useState<CostBase>('bill')
  const [showMetrics, setShowMetrics] = useState(true)
  const [budgetAreas, setBudgetAreas] = useState<Record<string, number>>({})
  const [updatedInfo, setUpdatedInfo] = useState<{ at: string | null; by: string | null }>({ at: null, by: null })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showWorking, setShowWorking] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // Drag counter — keeps the overlay stable as the cursor crosses child
  // boundaries (HTML drag events fire enter/leave for every nested element).
  const dragCounter = useRef(0)

  // ── Load saved state + Budget-vs-Actual areas on open ───────────────────
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [stateRes, areasRes] = await Promise.all([fetch(STATE_URL), fetch('/api/contractor-report/areas')])
        const j = await stateRes.json()
        const a = await areasRes.json().catch(() => ({ areas: {} }))
        if (cancelled) return
        if (!stateRes.ok) { setLoadError(j.error || 'Failed to load saved reports'); setLoading(false); return }
        setReports((j.state?.reports ?? []).map(normalizeDoc))
        setCostBase(j.state?.settings?.costBase ?? 'bill')
        setShowMetrics(j.state?.settings?.showMetrics ?? true)
        setBudgetAreas(a.areas ?? {})
        setUpdatedInfo({ at: j.updated_at ?? null, by: j.updated_by_name ?? null })
        setSelectedId(prev => prev ?? (j.state?.reports ?? [])[0]?.id ?? null)
        setLoading(false)
      } catch (e) {
        if (!cancelled) { setLoadError(e instanceof Error ? e.message : String(e)); setLoading(false) }
      }
    })()
    return () => { cancelled = true }
  }, [])

  // ── Persist the WHOLE state (reports + settings), preserving both ────────
  const persistState = useCallback(async (mutate: (s: FullState) => FullState) => {
    setBusy(true)
    try {
      const cur = await (await fetch(STATE_URL)).json()
      const curState: FullState = { reports: cur.state?.reports ?? [], settings: cur.state?.settings ?? {} }
      const next = mutate(curState)
      const put = await fetch(STATE_URL, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ state: next, baseVersion: cur.version, force: true }),
      })
      const j = await put.json()
      if (!put.ok) throw new Error(j.error || 'Save failed')
      setReports(next.reports.map(normalizeDoc))
      setCostBase(next.settings.costBase ?? 'bill')
      setShowMetrics(next.settings.showMetrics ?? true)
      setUpdatedInfo({ at: new Date().toISOString(), by: 'you' })
      return next
    } finally {
      setBusy(false)
    }
  }, [])

  const persistReports = useCallback(async (fn: (r: ReportDoc[]) => ReportDoc[]) => {
    const next = await persistState(s => ({ ...s, reports: fn(s.reports) }))
    return next.reports
  }, [persistState])

  async function changeCostBase(base: CostBase) {
    setCostBase(base) // optimistic
    try { await persistState(s => ({ ...s, settings: { ...s.settings, costBase: base } })) }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save setting') }
  }

  async function changeShowMetrics(next: boolean) {
    setShowMetrics(next) // optimistic
    try { await persistState(s => ({ ...s, settings: { ...s.settings, showMetrics: next } })) }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save setting') }
  }

  async function setSubArea(reportId: string, subName: string, sqft: number | null) {
    try {
      await persistReports(reports => reports.map(r => {
        if (r.id !== reportId) return r
        const areaBySub = { ...(r.areaBySub ?? {}) }
        if (sqft == null || sqft <= 0) delete areaBySub[subName]
        else areaBySub[subName] = sqft
        return { ...r, areaBySub }
      }))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save area')
    }
  }

  const handleFiles = useCallback(async (list: FileList | null) => {
    if (!list) return
    const files = Array.from(list).filter(f => /\.xlsx?$/i.test(f.name))
    if (files.length === 0) { toast.error('Please choose a generated Contractor Report .xlsx'); return }
    try {
      const docs: ReportDoc[] = []
      for (const f of files) docs.push(await parseFile(f))
      const next = await persistReports(reports => {
        let out = reports
        for (const doc of docs) {
          const i = out.findIndex(r => r.projectName === doc.projectName)
          out = i >= 0 ? out.map((r, j) => (j === i ? { ...doc, areaBySub: out[i].areaBySub } : r)) : [...out, doc]
        }
        return out
      })
      const justAdded = docs[docs.length - 1]
      setSelectedId(next.find(r => r.projectName === justAdded.projectName)?.id ?? next[0]?.id ?? null)
      toast.success(`Saved ${docs.length} report${docs.length === 1 ? '' : 's'} for the whole team`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not process the file')
    }
  }, [persistReports])

  async function removeReport(doc: ReportDoc) {
    if (!(await confirm({ title: 'Remove report', message: `Remove the saved report for “${doc.projectName}”? This affects everyone.`, confirmLabel: 'Remove' }))) return
    try {
      const next = await persistReports(reports => reports.filter(r => r.id !== doc.id))
      setSelectedId(next[0]?.id ?? null)
      toast.success('Report removed')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not remove')
    }
  }

  // Page-wide drag handlers. Overlay only shows while the user is actively
  // dragging a *file* (we filter on dataTransfer.types).
  function isFileDrag(e: React.DragEvent): boolean {
    const types = e.dataTransfer?.types
    if (!types) return false
    for (let i = 0; i < types.length; i++) if (types[i] === 'Files') return true
    return false
  }
  const onPageDragEnter = (e: React.DragEvent) => {
    if (!isFileDrag(e)) return
    e.preventDefault()
    dragCounter.current += 1
    setDragOver(true)
  }
  const onPageDragOver = (e: React.DragEvent) => {
    if (!isFileDrag(e)) return
    e.preventDefault()
  }
  const onPageDragLeave = (e: React.DragEvent) => {
    if (!isFileDrag(e)) return
    e.preventDefault()
    dragCounter.current = Math.max(0, dragCounter.current - 1)
    if (dragCounter.current === 0) setDragOver(false)
  }
  const onPageDrop = (e: React.DragEvent) => {
    e.preventDefault()
    dragCounter.current = 0
    setDragOver(false)
    handleFiles(e.dataTransfer.files)
  }

  const selected = reports.find(r => r.id === selectedId) ?? null

  return (
    <div
      className="p-4 md:p-6 max-w-6xl mx-auto space-y-5 relative"
      onDragEnter={onPageDragEnter}
      onDragOver={onPageDragOver}
      onDragLeave={onPageDragLeave}
      onDrop={onPageDrop}
    >
      {/* Page-wide drop overlay — only visible while the user is actively
          dragging a file. Pointer-events disabled so React still receives the
          drop event on the wrapper underneath. */}
      {dragOver && (
        <div className="fixed inset-0 z-50 bg-[#1F4E78]/15 backdrop-blur-[2px] flex items-center justify-center pointer-events-none">
          <div className="bg-white rounded-2xl px-8 py-7 shadow-2xl border-2 border-dashed border-[#1F4E78] text-center">
            <UploadCloud className="h-10 w-10 text-[#1F4E78] mx-auto mb-2" />
            <p className="text-base font-semibold text-gray-900">Drop the IN4 .xlsx anywhere</p>
            <p className="text-xs text-gray-500 mt-1">“All Types Certificates Details” export</p>
          </div>
        </div>
      )}

      <PageHeader
        title="Contractor Report"
        subtitle="Category × Contractor summary, saved for the whole team. Re-upload the latest IN4 export to update."
      >
        <label className="inline-flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
          <input type="checkbox" checked={showWorking} onChange={e => setShowWorking(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-[#1F4E78] focus:ring-[#1F4E78]" />
          {showWorking ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          Show working columns
        </label>
        <label className="inline-flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer" title="Show % of Cost and Rs/Sft columns (saved for the whole team)">
          <input type="checkbox" checked={showMetrics} onChange={e => changeShowMetrics(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-[#1F4E78] focus:ring-[#1F4E78]" />
          {showMetrics ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          Show % / Rs·Sft
        </label>
        {/* Compact upload affordance — replaces the old main-entrance card.
            Click → file picker. Drop anywhere on the page → the overlay
            above catches it. */}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          title='Upload IN4 "All Types Certificates Details" (.xlsx) — or drop the file anywhere on this page'
          className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-gray-300 bg-white text-xs font-medium text-gray-700 hover:border-[#1F4E78] hover:text-[#1F4E78] hover:bg-blue-50/40 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
          <span className="hidden sm:inline">{busy ? 'Uploading…' : 'Upload'}</span>
        </button>
        <input ref={inputRef} type="file" accept=".xlsx,.xls" multiple className="hidden"
          onChange={e => { handleFiles(e.target.files); e.target.value = '' }} />
      </PageHeader>

      {loadError && <QueryError what="saved reports" message={loadError} />}

      {loading ? (
        <Card className="p-8 text-center text-sm text-gray-400"><Loader2 className="h-4 w-4 animate-spin inline mr-2" />Loading saved reports…</Card>
      ) : reports.length === 0 ? (
        <Card className="p-10 text-center">
          <div className="h-12 w-12 rounded-2xl bg-[#1F4E78]/10 text-[#1F4E78] inline-flex items-center justify-center mb-3">
            <UploadCloud className="h-6 w-6" />
          </div>
          <p className="text-sm text-gray-700 font-medium">No reports saved yet.</p>
          <p className="text-xs text-gray-500 mt-1">
            Upload the IN4 <b>“All Types Certificates Details”</b> export, or drop it anywhere on this page — it&apos;ll be saved for the whole team.
          </p>
          <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={busy} className="mt-4">
            <FileSpreadsheet className="h-4 w-4" /> Choose file
          </Button>
        </Card>
      ) : (
        <>
          {/* Project selector chips */}
          <div className="flex flex-wrap items-center gap-2">
            {reports.map(r => (
              <span key={r.id}
                className={`inline-flex items-center gap-1.5 rounded-full border pl-3 pr-1.5 py-1 text-xs cursor-pointer ${
                  r.id === selectedId ? 'bg-[#1F4E78] text-white border-[#1F4E78]' : 'bg-white border-gray-200 text-gray-700 hover:border-gray-300'}`}
                onClick={() => setSelectedId(r.id)}>
                <FileSpreadsheet className="h-3 w-3" />
                <span className="max-w-[16rem] truncate">{r.projectName}</span>
                <button onClick={e => { e.stopPropagation(); removeReport(r) }}
                  className={`${r.id === selectedId ? 'text-white/80 hover:text-white' : 'text-gray-400 hover:text-rose-600'}`} title="Remove">
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
          </div>

          {updatedInfo.at && (
            <p className="text-[11px] text-gray-400 inline-flex items-center gap-1">
              <Clock className="h-3 w-3" /> Last updated {new Date(updatedInfo.at).toLocaleString()}{updatedInfo.by ? ` by ${updatedInfo.by}` : ''}
            </p>
          )}

          {selected && (
            <ReportView
              key={selected.id}
              doc={selected}
              showWorking={showWorking}
              showMetrics={showMetrics}
              costBase={costBase}
              onCostBase={changeCostBase}
              areaFor={(subName: string) => selected.areaBySub?.[subName] ?? budgetAreas[subName] ?? 0}
              isAreaAuto={(subName: string) => selected.areaBySub?.[subName] == null && (budgetAreas[subName] ?? 0) > 0}
              onSetArea={(subName: string, sqft: number | null) => setSubArea(selected.id, subName, sqft)}
            />
          )}
        </>
      )}
    </div>
  )
}

// ── Excel export (exact 9-column format, F/G/H hidden) ─────────────────────
function safeSheetName(name: string): string {
  return (name.replace(/[:\\/?*[\]]/g, '-').slice(0, 31)) || 'Sheet'
}
const XL_HEADERS_BASE = ['Category', 'Contractor Name', 'WO Value', 'Total Bill Value', 'Total Paid Value', 'Deductions', 'Retention Held', 'Balance Value', 'Total Owed']
const XL_METRIC_HEADERS = ['% of Cost', 'Rs/Sft']

function categoriesToSheet(title: string, subtitle: string, categories: RawCategory[], grand: Totals, costBase: CostBase, area: number, grandCost: number, showMetrics: boolean) {
  const headers = showMetrics ? [...XL_HEADERS_BASE, ...XL_METRIC_HEADERS] : XL_HEADERS_BASE
  const lastCol = headers.length - 1
  // Row builder: optionally appends the two metric cells.
  const withMetrics = (row: (string | number | null)[], t: Totals): (string | number | null)[] => {
    if (!showMetrics) return row
    const pct = grandCost > 0 ? Number(((costOf(t, costBase) / grandCost) * 100).toFixed(1)) : null
    const rs  = area > 0      ? Math.round(costOf(t, costBase) / area)                       : null
    return [...row, pct, rs]
  }
  const fillerLen = headers.length

  const aoa: (string | number | null)[][] = [[title], [subtitle], [], headers]
  for (const cat of categories) {
    aoa.push([cat.category, ...Array(fillerLen - 1).fill(null)])
    for (const raw of cat.contractors) {
      const c = deriveContractor(raw)
      aoa.push(withMetrics([null, c.contractor, c.woValue, c.billValue, c.paidValue, c.deductions, c.retentionHeld, c.balanceValue, c.totalOwed], c))
    }
    const s = categorySubtotal(cat)
    aoa.push(withMetrics([`${displayCategory(cat.category)} — Subtotal`, null, s.woValue, s.billValue, s.paidValue, s.deductions, s.retentionHeld, s.balanceValue, s.totalOwed], s))
    aoa.push([])
  }
  aoa.push(withMetrics(['GRAND TOTAL', null, grand.woValue, grand.billValue, grand.paidValue, grand.deductions, grand.retentionHeld, grand.balanceValue, grand.totalOwed], grand))
  aoa.push([])
  aoa.push(['Notes:'])
  if (showMetrics) {
    aoa.push([`• % of Cost and Rs/Sft are based on ${COST_BASE_OPTIONS.find(o => o.value === costBase)?.label ?? 'Total Bill Value'}${area > 0 ? `; built-up area = ${area.toLocaleString('en-IN')} sq ft` : ' (no built-up area set — Rs/Sft blank)'}.`])
  }
  aoa.push(['• Total Owed (I) = Balance Value (H) + Retention Held (G) — the full amount still due to the contractor.'])
  aoa.push(['• Balance Value (H) = Total Bill Value (D) − Total Paid Value (E) − Deductions (F) − Retention Held (G).'])
  aoa.push(['• Columns F, G and H are hidden for a cleaner view; unhide to see the full working.'])

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const baseWidths = [34, 42, 16, 18, 18, 14, 14, 18, 18]
  const metricWidths = [10, 12]
  const widths = showMetrics ? [...baseWidths, ...metricWidths] : baseWidths
  ws['!cols'] = widths.map((wch, i) => ({ wch, hidden: i === 5 || i === 6 || i === 7 }))
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: lastCol } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: lastCol } },
  ]
  const range = XLSX.utils.decode_range(ws['!ref'] as string)
  for (let R = 3; R <= range.e.r; R++) {
    for (let Col = 2; Col <= 8; Col++) {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: Col })]
      if (cell && typeof cell.v === 'number') cell.z = '#,##0;(#,##0);-'
    }
    if (showMetrics) {
      const pctCell = ws[XLSX.utils.encode_cell({ r: R, c: 9 })]
      if (pctCell && typeof pctCell.v === 'number') pctCell.z = '0.0"%"'
      const rsCell = ws[XLSX.utils.encode_cell({ r: R, c: 10 })]
      if (rsCell && typeof rsCell.v === 'number') rsCell.z = '#,##0'
    }
  }
  return ws
}

// In sub-project mode: one sheet per sub-project (its own area). In combined
// mode: a single "— All" sheet using the total area across sub-projects.
function exportReport(doc: ReportDoc, groupBySub: boolean, costBase: CostBase, areaFor: (subName: string) => number, showMetrics: boolean) {
  const wb = XLSX.utils.book_new()
  const grandCost = costOf(reportGrandTotal(doc.subprojects), costBase)
  if (groupBySub) {
    for (const sp of doc.subprojects) {
      const ws = categoriesToSheet(`${doc.projectName} — ${sp.name}`, `${sp.name} — Category-wise & Contractor-wise Summary (INR)`, sp.categories, subprojectTotal(sp), costBase, areaFor(sp.name), grandCost, showMetrics)
      XLSX.utils.book_append_sheet(wb, ws, safeSheetName(sp.name))
    }
  } else {
    const totalArea = doc.subprojects.reduce((s, sp) => s + areaFor(sp.name), 0)
    const ws = categoriesToSheet(doc.title, 'Category-wise & Contractor-wise Summary (All Sub-projects, INR)', combineSubprojects(doc.subprojects), reportGrandTotal(doc.subprojects), costBase, totalArea, grandCost, showMetrics)
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName(`${doc.projectName} — All`))
  }
  XLSX.writeFile(wb, `${doc.projectName.replace(/[^\w-]+/g, '_')}_ContractorReport.xlsx`)
}

// Proof the figures tie back to IN4's own "Project Total" row — so the user
// can trust the numbers. Shows each raw column: computed vs IN4, with the delta.
function ReconciliationPanel({ doc }: { doc: ReportDoc }) {
  const rec = reconcile(doc.computed, doc.source)
  if (!rec.available) {
    return (
      <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 text-[11px] text-gray-500">
        No “Project Total” row found in the source — totals shown are computed from the contractor rows.
      </div>
    )
  }
  return (
    <div className={`px-4 py-2 border-b text-[11px] ${rec.allOk ? 'bg-emerald-50 border-emerald-100' : 'bg-amber-50 border-amber-100'}`}>
      <div className="flex items-center gap-1.5 font-semibold mb-1">
        {rec.allOk
          ? <span className="text-emerald-800 inline-flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> Reconciles with IN4 Project Total</span>
          : <span className="text-amber-800 inline-flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" /> Some totals differ from IN4 — review below</span>}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-0.5">
        {rec.lines.map(l => (
          <span key={l.label} className={l.ok ? 'text-gray-600' : 'text-amber-800 font-medium'}>
            {l.label}: <span className="tabular-nums">{formatNumber(l.computed, 0)}</span>
            {!l.ok && <span className="tabular-nums"> vs IN4 {formatNumber(l.source, 0)} (Δ{formatNumber(l.delta, 0)})</span>}
            {l.ok && ' ✓'}
          </span>
        ))}
      </div>
    </div>
  )
}

// The two analysis cells (% of project cost, Rs/Sft) appended to every row.
function MetricCells({ amount, area, grandCost, tone = 'text-gray-700', py = 'py-1.5' }: {
  amount: number; area: number; grandCost: number; tone?: string; py?: string
}) {
  const pct = grandCost > 0 ? (amount / grandCost) * 100 : null
  const rs = area > 0 ? amount / area : null
  return (
    <>
      <td className={`px-3 ${py} text-right tabular-nums ${tone}`}>{pct == null ? '—' : pct.toFixed(1) + '%'}</td>
      <td className={`px-3 ${py} text-right tabular-nums ${tone}`}>{rs == null ? '—' : formatNumber(rs, 0)}</td>
    </>
  )
}

function ReportView({ doc, showWorking, showMetrics, costBase, onCostBase, areaFor, isAreaAuto, onSetArea }: {
  doc: ReportDoc
  showWorking: boolean
  showMetrics: boolean
  costBase: CostBase
  onCostBase: (b: CostBase) => void
  areaFor: (subName: string) => number
  isAreaAuto: (subName: string) => boolean
  onSetArea: (subName: string, sqft: number | null) => void
}) {
  const gt = reportGrandTotal(doc.subprojects)
  const grandCost = costOf(gt, costBase)
  const totalArea = doc.subprojects.reduce((s, sp) => s + areaFor(sp.name), 0)
  const baseCols = showWorking
    ? ['WO Value', 'Total Bill', 'Total Paid', 'Deductions', 'Retention', 'Balance', 'Total Owed']
    : ['WO Value', 'Total Bill', 'Total Paid', 'Total Owed']
  const cols = showMetrics ? [...baseCols, '% Cost', 'Rs/Sft'] : baseCols

  // By sub-project (default) vs Combined (sub-projects merged into one list).
  const [groupBySub, setGroupBySub] = useState(true)
  const sections: SubprojectGroup[] = groupBySub
    ? doc.subprojects
    : [{ name: 'All sub-projects (combined)', categories: combineSubprojects(doc.subprojects) }]

  const noSubprojectBreakdown = doc.subprojects.length <= 1 &&
    (doc.subprojects[0]?.name === 'All sub-projects' || doc.subprojects[0]?.name === '(Unknown Sub-project)')

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const toggle = (k: string) => setCollapsed(s => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })
  const allKeys = sections.flatMap((sp, si) => sp.categories.map((_, ci) => `${si}:${ci}`))
  const allCollapsed = allKeys.length > 0 && allKeys.every(k => collapsed.has(k))
  const expandAll = () => setCollapsed(new Set())
  const collapseAll = () => setCollapsed(new Set(allKeys))

  return (
    <Card className="overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">{doc.title}</p>
          <p className="text-[11px] text-gray-500 truncate">{doc.subtitle} · from {doc.sourceFilename}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Cost basis for % and Rs/Sft — only relevant when the metrics are shown */}
          {showMetrics && (
            <label className="inline-flex items-center gap-1 text-[11px] text-gray-500">
              % / Rs·Sft on
              <select value={costBase} onChange={e => onCostBase(e.target.value as CostBase)}
                className="h-8 rounded-lg border border-gray-300 bg-white px-1.5 text-xs font-medium text-gray-700">
                {COST_BASE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          )}
          <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden text-xs">
            <button onClick={() => setGroupBySub(true)} className={cn('px-2.5 py-1.5 font-medium', groupBySub ? 'bg-[#1F4E78] text-white' : 'bg-white text-gray-600 hover:bg-gray-50')}>By sub-project</button>
            <button onClick={() => setGroupBySub(false)} className={cn('px-2.5 py-1.5 font-medium', !groupBySub ? 'bg-[#1F4E78] text-white' : 'bg-white text-gray-600 hover:bg-gray-50')}>Combined</button>
          </div>
          <Button size="sm" variant="outline" onClick={() => { if (allCollapsed) expandAll(); else collapseAll() }} title="Expand or collapse all categories">
            {allCollapsed ? <ChevronsUpDown className="h-4 w-4" /> : <ChevronsDownUp className="h-4 w-4" />}
            {allCollapsed ? 'Expand all' : 'Collapse all'}
          </Button>
          <Button size="sm" onClick={() => exportReport(doc, groupBySub, costBase, areaFor, showMetrics)} className="bg-[#1F4E78] hover:bg-[#163a5c]">
            <Download className="h-4 w-4" /> Export Excel
          </Button>
        </div>
      </div>

      <ReconciliationPanel doc={doc} />

      <div className="p-4 space-y-5">
        {noSubprojectBreakdown && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span>
              This report has <b>no sub-project breakdown</b> — it was saved before sub-project grouping, or from an
              already-combined file. To split it into sub-projects, <b>re-upload the raw IN4 “All Types Certificates
              Details” export</b> (the file <i>without</i> “_ContractorReport” in its name), which contains the
              <code className="mx-1 px-1 bg-amber-100 rounded">Subproject:</code> markers.
            </span>
          </div>
        )}
        {sections.map((sp, si) => {
          const area = groupBySub ? areaFor(sp.name) : totalArea
          return (
            <SubprojectCard
              key={si}
              sp={sp}
              cols={cols}
              showWorking={showWorking}
              showMetrics={showMetrics}
              costBase={costBase}
              area={area}
              grandCost={grandCost}
              areaEditable={groupBySub}
              isAreaAuto={groupBySub ? isAreaAuto(sp.name) : false}
              onSetArea={(sqft: number | null) => onSetArea(sp.name, sqft)}
              isCollapsed={(ci: number) => collapsed.has(`${si}:${ci}`)}
              onToggle={(ci: number) => toggle(`${si}:${ci}`)}
            />
          )
        })}
        <GrandTotalBar totals={gt} grandCost={grandCost} totalArea={totalArea} showMetrics={showMetrics} />
      </div>
    </Card>
  )
}

// Editable built-up area chip shown in a sub-project header.
function AreaBox({ value, isAuto, onSet }: { value: number; isAuto: boolean; onSet: (v: number | null) => void }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-blue-100" onClick={e => e.stopPropagation()}>
      Built-up
      <input
        type="number"
        defaultValue={value > 0 ? value : ''}
        placeholder="sq ft"
        onBlur={e => { const v = e.target.value.trim(); const n = v === '' ? null : Number(v); onSet(n != null && Number.isFinite(n) ? n : null) }}
        className="w-20 h-6 rounded bg-white/90 text-gray-900 px-1.5 text-right text-[11px] focus:outline-none"
      />
      sq ft{isAuto && value > 0 ? <span className="opacity-70"> (auto)</span> : null}
    </span>
  )
}

function SubprojectCard({ sp, cols, showWorking, showMetrics, costBase, area, grandCost, areaEditable, isAreaAuto, onSetArea, isCollapsed, onToggle }: {
  sp: SubprojectGroup; cols: string[]; showWorking: boolean; showMetrics: boolean; costBase: CostBase
  area: number; grandCost: number; areaEditable: boolean; isAreaAuto: boolean
  onSetArea: (sqft: number | null) => void
  isCollapsed: (ci: number) => boolean; onToggle: (ci: number) => void
}) {
  const t = subprojectTotal(sp)
  const rs = showMetrics && area > 0 ? costOf(t, costBase) / area : null
  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden shadow-sm">
      <div className="bg-[#1F4E78] text-white px-3 py-2.5 flex flex-wrap items-center justify-between gap-2">
        <span className="font-bold text-sm inline-flex items-center gap-2">
          <Layers className="h-4 w-4 text-amber-300" />
          {sp.name}
          <span className="text-[10px] font-normal text-blue-100">
            {sp.categories.length} categor{sp.categories.length === 1 ? 'y' : 'ies'}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-blue-100 tabular-nums">
          {areaEditable && <AreaBox value={area} isAuto={isAreaAuto} onSet={onSetArea} />}
          <span>Bill {formatNumber(t.billValue, 0)} · Paid {formatNumber(t.paidValue, 0)} · Owed {formatNumber(t.totalOwed, 0)}{rs != null ? ` · ${formatNumber(rs, 0)} Rs/Sft` : ''}</span>
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-gray-100 text-gray-600 text-[10px] uppercase tracking-wide">
              <th className="px-3 py-1.5 text-left font-semibold">Category</th>
              <th className="px-3 py-1.5 text-left font-semibold">Contractor</th>
              {cols.map(c => <th key={c} className="px-3 py-1.5 text-right font-semibold">{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {sp.categories.map((cat, ci) => (
              <CategoryBlock key={ci} cat={cat} showWorking={showWorking} showMetrics={showMetrics} costBase={costBase} area={area} grandCost={grandCost} collapsed={isCollapsed(ci)} onToggle={() => onToggle(ci)} />
            ))}
            <TotalsRow label={`${sp.name} — total`} totals={t} showWorking={showWorking} showMetrics={showMetrics} costBase={costBase} area={area} grandCost={grandCost} />
          </tbody>
        </table>
      </div>
    </div>
  )
}

function GrandTotalBar({ totals, grandCost, totalArea, showMetrics }: { totals: Totals; grandCost: number; totalArea: number; showMetrics: boolean }) {
  const rs = showMetrics && totalArea > 0 ? grandCost / totalArea : null
  return (
    <div className="rounded-xl bg-[#FFE699] border border-amber-300 px-4 py-3 flex flex-wrap items-center justify-between gap-2 font-bold text-gray-900">
      <span>GRAND TOTAL — all sub-projects{totalArea > 0 ? ` · ${formatNumber(totalArea, 0)} sq ft` : ''}</span>
      <span className="text-sm tabular-nums">
        WO {formatNumber(totals.woValue, 0)} · Bill {formatNumber(totals.billValue, 0)} · Paid {formatNumber(totals.paidValue, 0)} · Owed {formatNumber(totals.totalOwed, 0)}{rs != null ? ` · ${formatNumber(rs, 0)} Rs/Sft` : ''}
      </span>
    </div>
  )
}

function CategoryBlock({ cat, showWorking, showMetrics, costBase, area, grandCost, collapsed, onToggle }: {
  cat: RawCategory; showWorking: boolean; showMetrics: boolean; costBase: CostBase; area: number; grandCost: number
  collapsed: boolean; onToggle: () => void
}) {
  const sub = categorySubtotal(cat)
  return (
    <>
      <tr className="bg-[#D9E1F2] font-semibold cursor-pointer select-none hover:bg-[#cdd8ee]" onClick={onToggle}>
        <td className="px-3 py-1.5 text-gray-800" colSpan={2}>
          <span className="inline-flex items-center gap-1.5">
            {collapsed ? <ChevronRight className="h-3.5 w-3.5 text-[#1F4E78]" /> : <ChevronDown className="h-3.5 w-3.5 text-[#1F4E78]" />}
            {displayCategory(cat.category)}
            <span className="text-[10px] font-normal text-gray-500">({cat.contractors.length})</span>
          </span>
        </td>
        <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(sub.woValue, 0)}</td>
        <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(sub.billValue, 0)}</td>
        <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(sub.paidValue, 0)}</td>
        {showWorking && <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(sub.deductions, 0)}</td>}
        {showWorking && <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(sub.retentionHeld, 0)}</td>}
        {showWorking && <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(sub.balanceValue, 0)}</td>}
        <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(sub.totalOwed, 0)}</td>
        {showMetrics && <MetricCells amount={costOf(sub, costBase)} area={area} grandCost={grandCost} tone="text-gray-800" />}
      </tr>
      {!collapsed && cat.contractors.map((raw, i) => {
        const c = deriveContractor(raw)
        return (
          <tr key={i} className="border-t border-gray-100 hover:bg-gray-50">
            <td className="px-3 py-1.5" />
            <td className="px-3 py-1.5 pl-6 text-gray-700">{c.contractor}</td>
            <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">{formatNumber(c.woValue, 0)}</td>
            <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">{formatNumber(c.billValue, 0)}</td>
            <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">{formatNumber(c.paidValue, 0)}</td>
            {showWorking && <td className="px-3 py-1.5 text-right tabular-nums text-gray-500">{formatNumber(c.deductions, 0)}</td>}
            {showWorking && <td className="px-3 py-1.5 text-right tabular-nums text-gray-500">{formatNumber(c.retentionHeld, 0)}</td>}
            {showWorking && <td className="px-3 py-1.5 text-right tabular-nums text-gray-500">{formatNumber(c.balanceValue, 0)}</td>}
            <td className="px-3 py-1.5 text-right tabular-nums font-medium text-gray-900">{formatNumber(c.totalOwed, 0)}</td>
            {showMetrics && <MetricCells amount={costOf(c, costBase)} area={area} grandCost={grandCost} />}
          </tr>
        )
      })}
    </>
  )
}

function TotalsRow({ label, totals, showWorking, showMetrics, costBase, area, grandCost, grand }: {
  label: string; totals: Totals; showWorking: boolean; showMetrics: boolean; costBase: CostBase; area: number; grandCost: number; grand?: boolean
}) {
  const cls = grand ? 'bg-[#FFE699] font-bold text-gray-900 border-t-2 border-amber-300' : 'bg-[#D9E1F2]/60 font-semibold'
  return (
    <tr className={cls}>
      <td className="px-3 py-2" colSpan={2}>{label}</td>
      <td className="px-3 py-2 text-right tabular-nums">{formatNumber(totals.woValue, 0)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{formatNumber(totals.billValue, 0)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{formatNumber(totals.paidValue, 0)}</td>
      {showWorking && <td className="px-3 py-2 text-right tabular-nums">{formatNumber(totals.deductions, 0)}</td>}
      {showWorking && <td className="px-3 py-2 text-right tabular-nums">{formatNumber(totals.retentionHeld, 0)}</td>}
      {showWorking && <td className="px-3 py-2 text-right tabular-nums">{formatNumber(totals.balanceValue, 0)}</td>}
      <td className="px-3 py-2 text-right tabular-nums">{formatNumber(totals.totalOwed, 0)}</td>
      {showMetrics && <MetricCells amount={costOf(totals, costBase)} area={area} grandCost={grandCost} tone="" py="py-2" />}
    </tr>
  )
}
