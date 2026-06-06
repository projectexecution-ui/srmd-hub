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
} from 'lucide-react'
import { toast } from 'sonner'
import { formatNumber } from '@/lib/utils'
import { confirm } from '@/components/ui/confirm-dialog'
import {
  parseGeneratedReport, deriveContractor, categorySubtotal, grandTotal, displayCategory,
  type ReportDoc, type RawCategory, type Totals,
} from '@/lib/contractor-report'

const STATE_URL = '/api/contractor-report/state'

async function parseFile(file: File): Promise<ReportDoc> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(new Uint8Array(buf), { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws) throw new Error('Workbook has no sheets')
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true }) as (string | number | null)[][]
  const parsed = parseGeneratedReport(rows)
  if (parsed.categories.length === 0) {
    throw new Error('No category / contractor rows found — is this a generated Contractor Report (.xlsx)?')
  }
  return {
    id: crypto.randomUUID(),
    projectName: parsed.projectName,
    title: parsed.title,
    subtitle: parsed.subtitle,
    sourceFilename: file.name,
    uploadedAt: new Date().toISOString(),
    categories: parsed.categories,
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
        const list: ReportDoc[] = j.state?.reports ?? []
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
            <p className="text-sm text-gray-700">Drag &amp; drop the generated <b>Contractor Report .xlsx</b>, or</p>
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
          No reports saved yet. Upload a generated Contractor Report to get started — it&apos;ll be saved for the whole team.
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
function exportReport(doc: ReportDoc) {
  const HEADERS = ['Category', 'Contractor Name', 'WO Value', 'Total Bill Value', 'Total Paid Value', 'Deductions', 'Retention Held', 'Balance Value', 'Total Owed']
  const aoa: (string | number | null)[][] = [
    [doc.title], [doc.subtitle], [], HEADERS,
  ]
  for (const cat of doc.categories) {
    aoa.push([cat.category, null, null, null, null, null, null, null, null])
    for (const raw of cat.contractors) {
      const c = deriveContractor(raw)
      aoa.push([null, c.contractor, c.woValue, c.billValue, c.paidValue, c.deductions, c.retentionHeld, c.balanceValue, c.totalOwed])
    }
    const s = categorySubtotal(cat)
    aoa.push([`${displayCategory(cat.category)} — Subtotal`, null, s.woValue, s.billValue, s.paidValue, s.deductions, s.retentionHeld, s.balanceValue, s.totalOwed])
    aoa.push([])
  }
  const gt = grandTotal(doc.categories)
  aoa.push(['GRAND TOTAL', null, gt.woValue, gt.billValue, gt.paidValue, gt.deductions, gt.retentionHeld, gt.balanceValue, gt.totalOwed])
  aoa.push([])
  aoa.push(['Notes:'])
  aoa.push(['• Total Owed (I) = Balance Value (H) + Retention Held (G) — the full amount still due to the contractor.'])
  aoa.push(['• Balance Value (H) = Total Bill Value (D) − Total Paid Value (E) − Deductions (F) − Retention Held (G).'])
  aoa.push(['• Columns F, G and H are hidden for a cleaner view; unhide to see the full working.'])

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const widths = [34, 42, 16, 18, 18, 14, 14, 18, 18]
  ws['!cols'] = widths.map((wch, i) => ({ wch, hidden: i === 5 || i === 6 || i === 7 })) // F,G,H hidden
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 8 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: 8 } }]
  const range = XLSX.utils.decode_range(ws['!ref'] as string)
  for (let R = 3; R <= range.e.r; R++) {
    for (let C = 2; C <= 8; C++) {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })]
      if (cell && typeof cell.v === 'number') cell.z = '#,##0.00;(#,##0.00);-'
    }
  }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, (doc.projectName.replace(/[:\\/?*[\]]/g, '-').slice(0, 28) || 'Report') + ' — All')
  XLSX.writeFile(wb, `${doc.projectName.replace(/[^\w-]+/g, '_')}_ContractorReport.xlsx`)
}

function ReportView({ doc, showWorking }: { doc: ReportDoc; showWorking: boolean }) {
  const gt = grandTotal(doc.categories)
  // Columns shown depend on the working-columns toggle.
  const cols = showWorking
    ? ['WO Value', 'Total Bill', 'Total Paid', 'Deductions', 'Retention', 'Balance', 'Total Owed']
    : ['WO Value', 'Total Bill', 'Total Paid', 'Total Owed']

  return (
    <Card className="overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">{doc.title}</p>
          <p className="text-[11px] text-gray-500 truncate">{doc.subtitle} · from {doc.sourceFilename}</p>
        </div>
        <Button size="sm" onClick={() => exportReport(doc)} className="bg-[#1F4E78] hover:bg-[#163a5c]">
          <Download className="h-4 w-4" /> Export Excel
        </Button>
      </div>

      <div className="p-4 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-[#1F4E78] text-white text-xs uppercase tracking-wide">
              <th className="px-3 py-2 text-left font-semibold">Category</th>
              <th className="px-3 py-2 text-left font-semibold">Contractor</th>
              {cols.map(c => <th key={c} className="px-3 py-2 text-right font-semibold">{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {doc.categories.map((cat, ci) => (
              <CategoryBlock key={ci} cat={cat} showWorking={showWorking} colCount={cols.length} />
            ))}
            <TotalsRow label="GRAND TOTAL" totals={gt} showWorking={showWorking} grand />
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function CategoryBlock({ cat, showWorking, colCount }: { cat: RawCategory; showWorking: boolean; colCount: number }) {
  return (
    <>
      <tr className="bg-[#D9E1F2]">
        <td className="px-3 py-1.5 font-semibold text-gray-800" colSpan={colCount + 2}>{displayCategory(cat.category)}</td>
      </tr>
      {cat.contractors.map((raw, i) => {
        const c = deriveContractor(raw)
        return (
          <tr key={i} className="border-t border-gray-100 hover:bg-gray-50">
            <td className="px-3 py-1.5" />
            <td className="px-3 py-1.5 pl-6 text-gray-700">{c.contractor}</td>
            <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">{formatNumber(c.woValue, 2)}</td>
            <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">{formatNumber(c.billValue, 2)}</td>
            <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">{formatNumber(c.paidValue, 2)}</td>
            {showWorking && <td className="px-3 py-1.5 text-right tabular-nums text-gray-500">{formatNumber(c.deductions, 2)}</td>}
            {showWorking && <td className="px-3 py-1.5 text-right tabular-nums text-gray-500">{formatNumber(c.retentionHeld, 2)}</td>}
            {showWorking && <td className="px-3 py-1.5 text-right tabular-nums text-gray-500">{formatNumber(c.balanceValue, 2)}</td>}
            <td className="px-3 py-1.5 text-right tabular-nums font-medium text-gray-900">{formatNumber(c.totalOwed, 2)}</td>
          </tr>
        )
      })}
      <TotalsRow label={`${displayCategory(cat.category)} — Subtotal`} totals={categorySubtotal(cat)} showWorking={showWorking} />
    </>
  )
}

function TotalsRow({ label, totals, showWorking, grand }: { label: string; totals: Totals; showWorking: boolean; grand?: boolean }) {
  const cls = grand ? 'bg-[#FFE699] font-bold text-gray-900 border-t-2 border-amber-300' : 'bg-[#D9E1F2]/60 font-semibold'
  return (
    <tr className={cls}>
      <td className="px-3 py-2" colSpan={2}>{label}</td>
      <td className="px-3 py-2 text-right tabular-nums">{formatNumber(totals.woValue, 2)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{formatNumber(totals.billValue, 2)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{formatNumber(totals.paidValue, 2)}</td>
      {showWorking && <td className="px-3 py-2 text-right tabular-nums">{formatNumber(totals.deductions, 2)}</td>}
      {showWorking && <td className="px-3 py-2 text-right tabular-nums">{formatNumber(totals.retentionHeld, 2)}</td>}
      {showWorking && <td className="px-3 py-2 text-right tabular-nums">{formatNumber(totals.balanceValue, 2)}</td>}
      <td className="px-3 py-2 text-right tabular-nums">{formatNumber(totals.totalOwed, 2)}</td>
    </tr>
  )
}
