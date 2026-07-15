'use client'
// Supplier Report — persisted like the Contractor Report. The team's data
// lives server-side (supplier_report_state); this page loads it on open, lets
// you update by uploading a fresh IN4 "All Purchase Payments Report" (replaces
// that project), shows it on screen with the working columns (Recoveries /
// Retention / Net Payable) hidden by default, and exports a clean Excel/PDF.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { QueryError } from '@/components/ui/query-error'
import {
  FileSpreadsheet, FileText, UploadCloud, Download, Loader2, Eye, EyeOff, X, Clock, Lock, Search,
  CheckCircle2, AlertTriangle, ChevronRight, ChevronDown, ChevronsDownUp, ChevronsUpDown, Layers,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatNumber, formatDateTime, cn } from '@/lib/utils'
import { formatINR as compactINR } from '@/lib/budget-utils'
import { confirm } from '@/components/ui/confirm-dialog'
import {
  parseSourceReports, reconcile, categorySubtotal, subprojectTotal,
  reportGrandTotal, combineSubprojects, displayCategory, costOf, COST_BASE_OPTIONS, sumSuppliers,
  type ReportDoc, type RawCategory, type SubprojectGroup, type Totals,
  type CostBase, type SupplierReportSettings,
} from '@/lib/supplier-report'

// Teal accent so the Supplier Report reads as a sibling of — but distinct
// from — the navy Contractor Report.
const ACCENT = '#0F766E'       // teal-700
const ACCENT_DARK = '#115E59'  // teal-800
const CAT_TINT = '#CCFBF1'     // teal-100 (category group rows)
const CAT_TINT_HOVER = '#99F6E4'

// Backward-compat: older saved reports stored a flat `categories` array.
function normalizeDoc(d: ReportDoc & { categories?: RawCategory[] }): ReportDoc {
  if (d.subprojects && d.subprojects.length) return d
  const cats = d.categories ?? []
  return { ...d, subprojects: cats.length ? [{ name: 'All sub-projects', categories: cats }] : [] }
}

const STATE_URL = '/api/supplier-report/state'

// One upload can carry MANY projects (a company-wide export). We split it into
// one ReportDoc per project so each becomes its own chip.
async function parseFile(file: File): Promise<ReportDoc[]> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(new Uint8Array(buf), { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws) throw new Error('Workbook has no sheets')
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true }) as (string | number | null)[][]
  const parsedList = parseSourceReports(rows).filter(p => p.subprojects.length > 0)
  if (parsedList.length === 0) {
    throw new Error('No supplier rows found — is this the IN4 “All Purchase Payments Report” export (.xlsx)?')
  }
  const uploadedAt = new Date().toISOString()
  return parsedList.map(parsed => ({
    id: crypto.randomUUID(),
    projectName: parsed.projectName,
    title: parsed.title,
    subtitle: parsed.subtitle,
    sourceFilename: file.name,
    uploadedAt,
    subprojects: parsed.subprojects,
    computedBill: parsed.computedBill,
    source: parsed.source,
  }))
}

type FullState = { reports: ReportDoc[]; settings: SupplierReportSettings }

export default function SupplierReportClient({ canDelete = false }: { canDelete?: boolean }) {
  const [reports, setReports] = useState<ReportDoc[]>([])
  const [costBase, setCostBase] = useState<CostBase>('bill')
  const [showMetrics, setShowMetrics] = useState(true)
  const [budgetAreas, setBudgetAreas] = useState<Record<string, number>>({})
  const [updatedInfo, setUpdatedInfo] = useState<{ at: string | null; by: string | null }>({ at: null, by: null })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [projectFilter, setProjectFilter] = useState('')
  const [showWorking, setShowWorking] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const dragCounter = useRef(0)

  // ── Load saved state + Budget-vs-Actual areas on open ───────────────────
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [stateRes, areasRes] = await Promise.all([fetch(STATE_URL), fetch('/api/supplier-report/areas')])
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
    setCostBase(base)
    try { await persistState(s => ({ ...s, settings: { ...s.settings, costBase: base } })) }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save setting') }
  }

  async function changeShowMetrics(next: boolean) {
    setShowMetrics(next)
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
    if (files.length === 0) { toast.error('Please choose an IN4 Purchase Payments .xlsx'); return }
    try {
      const docs: ReportDoc[] = []
      for (const f of files) docs.push(...await parseFile(f))
      const next = await persistReports(reports => {
        let out = reports
        for (const doc of docs) {
          const i = out.findIndex(r => r.projectName === doc.projectName)
          out = i >= 0 ? out.map((r, j) => (j === i ? { ...doc, areaBySub: out[i].areaBySub } : r)) : [...out, doc]
        }
        return out
      })
      const firstAdded = docs[0]
      setSelectedId(next.find(r => r.projectName === firstAdded.projectName)?.id ?? next[0]?.id ?? null)
      const nProjects = new Set(docs.map(d => d.projectName)).size
      toast.success(
        nProjects === 1
          ? `Saved “${firstAdded.projectName}” for the whole team`
          : `Saved ${nProjects} projects for the whole team`,
      )
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

  // Page-wide drag handlers.
  function isFileDrag(e: React.DragEvent): boolean {
    const types = e.dataTransfer?.types
    if (!types) return false
    for (let i = 0; i < types.length; i++) if (types[i] === 'Files') return true
    return false
  }
  const onPageDragEnter = (e: React.DragEvent) => { if (!isFileDrag(e)) return; e.preventDefault(); dragCounter.current += 1; setDragOver(true) }
  const onPageDragOver = (e: React.DragEvent) => { if (!isFileDrag(e)) return; e.preventDefault() }
  const onPageDragLeave = (e: React.DragEvent) => { if (!isFileDrag(e)) return; e.preventDefault(); dragCounter.current = Math.max(0, dragCounter.current - 1); if (dragCounter.current === 0) setDragOver(false) }
  const onPageDrop = (e: React.DragEvent) => { e.preventDefault(); dragCounter.current = 0; setDragOver(false); handleFiles(e.dataTransfer.files) }

  const selected = reports.find(r => r.id === selectedId) ?? null

  const reportMeta = useMemo(() => {
    const m = new Map<string, { bill: number }>()
    for (const r of reports) m.set(r.id, { bill: reportGrandTotal(r.subprojects).billValue })
    return m
  }, [reports])

  const sortedReports = useMemo(
    () => [...reports].sort((a, b) => (reportMeta.get(b.id)?.bill ?? 0) - (reportMeta.get(a.id)?.bill ?? 0)),
    [reports, reportMeta],
  )
  const q = projectFilter.trim().toLowerCase()
  const shownReports = q ? sortedReports.filter(r => r.projectName.toLowerCase().includes(q)) : sortedReports
  const totalBillAll = useMemo(
    () => reports.reduce((s, r) => s + (reportMeta.get(r.id)?.bill ?? 0), 0),
    [reports, reportMeta],
  )

  return (
    <div
      className="p-4 md:p-6 max-w-6xl mx-auto space-y-5 relative"
      onDragEnter={onPageDragEnter}
      onDragOver={onPageDragOver}
      onDragLeave={onPageDragLeave}
      onDrop={onPageDrop}
    >
      {dragOver && (
        <div className="fixed inset-0 z-50 bg-teal-900/15 backdrop-blur-[2px] flex items-center justify-center pointer-events-none">
          <div className="bg-white rounded-2xl px-8 py-7 shadow-2xl border-2 border-dashed text-center" style={{ borderColor: ACCENT }}>
            <UploadCloud className="h-10 w-10 mx-auto mb-2" style={{ color: ACCENT }} />
            <p className="text-base font-semibold text-gray-900">Drop the IN4 .xlsx anywhere</p>
            <p className="text-xs text-gray-500 mt-1">“All Purchase Payments Report” export</p>
          </div>
        </div>
      )}

      <PageHeader
        title="Supplier Report"
        subtitle="Category × Supplier summary, saved for the whole team. Re-upload the latest IN4 export to update."
      >
        <label className="inline-flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
          <input type="checkbox" checked={showWorking} onChange={e => setShowWorking(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300" style={{ accentColor: ACCENT }} />
          {showWorking ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          Show working columns
        </label>
        <label className="inline-flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer" title="Show % of Cost and Rs/Sft columns (saved for the whole team)">
          <input type="checkbox" checked={showMetrics} onChange={e => changeShowMetrics(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300" style={{ accentColor: ACCENT }} />
          {showMetrics ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          Show % / Rs·Sft
        </label>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          title='Upload IN4 "All Purchase Payments Report" (.xlsx) — or drop the file anywhere on this page'
          className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-gray-300 bg-white text-xs font-medium text-gray-700 hover:border-teal-600 hover:text-teal-700 hover:bg-teal-50/40 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
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
          <div className="h-12 w-12 rounded-2xl inline-flex items-center justify-center mb-3" style={{ backgroundColor: CAT_TINT, color: ACCENT }}>
            <UploadCloud className="h-6 w-6" />
          </div>
          <p className="text-sm text-gray-700 font-medium">No reports saved yet.</p>
          <p className="text-xs text-gray-500 mt-1">
            Upload the IN4 <b>“All Purchase Payments Report”</b> export, or drop it anywhere on this page — it&apos;ll be saved for the whole team.
          </p>
          <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={busy} className="mt-4">
            <FileSpreadsheet className="h-4 w-4" /> Choose file
          </Button>
        </Card>
      ) : (
        <>
          <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-baseline gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Projects</span>
                <span className="text-[11px] text-gray-400">
                  {shownReports.length === reports.length ? `${reports.length}` : `${shownReports.length} of ${reports.length}`}
                  {' · '}{compactINR(totalBillAll)} billed
                </span>
              </div>
              <div className="flex items-center gap-2">
                {reports.length > 6 && (
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
                    <input
                      value={projectFilter}
                      onChange={e => setProjectFilter(e.target.value)}
                      placeholder="Filter projects…"
                      className="h-8 w-44 sm:w-52 rounded-lg border border-gray-200 bg-white pl-7 pr-7 text-xs text-gray-700 focus:border-teal-600 focus:ring-1 focus:ring-teal-600/30 outline-none"
                    />
                    {projectFilter && (
                      <button onClick={() => setProjectFilter('')} title="Clear"
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                )}
                {!canDelete && (
                  <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-gray-400" title="Only admins / Portal Owner can remove a saved report">
                    <Lock className="h-3 w-3" /> admin only
                  </span>
                )}
              </div>
            </div>

            {shownReports.length === 0 ? (
              <p className="text-xs text-gray-400 py-1">No projects match “{projectFilter}”.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {shownReports.map(r => {
                  const active = r.id === selectedId
                  const bill = reportMeta.get(r.id)?.bill ?? 0
                  return (
                    <span key={r.id}
                      className={cn(
                        'group inline-flex items-center gap-1.5 rounded-lg border py-1 text-xs cursor-pointer transition-colors',
                        canDelete ? 'pl-2.5 pr-1.5' : 'px-2.5',
                        active
                          ? 'text-white shadow-sm'
                          : 'bg-white border-gray-200 text-gray-700 hover:border-teal-500/50 hover:bg-teal-50/40',
                      )}
                      style={active ? { backgroundColor: ACCENT, borderColor: ACCENT } : undefined}
                      onClick={() => setSelectedId(r.id)}>
                      <FileSpreadsheet className={cn('h-3 w-3 flex-shrink-0', active ? 'text-white/80' : 'text-gray-400')} />
                      <span className="max-w-[14rem] truncate font-medium">{r.projectName}</span>
                      <span className={cn('tabular-nums text-[10px] rounded px-1 py-0.5', active ? 'bg-white/15 text-white/90' : 'bg-gray-100 text-gray-500')}>
                        {compactINR(bill)}
                      </span>
                      {canDelete && (
                        <button onClick={e => { e.stopPropagation(); removeReport(r) }}
                          className={cn(active ? 'text-white/70 hover:text-white' : 'text-gray-300 hover:text-rose-600')}
                          title="Remove (admin only)">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </span>
                  )
                })}
              </div>
            )}
          </div>

          {updatedInfo.at && (
            <p className="text-[11px] text-gray-400 inline-flex items-center gap-1">
              <Clock className="h-3 w-3" /> Last updated {formatDateTime(updatedInfo.at)}{updatedInfo.by ? ` by ${updatedInfo.by}` : ''}
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

// ── Excel export ───────────────────────────────────────────────────────────
function safeSheetName(name: string): string {
  return (name.replace(/[:\\/?*[\]]/g, '-').slice(0, 31)) || 'Sheet'
}
const XL_HEADERS_BASE = ['Category', 'Supplier', 'Total Bill Value', 'Recoveries', 'Retention Held', 'Net Payable', 'Total Paid Value', 'Outstanding']
const XL_METRIC_HEADERS = ['% of Cost', 'Rs/Sft']

function categoriesToSheet(title: string, subtitle: string, categories: RawCategory[], grand: Totals, costBase: CostBase, area: number, grandCost: number, showMetrics: boolean) {
  const headers = showMetrics ? [...XL_HEADERS_BASE, ...XL_METRIC_HEADERS] : XL_HEADERS_BASE
  const lastCol = headers.length - 1
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
    for (const s of cat.suppliers) {
      aoa.push(withMetrics([null, s.supplier, s.billValue, s.recoveries, s.retentionHeld, s.netPayable, s.paidValue, s.outstanding], s))
    }
    const st = categorySubtotal(cat)
    aoa.push(withMetrics([`${displayCategory(cat.category)} — Subtotal`, null, st.billValue, st.recoveries, st.retentionHeld, st.netPayable, st.paidValue, st.outstanding], st))
    aoa.push([])
  }
  aoa.push(withMetrics(['GRAND TOTAL', null, grand.billValue, grand.recoveries, grand.retentionHeld, grand.netPayable, grand.paidValue, grand.outstanding], grand))
  aoa.push([])
  aoa.push(['Notes:'])
  if (showMetrics) {
    aoa.push([`• % of Cost and Rs/Sft are based on ${COST_BASE_OPTIONS.find(o => o.value === costBase)?.label ?? 'Total Bill Value'}${area > 0 ? `; built-up area = ${area.toLocaleString('en-IN')} sq ft` : ' (no built-up area set — Rs/Sft blank)'}.`])
  }
  aoa.push(['• Net Payable (F) = Total Bill Value (C) − Recoveries (D) − Retention Held (E).'])
  aoa.push(['• Outstanding (H) = Net Payable (F) − Total Paid Value (G) — the amount still to pay the supplier.'])
  aoa.push(['• Columns D, E and F (Recoveries, Retention, Net Payable) are hidden for a cleaner view; unhide to see the full working.'])

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const baseWidths = [34, 40, 18, 14, 14, 18, 18, 18]
  const metricWidths = [10, 12]
  const widths = showMetrics ? [...baseWidths, ...metricWidths] : baseWidths
  ws['!cols'] = widths.map((wch, i) => ({ wch, hidden: i === 3 || i === 4 || i === 5 }))
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: lastCol } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: lastCol } },
  ]
  const range = XLSX.utils.decode_range(ws['!ref'] as string)
  for (let R = 3; R <= range.e.r; R++) {
    for (let Col = 2; Col <= 7; Col++) {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: Col })]
      if (cell && typeof cell.v === 'number') cell.z = '#,##0;(#,##0);-'
    }
    if (showMetrics) {
      const pctCell = ws[XLSX.utils.encode_cell({ r: R, c: 8 })]
      if (pctCell && typeof pctCell.v === 'number') pctCell.z = '0.0"%"'
      const rsCell = ws[XLSX.utils.encode_cell({ r: R, c: 9 })]
      if (rsCell && typeof rsCell.v === 'number') rsCell.z = '#,##0'
    }
  }
  return ws
}

// ── PDF export — mirrors the on-screen layout ──────────────────────────────
const PDF_HEADERS_BASE  = ['Category', 'Supplier', 'Total Bill', 'Total Paid', 'Outstanding']
const PDF_HEADERS_WORK  = ['Category', 'Supplier', 'Total Bill', 'Recoveries', 'Retention', 'Net Payable', 'Total Paid', 'Outstanding']
const PDF_HEADERS_METRIC = ['% Cost', 'Rs/Sft']

type PdfRowKind = 'group' | 'item' | 'subtotal'
interface PdfRow { kind: PdfRowKind; cells: (string | number | null)[] }

function fmtAmount(n: number | null): string {
  if (n == null) return ''
  if (n === 0) return '-'
  return formatNumber(n, 0)
}
function pctOf(amount: number, grandCost: number): string {
  return grandCost > 0 ? ((amount / grandCost) * 100).toFixed(1) + '%' : '—'
}
function rsPerSft(amount: number, area: number): string {
  return area > 0 ? formatNumber(amount / area, 0) : '—'
}

function buildSectionRows(
  categories: RawCategory[],
  showWorking: boolean,
  showMetrics: boolean,
  costBase: CostBase,
  area: number,
  grandCost: number,
): PdfRow[] {
  const rows: PdfRow[] = []
  for (const cat of categories) {
    rows.push({ kind: 'group', cells: [displayCategory(cat.category)] })
    for (const s of cat.suppliers) {
      const base = showWorking
        ? ['', s.supplier, fmtAmount(s.billValue), fmtAmount(s.recoveries), fmtAmount(s.retentionHeld), fmtAmount(s.netPayable), fmtAmount(s.paidValue), fmtAmount(s.outstanding)]
        : ['', s.supplier, fmtAmount(s.billValue), fmtAmount(s.paidValue), fmtAmount(s.outstanding)]
      const metrics = showMetrics ? [pctOf(costOf(s, costBase), grandCost), rsPerSft(costOf(s, costBase), area)] : []
      rows.push({ kind: 'item', cells: [...base, ...metrics] })
    }
    const st = categorySubtotal(cat)
    const subBase = showWorking
      ? [`${displayCategory(cat.category)} — Subtotal`, '', fmtAmount(st.billValue), fmtAmount(st.recoveries), fmtAmount(st.retentionHeld), fmtAmount(st.netPayable), fmtAmount(st.paidValue), fmtAmount(st.outstanding)]
      : [`${displayCategory(cat.category)} — Subtotal`, '', fmtAmount(st.billValue), fmtAmount(st.paidValue), fmtAmount(st.outstanding)]
    const subMetrics = showMetrics ? [pctOf(costOf(st, costBase), grandCost), rsPerSft(costOf(st, costBase), area)] : []
    rows.push({ kind: 'subtotal', cells: [...subBase, ...subMetrics] })
  }
  return rows
}

function exportReportPDF(
  doc: ReportDoc,
  groupBySub: boolean,
  costBase: CostBase,
  areaFor: (subName: string) => number,
  showWorking: boolean,
  showMetrics: boolean,
) {
  const pdf = new jsPDF({ orientation: 'landscape', format: 'a4', unit: 'pt' })
  const pageW = pdf.internal.pageSize.getWidth()
  const margin = 32
  let y = margin

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(16)
  pdf.setTextColor(15, 118, 110) // ACCENT teal-700
  pdf.text(doc.title, margin, y)
  y += 20
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(9)
  pdf.setTextColor(110, 110, 110)
  pdf.text(`${doc.subtitle} · from ${doc.sourceFilename}`, margin, y)
  y += 14
  const rec = reconcile(doc.computedBill, doc.source)
  if (rec.available) {
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(8.5)
    pdf.setTextColor(rec.allOk ? 6 : 146, rec.allOk ? 95 : 64, rec.allOk ? 70 : 14)
    pdf.text(rec.allOk ? '✓ Reconciles with IN4 Total(s)' : '⚠ Bill total differs from IN4 — see notes', margin, y)
    y += 12
  }

  const baseHeaders = showWorking ? PDF_HEADERS_WORK : PDF_HEADERS_BASE
  const headers = showMetrics ? [...baseHeaders, ...PDF_HEADERS_METRIC] : baseHeaders
  const numCols = headers.length

  const gt = reportGrandTotal(doc.subprojects)
  const grandCost = costOf(gt, costBase)
  const totalArea = doc.subprojects.reduce((s, sp) => s + areaFor(sp.name), 0)

  const sections: SubprojectGroup[] = groupBySub
    ? doc.subprojects
    : [{ name: 'All sub-projects (combined)', categories: combineSubprojects(doc.subprojects) }]

  for (const sp of sections) {
    const area = groupBySub ? areaFor(sp.name) : totalArea
    const spTotals = sumSuppliers(sp.categories.flatMap(c => c.suppliers))
    pdf.setFillColor(240, 253, 250) // teal-50
    pdf.setDrawColor(204, 251, 241)
    pdf.rect(margin, y, pageW - 2 * margin, 18, 'F')
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(10)
    pdf.setTextColor(15, 118, 110)
    pdf.text(sp.name, margin + 6, y + 12)
    if (area > 0) {
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(8)
      pdf.setTextColor(120, 120, 120)
      pdf.text(`Built-up area: ${formatNumber(area, 0)} sq ft`, pageW - margin - 6, y + 12, { align: 'right' })
    }
    y += 22

    const rows = buildSectionRows(sp.categories, showWorking, showMetrics, costBase, area, grandCost)
    autoTable(pdf, {
      startY: y,
      head: [headers],
      body: rows.map(r => {
        if (r.kind === 'group') return [{ content: r.cells[0], colSpan: numCols, styles: { fillColor: [240, 253, 250] as [number, number, number], textColor: 20, fontStyle: 'bold' } }] as unknown as (string | number | null)[]
        return r.cells
      }),
      didParseCell: (data) => {
        const row = rows[data.row.index]
        if (!row) return
        if (row.kind === 'subtotal') {
          data.cell.styles.fillColor = [255, 251, 235] // amber-50
          data.cell.styles.textColor = [120, 53, 15]
          data.cell.styles.fontStyle = 'bold'
        }
        if (data.section === 'body' && data.column.index >= 2 && row.kind !== 'group') {
          data.cell.styles.halign = 'right'
        }
      },
      headStyles: { fillColor: [15, 118, 110], textColor: 255, fontStyle: 'bold', halign: 'right' },
      columnStyles: { 0: { halign: 'left' }, 1: { halign: 'left' } },
      styles: { font: 'helvetica', fontSize: 8, cellPadding: 3, lineColor: [229, 231, 235], lineWidth: 0.5 },
      margin: { left: margin, right: margin },
      theme: 'grid',
      foot: [[
        ...(showWorking
          ? [`${sp.name} — TOTAL`, '', fmtAmount(spTotals.billValue), fmtAmount(spTotals.recoveries), fmtAmount(spTotals.retentionHeld), fmtAmount(spTotals.netPayable), fmtAmount(spTotals.paidValue), fmtAmount(spTotals.outstanding)]
          : [`${sp.name} — TOTAL`, '', fmtAmount(spTotals.billValue), fmtAmount(spTotals.paidValue), fmtAmount(spTotals.outstanding)]),
        ...(showMetrics ? [pctOf(costOf(spTotals, costBase), grandCost), rsPerSft(costOf(spTotals, costBase), area)] : []),
      ]],
      footStyles: { fillColor: [15, 118, 110], textColor: 255, fontStyle: 'bold', halign: 'right' },
    })
    // @ts-expect-error autoTable attaches lastAutoTable on the doc at runtime.
    y = (pdf.lastAutoTable?.finalY ?? y) + 14
  }

  if (sections.length > 1 || groupBySub) {
    if (y > pdf.internal.pageSize.getHeight() - 60) { pdf.addPage(); y = margin }
    pdf.setFillColor(120, 53, 15)  // amber-900
    pdf.rect(margin, y, pageW - 2 * margin, 24, 'F')
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(11)
    pdf.setTextColor(255, 255, 255)
    pdf.text(`GRAND TOTAL — all sub-projects: ${formatNumber(grandCost, 0)}` +
      (showMetrics && totalArea > 0 ? ` · ${formatNumber(grandCost / totalArea, 0)} Rs/Sft` : ''),
      margin + 8, y + 16)
    y += 32
  }

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(8.5)
  pdf.setTextColor(80, 80, 80)
  pdf.text('Notes:', margin, y)
  y += 11
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(8)
  const notes: string[] = []
  if (showMetrics) {
    notes.push(`• % of Cost and Rs/Sft are based on ${COST_BASE_OPTIONS.find(o => o.value === costBase)?.label ?? 'Total Bill Value'}${totalArea > 0 ? `; total built-up area = ${formatNumber(totalArea, 0)} sq ft` : ' (no built-up area set — Rs/Sft blank)'}.`)
  }
  notes.push('• Net Payable = Total Bill − Recoveries − Retention. Outstanding = Net Payable − Total Paid.')
  if (!showWorking) notes.push('• Working columns (Recoveries, Retention, Net Payable) are hidden in this view — turn them on in the app to see the full breakdown.')
  for (const n of notes) {
    if (y > pdf.internal.pageSize.getHeight() - margin) { pdf.addPage(); y = margin }
    const wrapped = pdf.splitTextToSize(n, pageW - 2 * margin)
    pdf.text(wrapped, margin, y)
    y += wrapped.length * 10
  }

  pdf.save(`${doc.projectName.replace(/[^\w-]+/g, '_')}_SupplierReport.pdf`)
}

function exportReport(doc: ReportDoc, groupBySub: boolean, costBase: CostBase, areaFor: (subName: string) => number, showMetrics: boolean) {
  const wb = XLSX.utils.book_new()
  const grandCost = costOf(reportGrandTotal(doc.subprojects), costBase)
  if (groupBySub) {
    for (const sp of doc.subprojects) {
      const ws = categoriesToSheet(`${doc.projectName} — ${sp.name}`, `${sp.name} — Category-wise & Supplier-wise Summary (INR)`, sp.categories, subprojectTotal(sp), costBase, areaFor(sp.name), grandCost, showMetrics)
      XLSX.utils.book_append_sheet(wb, ws, safeSheetName(sp.name))
    }
  } else {
    const totalArea = doc.subprojects.reduce((s, sp) => s + areaFor(sp.name), 0)
    const ws = categoriesToSheet(doc.title, 'Category-wise & Supplier-wise Summary (All Sub-projects, INR)', combineSubprojects(doc.subprojects), reportGrandTotal(doc.subprojects), costBase, totalArea, grandCost, showMetrics)
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName(`${doc.projectName} — All`))
  }
  XLSX.writeFile(wb, `${doc.projectName.replace(/[^\w-]+/g, '_')}_SupplierReport.xlsx`)
}

// Proof the figures tie back to IN4's own "Total(s)" rows.
function ReconciliationPanel({ doc }: { doc: ReportDoc }) {
  const rec = reconcile(doc.computedBill, doc.source)
  if (!rec.available) {
    return (
      <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 text-[11px] text-gray-500">
        No “Total(s)” row found in the source — totals shown are computed from the supplier rows.
      </div>
    )
  }
  return (
    <div className={`px-4 py-2 border-b text-[11px] ${rec.allOk ? 'bg-emerald-50 border-emerald-100' : 'bg-amber-50 border-amber-100'}`}>
      <div className="flex items-center gap-1.5 font-semibold mb-1">
        {rec.allOk
          ? <span className="text-emerald-800 inline-flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> Reconciles with IN4 Total(s)</span>
          : <span className="text-amber-800 inline-flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" /> Bill total differs from IN4 — review below</span>}
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
    ? ['Total Bill', 'Recoveries', 'Retention', 'Net Payable', 'Total Paid', 'Outstanding']
    : ['Total Bill', 'Total Paid', 'Outstanding']
  const cols = showMetrics ? [...baseCols, '% Cost', 'Rs/Sft'] : baseCols

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
            <button onClick={() => setGroupBySub(true)} className="px-2.5 py-1.5 font-medium" style={groupBySub ? { backgroundColor: ACCENT, color: 'white' } : undefined}>By sub-project</button>
            <button onClick={() => setGroupBySub(false)} className="px-2.5 py-1.5 font-medium" style={!groupBySub ? { backgroundColor: ACCENT, color: 'white' } : undefined}>Combined</button>
          </div>
          <Button size="sm" variant="outline" onClick={() => { if (allCollapsed) expandAll(); else collapseAll() }} title="Expand or collapse all categories">
            {allCollapsed ? <ChevronsUpDown className="h-4 w-4" /> : <ChevronsDownUp className="h-4 w-4" />}
            {allCollapsed ? 'Expand all' : 'Collapse all'}
          </Button>
          <Button size="sm" variant="outline" onClick={() => exportReportPDF(doc, groupBySub, costBase, areaFor, showWorking, showMetrics)}
            title="Download a print-ready PDF in the same layout as on screen">
            <FileText className="h-4 w-4" /> Export PDF
          </Button>
          <Button size="sm" onClick={() => exportReport(doc, groupBySub, costBase, areaFor, showMetrics)} className="text-white" style={{ backgroundColor: ACCENT }}>
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
              This report has <b>no sub-project breakdown</b> — re-upload the raw IN4 <b>“All Purchase Payments Report”</b> export, which contains the
              <code className="mx-1 px-1 bg-amber-100 rounded">SUBPROJECT NAME:</code> markers.
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

function AreaBox({ value, isAuto, onSet }: { value: number; isAuto: boolean; onSet: (v: number | null) => void }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-teal-50" onClick={e => e.stopPropagation()}>
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
      <div className="text-white px-3 py-2.5 flex flex-wrap items-center justify-between gap-2" style={{ backgroundColor: ACCENT }}>
        <span className="font-bold text-sm inline-flex items-center gap-2">
          <Layers className="h-4 w-4 text-amber-300" />
          {sp.name}
          <span className="text-[10px] font-normal text-teal-50">
            {sp.categories.length} categor{sp.categories.length === 1 ? 'y' : 'ies'}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-teal-50 tabular-nums">
          {areaEditable && <AreaBox value={area} isAuto={isAreaAuto} onSet={onSetArea} />}
          <span>Bill {formatNumber(t.billValue, 0)} · Paid {formatNumber(t.paidValue, 0)} · Outstanding {formatNumber(t.outstanding, 0)}{rs != null ? ` · ${formatNumber(rs, 0)} Rs/Sft` : ''}</span>
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-gray-100 text-gray-600 text-[10px] uppercase tracking-wide">
              <th className="px-3 py-1.5 text-left font-semibold">Category</th>
              <th className="px-3 py-1.5 text-left font-semibold">Supplier</th>
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
        Bill {formatNumber(totals.billValue, 0)} · Paid {formatNumber(totals.paidValue, 0)} · Outstanding {formatNumber(totals.outstanding, 0)}{rs != null ? ` · ${formatNumber(rs, 0)} Rs/Sft` : ''}
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
      <tr className="font-semibold cursor-pointer select-none" style={{ backgroundColor: CAT_TINT }}
        onMouseEnter={e => (e.currentTarget.style.backgroundColor = CAT_TINT_HOVER)}
        onMouseLeave={e => (e.currentTarget.style.backgroundColor = CAT_TINT)}
        onClick={onToggle}>
        <td className="px-3 py-1.5 text-gray-800" colSpan={2}>
          <span className="inline-flex items-center gap-1.5">
            {collapsed ? <ChevronRight className="h-3.5 w-3.5" style={{ color: ACCENT }} /> : <ChevronDown className="h-3.5 w-3.5" style={{ color: ACCENT }} />}
            {displayCategory(cat.category)}
            <span className="text-[10px] font-normal text-gray-500">({cat.suppliers.length})</span>
          </span>
        </td>
        <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(sub.billValue, 0)}</td>
        {showWorking && <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(sub.recoveries, 0)}</td>}
        {showWorking && <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(sub.retentionHeld, 0)}</td>}
        {showWorking && <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(sub.netPayable, 0)}</td>}
        <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(sub.paidValue, 0)}</td>
        <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(sub.outstanding, 0)}</td>
        {showMetrics && <MetricCells amount={costOf(sub, costBase)} area={area} grandCost={grandCost} tone="text-gray-800" />}
      </tr>
      {!collapsed && cat.suppliers.map((s, i) => (
        <tr key={i} className="border-t border-gray-100 hover:bg-gray-50">
          <td className="px-3 py-1.5" />
          <td className="px-3 py-1.5 pl-6 text-gray-700">{s.supplier}</td>
          <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">{formatNumber(s.billValue, 0)}</td>
          {showWorking && <td className="px-3 py-1.5 text-right tabular-nums text-gray-500">{formatNumber(s.recoveries, 0)}</td>}
          {showWorking && <td className="px-3 py-1.5 text-right tabular-nums text-gray-500">{formatNumber(s.retentionHeld, 0)}</td>}
          {showWorking && <td className="px-3 py-1.5 text-right tabular-nums text-gray-500">{formatNumber(s.netPayable, 0)}</td>}
          <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">{formatNumber(s.paidValue, 0)}</td>
          <td className="px-3 py-1.5 text-right tabular-nums font-medium text-gray-900">{formatNumber(s.outstanding, 0)}</td>
          {showMetrics && <MetricCells amount={costOf(s, costBase)} area={area} grandCost={grandCost} />}
        </tr>
      ))}
    </>
  )
}

function TotalsRow({ label, totals, showWorking, showMetrics, costBase, area, grandCost }: {
  label: string; totals: Totals; showWorking: boolean; showMetrics: boolean; costBase: CostBase; area: number; grandCost: number
}) {
  return (
    <tr className="font-semibold" style={{ backgroundColor: 'rgba(204,251,241,0.6)' }}>
      <td className="px-3 py-2" colSpan={2}>{label}</td>
      <td className="px-3 py-2 text-right tabular-nums">{formatNumber(totals.billValue, 0)}</td>
      {showWorking && <td className="px-3 py-2 text-right tabular-nums">{formatNumber(totals.recoveries, 0)}</td>}
      {showWorking && <td className="px-3 py-2 text-right tabular-nums">{formatNumber(totals.retentionHeld, 0)}</td>}
      {showWorking && <td className="px-3 py-2 text-right tabular-nums">{formatNumber(totals.netPayable, 0)}</td>}
      <td className="px-3 py-2 text-right tabular-nums">{formatNumber(totals.paidValue, 0)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{formatNumber(totals.outstanding, 0)}</td>
      {showMetrics && <MetricCells amount={costOf(totals, costBase)} area={area} grandCost={grandCost} tone="" py="py-2" />}
    </tr>
  )
}
