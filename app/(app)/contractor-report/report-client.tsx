'use client'
// Contractor Report — upload IN4 "All Types Certificates Details" .xlsx,
// see the Category × Contractor summary on screen, export to Excel.
// Mirrors the Budget vs Actual approach: client-side SheetJS parsing, no
// server round-trip (the file never leaves the browser). All the math is
// the unit-tested pure logic in lib/contractor-report.ts.

import { useCallback, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  FileSpreadsheet, UploadCloud, Download, CheckCircle2, AlertTriangle, X, Loader2,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatNumber } from '@/lib/utils'
import {
  parseCertificatesSheet, buildReport, sanityCheck,
  type ReportSection, type SanityResult,
} from '@/lib/contractor-report'

interface FileOk { filename: string; projectName: string; sections: ReportSection[]; sanity: SanityResult }
interface FileErr { filename: string; error: string }
type Result = { ok: true; data: FileOk } | { ok: false; data: FileErr }

function safeSheetName(name: string): string {
  return name.replace(/[:\\/?*[\]]/g, '-').slice(0, 31) || 'Sheet'
}

async function processFile(file: File, combined: boolean): Promise<Result> {
  try {
    if (!/\.xlsx?$/i.test(file.name)) {
      return { ok: false, data: { filename: file.name, error: 'Not an Excel (.xlsx) file' } }
    }
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(new Uint8Array(buf), { type: 'array' })
    const first = wb.SheetNames[0]
    if (!first) return { ok: false, data: { filename: file.name, error: 'Workbook has no sheets' } }
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[first], { header: 1, defval: null, raw: true }) as (string | number | null)[][]
    const { projectName, rows: dataRows, sourceTotals } = parseCertificatesSheet(rows)
    if (dataRows.length === 0) {
      return { ok: false, data: { filename: file.name, error: 'No contractor rows found — is this an "All Types Certificates Details" export?' } }
    }
    const sections = buildReport(dataRows, combined)
    const sanity = sanityCheck(sections, sourceTotals)
    return { ok: true, data: { filename: file.name, projectName, sections, sanity } }
  } catch (e) {
    return { ok: false, data: { filename: file.name, error: e instanceof Error ? e.message : String(e) } }
  }
}

function exportToExcel(res: FileOk) {
  const wb = XLSX.utils.book_new()
  for (const section of res.sections) {
    const aoa: (string | number | null)[][] = [
      [`${res.projectName} — Project Execution Expenses`],
      [`${section.name} — Category-wise & Contractor-wise Summary (INR)`],
      [],
      ['Category', 'Contractor Name', 'WO Value', 'Total Bill Value', 'Total Paid Value', 'Total Balance Value'],
    ]
    for (const cat of section.categories) {
      aoa.push([cat.category, null, null, null, null, null])
      for (const c of cat.contractors) aoa.push([null, c.contractor, c.woValue, c.bill, c.paid, c.balance])
      aoa.push([`${cat.category} — Subtotal`, null, cat.subtotal.woValue, cat.subtotal.bill, cat.subtotal.paid, cat.subtotal.balance])
      aoa.push([])
    }
    aoa.push(['GRAND TOTAL', null, section.grandTotal.woValue, section.grandTotal.bill, section.grandTotal.paid, section.grandTotal.balance])

    const ws = XLSX.utils.aoa_to_sheet(aoa)
    ws['!cols'] = [32, 42, 18, 20, 20, 22].map(wch => ({ wch }))
    ws['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 5 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 5 } },
    ]
    // Indian-style 2-decimal number format on the four numeric columns (C–F).
    const range = XLSX.utils.decode_range(ws['!ref'] as string)
    for (let R = 3; R <= range.e.r; R++) {
      for (let C = 2; C <= 5; C++) {
        const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })]
        if (cell && typeof cell.v === 'number') cell.z = '#,##0.00'
      }
    }
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName(section.name))
  }
  const base = res.filename.replace(/\.xlsx?$/i, '')
  XLSX.writeFile(wb, `${base}_ContractorReport.xlsx`)
}

export default function ContractorReportClient() {
  const [files, setFiles] = useState<File[]>([])
  const [combined, setCombined] = useState(false)
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<Result[]>([])
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const addFiles = useCallback((list: FileList | null) => {
    if (!list) return
    const picked = Array.from(list).filter(f => /\.xlsx?$/i.test(f.name))
    if (picked.length === 0) { toast.error('Please choose .xlsx files exported from IN4'); return }
    setFiles(prev => {
      const seen = new Set(prev.map(f => f.name + f.size))
      return [...prev, ...picked.filter(f => !seen.has(f.name + f.size))]
    })
  }, [])

  async function generate() {
    if (files.length === 0) return
    setBusy(true)
    setResults([])
    // Sequential — keeps memory steady on big workbooks.
    const out: Result[] = []
    for (const f of files) out.push(await processFile(f, combined))
    setResults(out)
    setBusy(false)
    const okCount = out.filter(r => r.ok).length
    if (okCount > 0) toast.success(`Generated ${okCount} report${okCount === 1 ? '' : 's'}`)
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      <PageHeader
        title="Contractor Report"
        subtitle="Upload an IN4 “All Types Certificates Details” export → Category × Contractor summary. Everything runs in your browser."
      />

      {/* Upload zone */}
      <Card
        className={`p-6 border-2 border-dashed transition-colors ${dragOver ? 'border-[#1F4E78] bg-blue-50/50' : 'border-gray-300'}`}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files) }}
      >
        <div className="flex flex-col items-center text-center gap-2">
          <div className="h-12 w-12 rounded-2xl bg-[#1F4E78]/10 text-[#1F4E78] inline-flex items-center justify-center">
            <UploadCloud className="h-6 w-6" />
          </div>
          <p className="text-sm text-gray-700">Drag &amp; drop IN4 <b>.xlsx</b> file(s) here, or</p>
          <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
            <FileSpreadsheet className="h-4 w-4" /> Choose files
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls"
            multiple
            className="hidden"
            onChange={e => { addFiles(e.target.files); e.target.value = '' }}
          />
        </div>

        {files.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2 justify-center">
            {files.map((f, i) => (
              <span key={f.name + i} className="inline-flex items-center gap-1.5 text-xs bg-gray-100 border border-gray-200 rounded-full pl-3 pr-1.5 py-1">
                <FileSpreadsheet className="h-3 w-3 text-[#1F4E78]" />
                <span className="max-w-[14rem] truncate">{f.name}</span>
                <button onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))} className="text-gray-400 hover:text-rose-600" title="Remove">
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}
      </Card>

      {/* Options + generate */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <label className="inline-flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={combined} onChange={e => setCombined(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-[#1F4E78] focus:ring-[#1F4E78]" />
          Combined sheet (all subprojects in one)
        </label>
        <div className="sm:ml-auto">
          <Button onClick={generate} disabled={files.length === 0 || busy} className="w-full sm:w-auto bg-[#1F4E78] hover:bg-[#163a5c]">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
            Generate report{files.length > 1 ? 's' : ''}
          </Button>
        </div>
      </div>

      {/* Results */}
      {results.map((r, i) => (
        <div key={i}>
          {r.ok ? <ReportResult res={r.data} /> : (
            <Card className="p-4 border-rose-200 bg-rose-50 flex items-start gap-2 text-sm text-rose-800">
              <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <div><b>{r.data.filename}</b> — couldn&apos;t process. <span className="font-mono text-xs break-words">{r.data.error}</span></div>
            </Card>
          )}
        </div>
      ))}
    </div>
  )
}

function ReportResult({ res }: { res: FileOk }) {
  return (
    <Card className="overflow-hidden">
      {/* Header strip */}
      <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">{res.projectName}</p>
          <p className="text-[11px] text-gray-500 truncate">{res.filename}</p>
        </div>
        <div className="flex items-center gap-2">
          <SanityBadge sanity={res.sanity} />
          <Button size="sm" onClick={() => exportToExcel(res)} className="bg-[#1F4E78] hover:bg-[#163a5c]">
            <Download className="h-4 w-4" /> Export Excel
          </Button>
        </div>
      </div>

      <div className="p-4 space-y-6">
        {res.sections.map((section, si) => (
          <SectionTable key={si} section={section} />
        ))}
      </div>
    </Card>
  )
}

function SanityBadge({ sanity }: { sanity: SanityResult }) {
  if (!sanity.source) {
    return <span className="text-[11px] text-gray-500 inline-flex items-center gap-1">No source total to cross-check</span>
  }
  return sanity.match ? (
    <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1 inline-flex items-center gap-1">
      <CheckCircle2 className="h-3.5 w-3.5" /> Totals match source
    </span>
  ) : (
    <span
      className="text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1 inline-flex items-center gap-1"
      title={`Computed vs source — Bill Δ${formatNumber(sanity.diff?.bill ?? 0, 2)}, Paid Δ${formatNumber(sanity.diff?.paid ?? 0, 2)}, Balance Δ${formatNumber(sanity.diff?.balance ?? 0, 2)}`}
    >
      <AlertTriangle className="h-3.5 w-3.5" /> Totals mismatch — verify
    </span>
  )
}

function SectionTable({ section }: { section: ReportSection }) {
  return (
    <div>
      <h3 className="text-sm font-bold text-gray-800 mb-2">{section.name}</h3>
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-[#1F4E78] text-white text-xs uppercase tracking-wide">
              <th className="px-3 py-2 text-left font-semibold">Category</th>
              <th className="px-3 py-2 text-left font-semibold">Contractor</th>
              <th className="px-3 py-2 text-right font-semibold">WO Value</th>
              <th className="px-3 py-2 text-right font-semibold">Total Bill</th>
              <th className="px-3 py-2 text-right font-semibold">Total Paid</th>
              <th className="px-3 py-2 text-right font-semibold">Balance</th>
            </tr>
          </thead>
          <tbody>
            {section.categories.map((cat, ci) => (
              <CategoryBlock key={ci} cat={cat} />
            ))}
            <tr className="bg-[#FFE699] font-bold text-gray-900 border-t-2 border-amber-300">
              <td className="px-3 py-2" colSpan={2}>GRAND TOTAL</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatNumber(section.grandTotal.woValue, 2)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatNumber(section.grandTotal.bill, 2)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatNumber(section.grandTotal.paid, 2)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatNumber(section.grandTotal.balance, 2)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

function CategoryBlock({ cat }: { cat: ReportSection['categories'][number] }) {
  return (
    <>
      <tr className="bg-[#D9E1F2]">
        <td className="px-3 py-1.5 font-semibold text-gray-800" colSpan={6}>{cat.category}</td>
      </tr>
      {cat.contractors.map((c, i) => (
        <tr key={i} className="border-t border-gray-100 hover:bg-gray-50">
          <td className="px-3 py-1.5" />
          <td className="px-3 py-1.5 pl-6 text-gray-700">{c.contractor}</td>
          <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">{formatNumber(c.woValue, 2)}</td>
          <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">{formatNumber(c.bill, 2)}</td>
          <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">{formatNumber(c.paid, 2)}</td>
          <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">{formatNumber(c.balance, 2)}</td>
        </tr>
      ))}
      <tr className="bg-[#D9E1F2]/60 font-semibold">
        <td className="px-3 py-1.5 text-gray-800" colSpan={2}>{cat.category} — Subtotal</td>
        <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(cat.subtotal.woValue, 2)}</td>
        <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(cat.subtotal.bill, 2)}</td>
        <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(cat.subtotal.paid, 2)}</td>
        <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(cat.subtotal.balance, 2)}</td>
      </tr>
    </>
  )
}
