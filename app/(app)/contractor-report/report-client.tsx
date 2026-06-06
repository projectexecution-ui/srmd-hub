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
  reportGrandTotal, combineSubprojects, displayCategory,
  type ReportDoc, type RawCategory, type SubprojectGroup, type Totals,
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

export default function ContractorReportClient() {
  const [reports, setReports] = useState<ReportDoc[]>([])
  const [updatedInfo, setUpdatedInfo] = useState<{ at: string | null; by: string | null }>({ at: null, by: null })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showWorking, setShowWorking] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // ── Load saved state on open ────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(STATE_URL)
        const j = await res.json()
        if (cancelled) return
        if (!res.ok) { setLoadError(j.error || 'Failed to load saved reports'); setLoading(false); return }
        const list: ReportDoc[] = (j.state?.reports ?? []).map(normalizeDoc)
        setReports(list)
        setUpdatedInfo({ at: j.updated_at ?? null, by: j.updated_by_name ?? null })
        setSelectedId(prev => prev ?? list[0]?.id ?? null)
        setLoading(false)
      } catch (e) {
        if (!cancelled) { setLoadError(e instanceof Error ? e.message : String(e)); setLoading(false) }
      }
    })()
    return () => { cancelled = true }
  }, [])

  // ── Persist: read latest, apply mutation, write (mirrors budget hub) ─────
  const persist = useCallback(async (mutate: (reports: ReportDoc[]) => ReportDoc[]) => {
    setBusy(true)
    try {
      // Re-read latest so a teammate's change isn't clobbered, then force-write.
      const cur = await (await fetch(STATE_URL)).json()
      const base: ReportDoc[] = cur.state?.reports ?? []
      const next = mutate(base)
      const put = await fetch(STATE_URL, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ state: { reports: next }, baseVersion: cur.version, force: true }),
      })
      const j = await put.json()
      if (!put.ok) throw new Error(j.error || 'Save failed')
      setReports(next)
      setUpdatedInfo({ at: new Date().toISOString(), by: 'you' })
      return next
    } finally {
      setBusy(false)
    }
  }, [])

  const handleFiles = useCallback(async (list: FileList | null) => {
    if (!list) return
    const files = Array.from(list).filter(f => /\.xlsx?$/i.test(f.name))
    if (files.length === 0) { toast.error('Please choose a generated Contractor Report .xlsx'); return }
    try {
      const docs: ReportDoc[] = []
      for (const f of files) docs.push(await parseFile(f))
      const next = await persist(reports => {
        let out = reports
        for (const doc of docs) {
          const i = out.findIndex(r => r.projectName === doc.projectName)
          out = i >= 0 ? out.map((r, j) => (j === i ? doc : r)) : [...out, doc]
        }
        return out
      })
      const justAdded = docs[docs.length - 1]
      setSelectedId(next.find(r => r.projectName === justAdded.projectName)?.id ?? next[0]?.id ?? null)
      toast.success(`Saved ${docs.length} report${docs.length === 1 ? '' : 's'} for the whole team`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not process the file')
    }
  }, [persist])

  async function removeReport(doc: ReportDoc) {
    if (!(await confirm({ title: 'Remove report', message: `Remove the saved report for “${doc.projectName}”? This affects everyone.`, confirmLabel: 'Remove' }))) return
    try {
      const next = await persist(reports => reports.filter(r => r.id !== doc.id))
      setSelectedId(next[0]?.id ?? null)
      toast.success('Report removed')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not remove')
    }
  }

  const selected = reports.find(r => r.id === selectedId) ?? null

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-5">
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
      </PageHeader>

      {/* Upload / update zone */}
      <Card
        className={`p-5 border-2 border-dashed transition-colors ${dragOver ? 'border-[#1F4E78] bg-blue-50/50' : 'border-gray-300'}`}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files) }}
      >
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 text-center sm:text-left">
          <div className="h-11 w-11 rounded-2xl bg-[#1F4E78]/10 text-[#1F4E78] inline-flex items-center justify-center flex-shrink-0">
            {busy ? <Loader2 className="h-6 w-6 animate-spin" /> : <UploadCloud className="h-6 w-6" />}
          </div>
          <div className="min-w-0">
            <p className="text-sm text-gray-700">Drag &amp; drop the IN4 <b>“All Types Certificates Details”</b> export (.xlsx), or</p>
            <p className="text-[11px] text-gray-500">Re-uploading a project replaces its saved data for everyone.</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={busy} className="sm:ml-2">
            <FileSpreadsheet className="h-4 w-4" /> Choose file
          </Button>
          <input ref={inputRef} type="file" accept=".xlsx,.xls" multiple className="hidden"
            onChange={e => { handleFiles(e.target.files); e.target.value = '' }} />
        </div>
      </Card>

      {loadError && <QueryError what="saved reports" message={loadError} />}

      {loading ? (
        <Card className="p-8 text-center text-sm text-gray-400"><Loader2 className="h-4 w-4 animate-spin inline mr-2" />Loading saved reports…</Card>
      ) : reports.length === 0 ? (
        <Card className="p-8 text-center text-sm text-gray-500">
          No reports saved yet. Upload the IN4 “All Types Certificates Details” export to get started — it&apos;ll be saved for the whole team.
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

          {selected && <ReportView doc={selected} showWorking={showWorking} />}
        </>
      )}
    </div>
  )
}

// ── Excel export (exact 9-column format, F/G/H hidden) ─────────────────────
function safeSheetName(name: string): string {
  return (name.replace(/[:\\/?*[\]]/g, '-').slice(0, 31)) || 'Sheet'
}
const XL_HEADERS = ['Category', 'Contractor Name', 'WO Value', 'Total Bill Value', 'Total Paid Value', 'Deductions', 'Retention Held', 'Balance Value', 'Total Owed']

function categoriesToSheet(title: string, subtitle: string, categories: RawCategory[], grand: Totals) {
  const aoa: (string | number | null)[][] = [[title], [subtitle], [], XL_HEADERS]
  for (const cat of categories) {
    aoa.push([cat.category, null, null, null, null, null, null, null, null])
    for (const raw of cat.contractors) {
      const c = deriveContractor(raw)
      aoa.push([null, c.contractor, c.woValue, c.billValue, c.paidValue, c.deductions, c.retentionHeld, c.balanceValue, c.totalOwed])
    }
    const s = categorySubtotal(cat)
    aoa.push([`${displayCategory(cat.category)} — Subtotal`, null, s.woValue, s.billValue, s.paidValue, s.deductions, s.retentionHeld, s.balanceValue, s.totalOwed])
    aoa.push([])
  }
  aoa.push(['GRAND TOTAL', null, grand.woValue, grand.billValue, grand.paidValue, grand.deductions, grand.retentionHeld, grand.balanceValue, grand.totalOwed])
  aoa.push([])
  aoa.push(['Notes:'])
  aoa.push(['• Total Owed (I) = Balance Value (H) + Retention Held (G) — the full amount still due to the contractor.'])
  aoa.push(['• Balance Value (H) = Total Bill Value (D) − Total Paid Value (E) − Deductions (F) − Retention Held (G).'])
  aoa.push(['• Columns F, G and H are hidden for a cleaner view; unhide to see the full working.'])

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const widths = [34, 42, 16, 18, 18, 14, 14, 18, 18]
  ws['!cols'] = widths.map((wch, i) => ({ wch, hidden: i === 5 || i === 6 || i === 7 }))
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 8 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: 8 } }]
  const range = XLSX.utils.decode_range(ws['!ref'] as string)
  for (let R = 3; R <= range.e.r; R++) {
    for (let Col = 2; Col <= 8; Col++) {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: Col })]
      if (cell && typeof cell.v === 'number') cell.z = '#,##0;(#,##0);-'
    }
  }
  return ws
}

// In sub-project mode: one sheet per sub-project. In combined mode: a single
// "— All" sheet with sub-projects merged.
function exportReport(doc: ReportDoc, groupBySub: boolean) {
  const wb = XLSX.utils.book_new()
  if (groupBySub) {
    for (const sp of doc.subprojects) {
      const ws = categoriesToSheet(`${doc.projectName} — ${sp.name}`, `${sp.name} — Category-wise & Contractor-wise Summary (INR)`, sp.categories, subprojectTotal(sp))
      XLSX.utils.book_append_sheet(wb, ws, safeSheetName(sp.name))
    }
  } else {
    const ws = categoriesToSheet(doc.title, 'Category-wise & Contractor-wise Summary (All Sub-projects, INR)', combineSubprojects(doc.subprojects), reportGrandTotal(doc.subprojects))
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

function ReportView({ doc, showWorking }: { doc: ReportDoc; showWorking: boolean }) {
  const gt = reportGrandTotal(doc.subprojects)
  const cols = showWorking
    ? ['WO Value', 'Total Bill', 'Total Paid', 'Deductions', 'Retention', 'Balance', 'Total Owed']
    : ['WO Value', 'Total Bill', 'Total Paid', 'Total Owed']

  // By sub-project (default) vs Combined (sub-projects merged into one list).
  const [groupBySub, setGroupBySub] = useState(true)
  const sections: SubprojectGroup[] = groupBySub
    ? doc.subprojects
    : [{ name: 'All sub-projects (combined)', categories: combineSubprojects(doc.subprojects) }]

  // A report uploaded before the sub-project feature (or from a pre-combined
  // file) has no sub-project breakdown — flag it so the toggle isn't confusing.
  const noSubprojectBreakdown = doc.subprojects.length <= 1 &&
    (doc.subprojects[0]?.name === 'All sub-projects' || doc.subprojects[0]?.name === '(Unknown Sub-project)')

  // Collapse/expand per category, keyed "sectionIdx:catIdx".
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
          {/* By sub-project / Combined */}
          <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden text-xs">
            <button onClick={() => setGroupBySub(true)} className={cn('px-2.5 py-1.5 font-medium', groupBySub ? 'bg-[#1F4E78] text-white' : 'bg-white text-gray-600 hover:bg-gray-50')}>By sub-project</button>
            <button onClick={() => setGroupBySub(false)} className={cn('px-2.5 py-1.5 font-medium', !groupBySub ? 'bg-[#1F4E78] text-white' : 'bg-white text-gray-600 hover:bg-gray-50')}>Combined</button>
          </div>
          <Button size="sm" variant="outline" onClick={() => { if (allCollapsed) expandAll(); else collapseAll() }} title="Expand or collapse all categories">
            {allCollapsed ? <ChevronsUpDown className="h-4 w-4" /> : <ChevronsDownUp className="h-4 w-4" />}
            {allCollapsed ? 'Expand all' : 'Collapse all'}
          </Button>
          <Button size="sm" onClick={() => exportReport(doc, groupBySub)} className="bg-[#1F4E78] hover:bg-[#163a5c]">
            <Download className="h-4 w-4" /> Export Excel
          </Button>
        </div>
      </div>

      <ReconciliationPanel doc={doc} />

      {/* One card per sub-project so it's always obvious which sub-project a
          row belongs to. (Combined mode shows a single merged card.) */}
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
        {sections.map((sp, si) => (
          <SubprojectCard
            key={si}
            sp={sp}
            cols={cols}
            showWorking={showWorking}
            isCollapsed={(ci: number) => collapsed.has(`${si}:${ci}`)}
            onToggle={(ci: number) => toggle(`${si}:${ci}`)}
          />
        ))}
        <GrandTotalBar totals={gt} />
      </div>
    </Card>
  )
}

// A self-contained sub-project section: a dark header naming the sub-project +
// its totals, then its own column headers + collapsible categories.
function SubprojectCard({ sp, cols, showWorking, isCollapsed, onToggle }: {
  sp: SubprojectGroup; cols: string[]; showWorking: boolean
  isCollapsed: (ci: number) => boolean; onToggle: (ci: number) => void
}) {
  const t = subprojectTotal(sp)
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
        <span className="text-[11px] text-blue-100 tabular-nums">
          Bill {formatNumber(t.billValue, 0)} · Paid {formatNumber(t.paidValue, 0)} · Owed {formatNumber(t.totalOwed, 0)}
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
              <CategoryBlock key={ci} cat={cat} showWorking={showWorking} collapsed={isCollapsed(ci)} onToggle={() => onToggle(ci)} />
            ))}
            <TotalsRow label={`${sp.name} — total`} totals={t} showWorking={showWorking} />
          </tbody>
        </table>
      </div>
    </div>
  )
}

function GrandTotalBar({ totals }: { totals: Totals }) {
  return (
    <div className="rounded-xl bg-[#FFE699] border border-amber-300 px-4 py-3 flex flex-wrap items-center justify-between gap-2 font-bold text-gray-900">
      <span>GRAND TOTAL — all sub-projects</span>
      <span className="text-sm tabular-nums">
        WO {formatNumber(totals.woValue, 0)} · Bill {formatNumber(totals.billValue, 0)} · Paid {formatNumber(totals.paidValue, 0)} · Owed {formatNumber(totals.totalOwed, 0)}
      </span>
    </div>
  )
}

// One category = a clickable header row carrying the category SUBTOTAL (always
// visible), with the contractor detail rows shown only when expanded.
function CategoryBlock({ cat, showWorking, collapsed, onToggle }: {
  cat: RawCategory; showWorking: boolean; collapsed: boolean; onToggle: () => void
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
          </tr>
        )
      })}
    </>
  )
}

function TotalsRow({ label, totals, showWorking, grand }: { label: string; totals: Totals; showWorking: boolean; grand?: boolean }) {
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
    </tr>
  )
}
