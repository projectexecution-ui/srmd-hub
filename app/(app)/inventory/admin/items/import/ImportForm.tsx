'use client'
// Bulk import items into inv_items from an .xlsx file.
//
// Flow:
//   1. User clicks the dashed drop area, picks a .xlsx
//   2. We parse it client-side with the existing xlsx package
//   3. Auto-detect the header row + column positions (case-insensitive,
//      accepts a few aliases per column)
//   4. Each row is classified as 'ok' / 'duplicate' / 'error' (with reason)
//   5. Preview table shows everything; commit button inserts only OK rows
//
// No new schema — straight insert into public.inv_items.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Loader2, Upload, FileSpreadsheet, X, Check, AlertTriangle, Download, RotateCcw } from 'lucide-react'

interface ParsedRow {
  row_no: number          // 1-based, for human reference
  code: string
  name: string
  unit: string
  description: string | null
  category: string | null
  image_url: string | null
  hsn_code: string | null
  status: 'ok' | 'duplicate' | 'error'
  reason: string | null
}

type ColKind = 'code' | 'name' | 'unit' | 'description' | 'category' | 'image_url' | 'hsn_code'

// Case-insensitive header aliases. Anything matching wins.
const HEADER_ALIASES: Record<ColKind, RegExp[]> = {
  code:        [/^(item[ _-]*)?code$/i, /^sku$/i, /^material[ _-]*code$/i],
  name:        [/^(item[ _-]*)?name$/i, /^description$/i, /^particular$/i],
  unit:        [/^unit$/i, /^uom$/i, /^u\.o\.m\.?$/i, /^of[ _-]*meas/i],
  description: [/^description$/i, /^remarks?$/i, /^notes?$/i],
  category:    [/^category$/i, /^group$/i, /^class$/i],
  image_url:   [/^image[ _-]*url$/i, /^photo[ _-]*url$/i, /^picture[ _-]*url$/i],
  hsn_code:    [/^hsn$/i, /^hsn[ _-]*code$/i],
}

function detectColumns(headerRow: unknown[]): Record<ColKind, number> {
  const out: Record<ColKind, number> = {
    code: -1, name: -1, unit: -1, description: -1, category: -1, image_url: -1, hsn_code: -1,
  }
  headerRow.forEach((h, i) => {
    const s = String(h ?? '').trim()
    if (!s) return
    for (const kind of Object.keys(HEADER_ALIASES) as ColKind[]) {
      if (out[kind] !== -1) continue
      if (HEADER_ALIASES[kind].some(rx => rx.test(s))) {
        // Don't let an ambiguous "description" column win as `name` when
        // `name` is still unassigned — only let it grab `description`.
        out[kind] = i
        break
      }
    }
  })
  // Heuristic: if `name` wasn't found but `description` matched something
  // looking like the name column (e.g. "Item description"), copy it over so
  // the import still works on sheets that use Description as the name.
  if (out.name === -1 && out.description !== -1) {
    out.name = out.description
  }
  return out
}

function cellStr(v: unknown): string {
  if (v == null) return ''
  return String(v).trim()
}

async function parseExcel(file: File, existingCodes: Set<string>): Promise<ParsedRow[]> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const sheetName = wb.SheetNames.find(n => {
    const s = wb.Sheets[n]
    return s && s['!ref']
  }) ?? wb.SheetNames[0]
  if (!sheetName) return []
  const sheet = wb.Sheets[sheetName]
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null })

  // Find the header row — the first row with code + name + unit detected.
  let headerIdx = -1
  let cols: Record<ColKind, number> = {
    code: -1, name: -1, unit: -1, description: -1, category: -1, image_url: -1, hsn_code: -1,
  }
  for (let i = 0; i < Math.min(aoa.length, 25); i++) {
    const detected = detectColumns(aoa[i])
    if (detected.code !== -1 && detected.name !== -1 && detected.unit !== -1) {
      headerIdx = i; cols = detected; break
    }
  }
  if (headerIdx < 0) {
    return [{
      row_no: 0, code: '', name: '', unit: '', description: null, category: null,
      image_url: null, hsn_code: null,
      status: 'error',
      reason: 'Could not find a header row with at least Code / Name / Unit. Use the template.',
    }]
  }

  const rows: ParsedRow[] = []
  // Track codes seen IN THE FILE so two rows with the same code don't both
  // import — the second gets flagged as duplicate against the first.
  const seenInFile = new Set<string>()

  for (let i = headerIdx + 1; i < aoa.length; i++) {
    const r = aoa[i]
    if (!r || r.every(c => c == null || c === '')) continue

    const code = cellStr(cols.code !== -1 ? r[cols.code] : null)
    const name = cellStr(cols.name !== -1 ? r[cols.name] : null)
    const unit = cellStr(cols.unit !== -1 ? r[cols.unit] : null)
    const description = cols.description !== -1 ? cellStr(r[cols.description]) : ''
    const category    = cols.category !== -1 ? cellStr(r[cols.category]) : ''
    const image_url   = cols.image_url !== -1 ? cellStr(r[cols.image_url]) : ''
    const hsn_code    = cols.hsn_code !== -1 ? cellStr(r[cols.hsn_code]) : ''

    let status: ParsedRow['status'] = 'ok'
    let reason: string | null = null

    if (!code) { status = 'error'; reason = 'Code is empty' }
    else if (!name) { status = 'error'; reason = 'Name is empty' }
    else if (!unit) { status = 'error'; reason = 'Unit is empty' }
    else if (existingCodes.has(code.toLowerCase())) {
      status = 'duplicate'; reason = `Code "${code}" already exists in the master`
    } else if (seenInFile.has(code.toLowerCase())) {
      status = 'duplicate'; reason = `Code "${code}" repeats earlier in this file`
    } else {
      seenInFile.add(code.toLowerCase())
    }

    rows.push({
      row_no: i + 1,  // +1 so it matches what the user sees in Excel
      code, name, unit,
      description: description || null,
      category: category || null,
      image_url: image_url || null,
      hsn_code: hsn_code || null,
      status, reason,
    })
  }
  return rows
}

function buildTemplate(): Blob {
  const headers = ['code', 'name', 'unit', 'category', 'description', 'hsn_code', 'image_url']
  const example = ['CEM-OPC53', 'OPC 53 Grade Cement', 'bags', 'Cement', '53-grade ordinary portland', '25232990', '']
  const ws = XLSX.utils.aoa_to_sheet([headers, example])
  // A few column widths so the template feels usable, not cramped
  ws['!cols'] = [
    { wch: 14 }, { wch: 36 }, { wch: 8 }, { wch: 14 }, { wch: 32 }, { wch: 12 }, { wch: 40 },
  ]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'items')
  const arr = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  return new Blob([arr], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

export function ImportForm({ existingCodes }: { existingCodes: string[] }) {
  const router = useRouter()
  const existingSet = new Set(existingCodes)
  const [file, setFile] = useState<File | null>(null)
  const [parsing, setParsing] = useState(false)
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [committing, setCommitting] = useState(false)
  const [done, setDone] = useState<{ inserted: number; skipped: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const okCount   = rows.filter(r => r.status === 'ok').length
  const dupCount  = rows.filter(r => r.status === 'duplicate').length
  const errCount  = rows.filter(r => r.status === 'error').length

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f); setError(null); setRows([]); setDone(null); setParsing(true)
    try {
      const parsed = await parseExcel(f, existingSet)
      setRows(parsed)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not parse this file')
    } finally {
      setParsing(false)
    }
  }

  function reset() {
    setFile(null); setRows([]); setDone(null); setError(null)
  }

  function downloadTemplate() {
    const blob = buildTemplate()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'inventory-items-template.xlsx'
    document.body.appendChild(a); a.click(); a.remove()
    URL.revokeObjectURL(url)
  }

  async function commit() {
    if (okCount === 0) { setError('Nothing to import — fix the errors and re-upload.'); return }
    setCommitting(true); setError(null)
    const supabase = createClient()
    const payload = rows.filter(r => r.status === 'ok').map(r => ({
      code: r.code,
      name: r.name,
      unit: r.unit,
      description: r.description,
      category: r.category,
      image_url: r.image_url,
      hsn_code: r.hsn_code,
      is_active: true,
    }))
    const { error: insErr } = await supabase.from('inv_items').insert(payload)
    setCommitting(false)
    if (insErr) { setError(insErr.message); return }
    setDone({ inserted: payload.length, skipped: dupCount + errCount })
    router.refresh()
  }

  // ─── Render ───────────────────────────────────────────────────

  if (done) {
    return (
      <div className="space-y-4">
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 flex items-start gap-3">
          <Check className="h-5 w-5 text-emerald-700 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-emerald-900">Imported {done.inserted} item{done.inserted === 1 ? '' : 's'}.</p>
            {done.skipped > 0 && (
              <p className="text-xs text-emerald-800 mt-0.5">
                {done.skipped} row{done.skipped === 1 ? '' : 's'} skipped (duplicates / errors — fix the source file if needed).
              </p>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={reset} variant="outline">
            <RotateCcw className="h-4 w-4" /> Import another file
          </Button>
          <Button asChild>
            <a href="/inventory/admin/items">Back to Item Master</a>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-sm text-rose-800">{error}</div>
      )}

      {/* Step 1 — file picker */}
      {!file ? (
        <div className="space-y-3">
          <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-gray-300 rounded-xl py-10 text-sm text-gray-500 hover:bg-gray-50 cursor-pointer">
            <Upload className="h-5 w-5" />
            <span>Click to choose an .xlsx file</span>
            <span className="text-[11px] text-gray-400">Required columns: <b>code</b>, <b>name</b>, <b>unit</b>. Optional: category, description, hsn_code, image_url.</span>
            <input type="file" accept=".xls,.xlsx" className="hidden" onChange={onFile} />
          </label>
          <div className="flex justify-center">
            <Button variant="outline" size="sm" onClick={downloadTemplate}>
              <Download className="h-4 w-4" /> Download template
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 p-3 border border-gray-200 rounded-xl">
          <FileSpreadsheet className="h-5 w-5 text-green-700" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-gray-900 truncate">{file.name}</p>
            <p className="text-xs text-gray-500">
              {parsing
                ? 'Parsing…'
                : rows.length > 0
                  ? `${rows.length} data row${rows.length === 1 ? '' : 's'} · ${okCount} OK · ${dupCount} duplicate${dupCount === 1 ? '' : 's'} · ${errCount} error${errCount === 1 ? '' : 's'}`
                  : '—'}
            </p>
          </div>
          <Button type="button" size="sm" variant="ghost" onClick={reset} title="Pick a different file">
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Step 2 — preview */}
      {rows.length > 0 && (
        <>
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <div className="max-h-[60vh] overflow-y-auto">
              <table className="min-w-full text-xs">
                <thead className="bg-gray-50 sticky top-0">
                  <tr className="text-left text-gray-500">
                    <th className="px-2 py-2 w-10">Row</th>
                    <th className="px-2 py-2 w-24">Status</th>
                    <th className="px-2 py-2 w-32">Code</th>
                    <th className="px-2 py-2">Name</th>
                    <th className="px-2 py-2 w-16">Unit</th>
                    <th className="px-2 py-2 w-28">Category</th>
                    <th className="px-2 py-2">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.row_no} className={
                      r.status === 'ok' ? 'border-t border-gray-100'
                      : r.status === 'duplicate' ? 'border-t border-gray-100 bg-amber-50/40'
                      : 'border-t border-gray-100 bg-rose-50/40'
                    }>
                      <td className="px-2 py-1.5 text-gray-400">{r.row_no || '—'}</td>
                      <td className="px-2 py-1.5">
                        {r.status === 'ok' && <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold"><Check className="h-3 w-3" /> OK</span>}
                        {r.status === 'duplicate' && <span className="inline-flex items-center gap-1 text-amber-700 font-semibold">⊘ Duplicate</span>}
                        {r.status === 'error' && <span className="inline-flex items-center gap-1 text-rose-700 font-semibold"><AlertTriangle className="h-3 w-3" /> Error</span>}
                      </td>
                      <td className="px-2 py-1.5 font-mono text-blue-700">{r.code || '—'}</td>
                      <td className="px-2 py-1.5 text-gray-800 truncate max-w-md">{r.name || '—'}</td>
                      <td className="px-2 py-1.5 text-gray-700">{r.unit || '—'}</td>
                      <td className="px-2 py-1.5 text-gray-700">{r.category || '—'}</td>
                      <td className="px-2 py-1.5 text-gray-600">{r.reason || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Button onClick={commit} disabled={committing || okCount === 0}>
              {committing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Import {okCount} item{okCount === 1 ? '' : 's'}
            </Button>
            <Button variant="ghost" onClick={reset}>
              Cancel
            </Button>
            {(dupCount + errCount) > 0 && (
              <p className="text-xs text-gray-500 ml-2">
                {dupCount + errCount} row{(dupCount + errCount) === 1 ? '' : 's'} will be skipped — fix in Excel + re-upload if needed.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
