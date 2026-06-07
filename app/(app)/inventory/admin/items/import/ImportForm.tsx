'use client'
// Bulk import items into inv_items from an .xlsx file.
//
// Flow:
//   1. Click the drop area, pick a .xlsx (template OR an Odoo
//      product.template export — both supported)
//   2. We parse client-side with xlsx
//   3. Auto-detect the header row + column positions (case-insensitive,
//      several aliases per column — see HEADER_ALIASES)
//   4. If the file has no Code / Internal Reference column (Odoo doesn't
//      populate it), we slugify Name into a stable code
//   5. Each row is classified ok / duplicate / error with a reason
//   6. Preview shows everything + a toggle "Update existing items if
//      codes match" — when ON, duplicates become updates and we upsert
//      on code instead of skipping
//
// Odoo-specific columns that aren't part of the item master (Image 128,
// Quantity On Hand, Sales Price, Currency, etc.) are detected and listed
// in an "ignored columns" banner so the user knows nothing was lost.
//
// No new schema — straight insert / upsert into public.inv_items.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import {
  Loader2, Upload, FileSpreadsheet, X, Check, AlertTriangle,
  Download, RotateCcw, Info, RefreshCw,
} from 'lucide-react'

interface ParsedRow {
  row_no: number          // 1-based, matches Excel
  code: string
  name: string
  unit: string
  description: string | null
  category: string | null
  image_url: string | null
  hsn_code: string | null
  // 'ok'        — new code, will insert
  // 'duplicate' — code exists in master (skipped in insert mode, updated in upsert mode)
  // 'error'     — bad row, will be skipped either way
  status: 'ok' | 'duplicate' | 'error'
  reason: string | null
  // True when the code wasn't in the file and we derived it from name —
  // shown in the preview so the user can see what they'll end up with.
  code_derived: boolean
}

type ColKind = 'code' | 'name' | 'unit' | 'description' | 'category' | 'image_url' | 'hsn_code'

// Case-insensitive header aliases. First match wins per kind.
// Includes Odoo product.template export headers (Internal Reference,
// Product Category) alongside our own template headers.
const HEADER_ALIASES: Record<ColKind, RegExp[]> = {
  code:        [
    /^(item[ _-]*)?code$/i,
    /^sku$/i,
    /^material[ _-]*code$/i,
    /^internal[ _-]*reference$/i,   // Odoo
    /^default[ _-]*code$/i,         // Odoo (technical name)
  ],
  name:        [/^(item[ _-]*)?name$/i, /^particular$/i],
  unit:        [/^unit$/i, /^uom$/i, /^u\.o\.m\.?$/i, /^of[ _-]*meas/i],
  description: [/^description$/i, /^remarks?$/i, /^notes?$/i],
  category:    [/^category$/i, /^product[ _-]*category$/i, /^group$/i, /^class$/i],
  image_url:   [/^image[ _-]*url$/i, /^photo[ _-]*url$/i, /^picture[ _-]*url$/i],
  hsn_code:    [/^hsn$/i, /^hsn[ _-]*code$/i],
}

// Headers we recognise as "Odoo gave you this but it isn't part of the item
// master" — listed in the ignored-columns banner so the user knows nothing
// silently went missing. Anything not matched here is just ignored quietly.
const KNOWN_IGNORED_HEADERS: { pattern: RegExp; reason: string }[] = [
  { pattern: /^image[ _-]*128$/i,                   reason: 'Image (base64) — too large to import, add per-item later' },
  { pattern: /^image[ _-]*(512|1024|256)$/i,        reason: 'Image (base64) — too large to import' },
  { pattern: /^quantity[ _-]*on[ _-]*hand$/i,       reason: 'Opening stock — use Receive Stock, not Item Master' },
  { pattern: /^sales[ _-]*price$/i,                 reason: 'Pricing isn’t part of the master' },
  { pattern: /^currency$/i,                         reason: 'Pricing isn’t part of the master' },
  { pattern: /^activity[ _-]*state$/i,              reason: 'Odoo activity field' },
  { pattern: /^favorite$/i,                         reason: 'Odoo favourite flag' },
  { pattern: /^track[ _-]*inventory$/i,             reason: 'Always on for our use' },
  { pattern: /^#?[ _-]*product[ _-]*variants$/i,    reason: 'Variants not modelled here' },
  { pattern: /^show[ _-]*on[ _-]*hand/i,            reason: 'Odoo UI flag' },
  { pattern: /^last[ _-]*updated[ _-]*on$/i,        reason: 'Tracked by the DB, not user-set' },
  { pattern: /^property[ _-]*\d+$/i,                reason: 'Odoo custom property' },
]

function detectColumns(headerRow: unknown[]): {
  cols: Record<ColKind, number>
  ignored: { label: string; reason: string }[]
} {
  const cols: Record<ColKind, number> = {
    code: -1, name: -1, unit: -1, description: -1, category: -1, image_url: -1, hsn_code: -1,
  }
  const ignored: { label: string; reason: string }[] = []
  const usedKinds = new Set<ColKind>()

  headerRow.forEach((h, i) => {
    const s = String(h ?? '').trim()
    if (!s) return
    // First check if it maps to one of our columns
    let mapped = false
    for (const kind of Object.keys(HEADER_ALIASES) as ColKind[]) {
      if (usedKinds.has(kind)) continue
      if (HEADER_ALIASES[kind].some(rx => rx.test(s))) {
        cols[kind] = i
        usedKinds.add(kind)
        mapped = true
        break
      }
    }
    if (mapped) return
    // Not one of ours — see if it's a known Odoo column we should flag
    const known = KNOWN_IGNORED_HEADERS.find(k => k.pattern.test(s))
    if (known) ignored.push({ label: s, reason: known.reason })
  })

  return { cols, ignored }
}

function cellStr(v: unknown): string {
  if (v == null) return ''
  return String(v).trim()
}

// Build a stable, human-readable code from a name. Same input → same output,
// so re-importing the same Odoo file matches the same items.
//   "6A 3PIN TOP PLUG (RU)"  → "6A-3PIN-TOP-PLUG-RU"
//   "Door Closer (DC522S)"   → "DOOR-CLOSER-DC522S"
//   "1/2M GI STEEL BOX"      → "1-2M-GI-STEEL-BOX"
function slugifyCode(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

async function parseExcel(file: File, existingCodes: Set<string>): Promise<{
  rows: ParsedRow[]
  ignored: { label: string; reason: string }[]
  codeColumnPresent: boolean
}> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const sheetName = wb.SheetNames.find(n => {
    const s = wb.Sheets[n]
    return s && s['!ref']
  }) ?? wb.SheetNames[0]
  if (!sheetName) return { rows: [], ignored: [], codeColumnPresent: false }
  const sheet = wb.Sheets[sheetName]
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null })

  // Find the header row — first row where we can resolve Name + Unit.
  // Code is optional (Odoo exports have an Internal Reference column but it's
  // mostly blank — we slug-derive from Name in that case).
  let headerIdx = -1
  let cols: Record<ColKind, number> = {
    code: -1, name: -1, unit: -1, description: -1, category: -1, image_url: -1, hsn_code: -1,
  }
  let ignored: { label: string; reason: string }[] = []
  for (let i = 0; i < Math.min(aoa.length, 25); i++) {
    const det = detectColumns(aoa[i])
    if (det.cols.name !== -1 && det.cols.unit !== -1) {
      headerIdx = i; cols = det.cols; ignored = det.ignored; break
    }
  }
  if (headerIdx < 0) {
    return {
      rows: [{
        row_no: 0, code: '', name: '', unit: '', description: null, category: null,
        image_url: null, hsn_code: null,
        status: 'error',
        reason: 'Could not find a header row with at least Name + Unit. Download the template if unsure.',
        code_derived: false,
      }],
      ignored: [],
      codeColumnPresent: false,
    }
  }

  const codeColumnPresent = cols.code !== -1
  const rows: ParsedRow[] = []
  // Codes seen IN THE FILE so two rows resolving to the same code don't both
  // import — the second is flagged as an in-file duplicate.
  const seenInFile = new Set<string>()

  for (let i = headerIdx + 1; i < aoa.length; i++) {
    const r = aoa[i]
    if (!r || r.every(c => c == null || c === '')) continue

    let codeRaw   = cellStr(cols.code !== -1 ? r[cols.code] : null)
    const name    = cellStr(cols.name !== -1 ? r[cols.name] : null)
    const unit    = cellStr(cols.unit !== -1 ? r[cols.unit] : null)
    const description = cols.description !== -1 ? cellStr(r[cols.description]) : ''
    const category    = cols.category !== -1 ? cellStr(r[cols.category]) : ''
    const image_url   = cols.image_url !== -1 ? cellStr(r[cols.image_url]) : ''
    const hsn_code    = cols.hsn_code !== -1 ? cellStr(r[cols.hsn_code]) : ''

    // If image_url cell looks like base64 (Odoo Image 128 leaks in here when
    // the user picks "image_url" as the column), drop it — we don't store
    // base64 in image_url.
    const imageClean = (image_url && image_url.length > 500) ? '' : image_url

    // Derive code from name when the file has no code value
    let code_derived = false
    if (!codeRaw && name) {
      const slug = slugifyCode(name)
      if (slug) { codeRaw = slug; code_derived = true }
    }

    let status: ParsedRow['status'] = 'ok'
    let reason: string | null = null

    if (!name) { status = 'error'; reason = 'Name is empty' }
    else if (!unit) { status = 'error'; reason = 'Unit is empty' }
    else if (!codeRaw) { status = 'error'; reason = 'Code is empty and could not be derived from name' }
    else if (existingCodes.has(codeRaw.toLowerCase())) {
      status = 'duplicate'; reason = `Code "${codeRaw}" already exists in the master`
    } else if (seenInFile.has(codeRaw.toLowerCase())) {
      status = 'duplicate'; reason = `Code "${codeRaw}" repeats earlier in this file`
    } else {
      seenInFile.add(codeRaw.toLowerCase())
    }

    rows.push({
      row_no: i + 1,
      code: codeRaw,
      name,
      unit,
      description: description || null,
      category: category || null,
      image_url: imageClean || null,
      hsn_code: hsn_code || null,
      status, reason, code_derived,
    })
  }
  return { rows, ignored, codeColumnPresent }
}

function buildTemplate(): Blob {
  const headers = ['code', 'name', 'unit', 'category', 'description', 'hsn_code', 'image_url']
  const example = ['CEM-OPC53', 'OPC 53 Grade Cement', 'bags', 'Cement', '53-grade ordinary portland', '25232990', '']
  const ws = XLSX.utils.aoa_to_sheet([headers, example])
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
  const [ignored, setIgnored] = useState<{ label: string; reason: string }[]>([])
  const [codeColumnPresent, setCodeColumnPresent] = useState(true)
  const [updateMode, setUpdateMode] = useState(false)   // upsert on code when ON
  const [committing, setCommitting] = useState(false)
  const [done, setDone] = useState<{ inserted: number; updated: number; skipped: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const okCount   = rows.filter(r => r.status === 'ok').length
  const dupCount  = rows.filter(r => r.status === 'duplicate').length
  const errCount  = rows.filter(r => r.status === 'error').length
  const derivedCount = rows.filter(r => r.code_derived && r.status !== 'error').length

  // In update mode, duplicates become updates and are committed alongside OKs.
  const willCommit = updateMode ? okCount + dupCount : okCount
  const willSkip   = updateMode ? errCount : dupCount + errCount

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f); setError(null); setRows([]); setIgnored([]); setDone(null); setParsing(true)
    try {
      const parsed = await parseExcel(f, existingSet)
      setRows(parsed.rows)
      setIgnored(parsed.ignored)
      setCodeColumnPresent(parsed.codeColumnPresent)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not parse this file')
    } finally {
      setParsing(false)
    }
  }

  function reset() {
    setFile(null); setRows([]); setIgnored([]); setDone(null); setError(null)
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
    if (willCommit === 0) { setError('Nothing to import — fix the errors and re-upload.'); return }
    setCommitting(true); setError(null)
    const supabase = createClient()

    // Rows that will end up in the database — OK + (if update mode) duplicates
    const toWrite = rows.filter(r =>
      r.status === 'ok' || (updateMode && r.status === 'duplicate')
    )
    const payload = toWrite.map(r => ({
      code: r.code,
      name: r.name,
      unit: r.unit,
      description: r.description,
      category: r.category,
      image_url: r.image_url,
      hsn_code: r.hsn_code,
      is_active: true,
    }))

    let result
    if (updateMode) {
      // ON CONFLICT (code) DO UPDATE — overwrites the columns in payload.
      // Blank cells become NULL in the DB (clearing existing values). This is
      // the right semantics when the Excel is your source of truth (Odoo
      // re-export). If you want "preserve blanks", clear the cell in Excel
      // before re-uploading isn't enough — leave it as-is.
      result = await supabase.from('inv_items').upsert(payload, { onConflict: 'code' })
    } else {
      result = await supabase.from('inv_items').insert(payload)
    }

    setCommitting(false)
    if (result.error) { setError(result.error.message); return }
    setDone({
      inserted: okCount,
      updated:  updateMode ? dupCount : 0,
      skipped:  willSkip,
    })
    router.refresh()
  }

  // ─── Render ───────────────────────────────────────────────────

  if (done) {
    return (
      <div className="space-y-4">
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 flex items-start gap-3">
          <Check className="h-5 w-5 text-emerald-700 flex-shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="text-sm font-semibold text-emerald-900">
              {done.inserted > 0 && <>Inserted {done.inserted} new item{done.inserted === 1 ? '' : 's'}.</>}
              {done.inserted > 0 && done.updated > 0 && ' '}
              {done.updated > 0 && <>Updated {done.updated} existing item{done.updated === 1 ? '' : 's'}.</>}
              {done.inserted === 0 && done.updated === 0 && 'No changes — nothing to import.'}
            </p>
            {done.skipped > 0 && (
              <p className="text-xs text-emerald-800">
                {done.skipped} row{done.skipped === 1 ? '' : 's'} skipped — fix the source file and re-upload if needed.
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
            <span className="text-[11px] text-gray-400 text-center max-w-md">
              Required: <b>Name</b> + <b>Unit</b>. Optional: Code / Internal Reference, Category / Product Category, Description, HSN, Image URL.
              <br />Code is auto-generated from Name when missing (e.g. Odoo exports).
            </span>
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
                  ? `${rows.length} data row${rows.length === 1 ? '' : 's'} · ${okCount} new · ${dupCount} existing · ${errCount} error${errCount === 1 ? '' : 's'}`
                  : '—'}
            </p>
          </div>
          <Button type="button" size="sm" variant="ghost" onClick={reset} title="Pick a different file">
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Ignored Odoo columns + derived-code notice */}
      {rows.length > 0 && (ignored.length > 0 || !codeColumnPresent || derivedCount > 0) && (
        <div className="p-3 rounded-xl bg-sky-50 border border-sky-200 text-xs text-sky-900 space-y-1.5">
          {!codeColumnPresent && (
            <div className="flex gap-2">
              <Info className="h-4 w-4 mt-0.5 flex-shrink-0 text-sky-700" />
              <p>
                No <b>Code</b> / <b>Internal Reference</b> column found. Codes were
                derived from Name (e.g. <span className="font-mono">DOOR-CLOSER-DC522S</span>) — same
                input always yields the same code, so re-uploading the file matches the same items.
              </p>
            </div>
          )}
          {codeColumnPresent && derivedCount > 0 && (
            <div className="flex gap-2">
              <Info className="h-4 w-4 mt-0.5 flex-shrink-0 text-sky-700" />
              <p>{derivedCount} row{derivedCount === 1 ? ' had' : 's had'} an empty Code — derived from Name.</p>
            </div>
          )}
          {ignored.length > 0 && (
            <div className="flex gap-2">
              <Info className="h-4 w-4 mt-0.5 flex-shrink-0 text-sky-700" />
              <div>
                <p className="font-medium mb-1">Columns detected but not imported:</p>
                <ul className="space-y-0.5">
                  {ignored.map(g => (
                    <li key={g.label}>
                      <span className="font-mono text-sky-800">{g.label}</span>
                      <span className="text-sky-700"> — {g.reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Step 2 — preview + commit */}
      {rows.length > 0 && (
        <>
          {/* Update-mode toggle */}
          {dupCount > 0 && (
            <label className="flex items-start gap-2.5 p-3 border border-gray-200 rounded-xl bg-white cursor-pointer hover:bg-gray-50">
              <input
                type="checkbox"
                checked={updateMode}
                onChange={e => setUpdateMode(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <div className="text-sm">
                <p className="font-medium text-gray-900 flex items-center gap-1.5">
                  <RefreshCw className="h-3.5 w-3.5 text-blue-600" />
                  Update existing items if codes match
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {dupCount} row{dupCount === 1 ? '' : 's'} match codes that already exist. With this on,
                  they&rsquo;ll be overwritten from this file (name, category, unit, etc.). With this off,
                  they&rsquo;ll be skipped and the existing rows stay untouched.
                  <br />
                  <span className="text-amber-700">⚠ Blank cells in your file will clear those fields in the master.</span>
                </p>
              </div>
            </label>
          )}

          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <div className="max-h-[60vh] overflow-y-auto">
              <table className="min-w-full text-xs">
                <thead className="bg-gray-50 sticky top-0">
                  <tr className="text-left text-gray-500">
                    <th className="px-2 py-2 w-10">Row</th>
                    <th className="px-2 py-2 w-24">Status</th>
                    <th className="px-2 py-2 w-40">Code</th>
                    <th className="px-2 py-2">Name</th>
                    <th className="px-2 py-2 w-16">Unit</th>
                    <th className="px-2 py-2 w-32">Category</th>
                    <th className="px-2 py-2">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => {
                    const willUpdate = updateMode && r.status === 'duplicate'
                    const tint =
                      r.status === 'error' ? 'bg-rose-50/40'
                      : willUpdate ? 'bg-blue-50/40'
                      : r.status === 'duplicate' ? 'bg-amber-50/40'
                      : ''
                    return (
                      <tr key={r.row_no} className={`border-t border-gray-100 ${tint}`}>
                        <td className="px-2 py-1.5 text-gray-400">{r.row_no || '—'}</td>
                        <td className="px-2 py-1.5">
                          {r.status === 'ok' && (
                            <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                              <Check className="h-3 w-3" /> New
                            </span>
                          )}
                          {willUpdate && (
                            <span className="inline-flex items-center gap-1 text-blue-700 font-semibold">
                              <RefreshCw className="h-3 w-3" /> Update
                            </span>
                          )}
                          {!willUpdate && r.status === 'duplicate' && (
                            <span className="inline-flex items-center gap-1 text-amber-700 font-semibold">
                              ⊘ Skip
                            </span>
                          )}
                          {r.status === 'error' && (
                            <span className="inline-flex items-center gap-1 text-rose-700 font-semibold">
                              <AlertTriangle className="h-3 w-3" /> Error
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 font-mono text-blue-700">
                          {r.code || '—'}
                          {r.code_derived && (
                            <span className="ml-1 align-middle inline-block text-[9px] text-sky-700 bg-sky-100 rounded px-1 py-px font-sans" title="Code derived from Name">auto</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-gray-800 truncate max-w-md">{r.name || '—'}</td>
                        <td className="px-2 py-1.5 text-gray-700">{r.unit || '—'}</td>
                        <td className="px-2 py-1.5 text-gray-700 truncate max-w-[10rem]">{r.category || '—'}</td>
                        <td className="px-2 py-1.5 text-gray-600">{r.reason || ''}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Button onClick={commit} disabled={committing || willCommit === 0}>
              {committing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {updateMode && dupCount > 0
                ? `Import (${okCount} new · ${dupCount} update${dupCount === 1 ? '' : 's'})`
                : `Import ${willCommit} item${willCommit === 1 ? '' : 's'}`}
            </Button>
            <Button variant="ghost" onClick={reset}>
              Cancel
            </Button>
            {willSkip > 0 && (
              <p className="text-xs text-gray-500 ml-2">
                {willSkip} row{willSkip === 1 ? '' : 's'} will be skipped
                {updateMode ? ' (errors only)' : ' (duplicates + errors)'}.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
