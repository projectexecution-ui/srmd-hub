'use client'
import { useState, useRef, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import * as XLSX from 'xlsx'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Upload, FileSpreadsheet, AlertCircle, CheckCircle2, Loader2, X } from 'lucide-react'
import { commitImport, type ImportRow } from './actions'

interface ProjectOpt {
  id: string
  code: string
  name: string
  cc_status: string | null
}

interface ColMap {
  discipline_code: string
  sub_skill_code: string
  description: string
  uom: string
  budget_amount: string
  committed_amount: string
  paid_amount: string
  line_type: string
}

const NONE = '__none__'

export function ImportClient({ projects, defaultProjectId = '' }: { projects: ProjectOpt[]; defaultProjectId?: string }) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [filename, setFilename] = useState('')
  const [sheetNames, setSheetNames] = useState<string[]>([])
  const [activeSheet, setActiveSheet] = useState('')
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [rawData, setRawData] = useState<unknown>(null)
  const [colMap, setColMap] = useState<ColMap>({
    discipline_code: NONE,
    sub_skill_code: NONE,
    description: NONE,
    uom: NONE,
    budget_amount: NONE,
    committed_amount: NONE,
    paid_amount: NONE,
    line_type: NONE,
  })
  const [projectId, setProjectId] = useState(defaultProjectId)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{
    imported: number
    skipped: number
    errors: string[]
  } | null>(null)
  const [, startTransition] = useTransition()

  function autoMap(hdrs: string[]): ColMap {
    const find = (...needles: string[]): string => {
      for (const h of hdrs) {
        const norm = h.toLowerCase().replace(/[^a-z0-9]/g, '')
        for (const n of needles) {
          if (norm.includes(n.toLowerCase().replace(/[^a-z0-9]/g, ''))) return h
        }
      }
      return NONE
    }
    return {
      discipline_code: find('disc code', 'disciplinecode', 'discipline code', 'category code', 'cat code'),
      sub_skill_code: find('sub code', 'subskill code', 'subitem code', 'subitemcode', 'sub-skill code'),
      description: find('description', 'item', 'sub item', 'particulars', 'narration', 'name'),
      uom: find('uom', 'unit'),
      budget_amount: find('budget', 'budgeted', 'amount budget', 'budget amt', 'estimated'),
      committed_amount: find('committed', 'wo committed', 'wo value', 'wo amount', 'po amount'),
      paid_amount: find('paid', 'payment', 'paid amount'),
      line_type: find('type', 'work or material', 'work/material', 'm/w'),
    }
  }

  async function handleFile(file: File) {
    setError('')
    setResult(null)
    setFilename(file.name)
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      setRawData({ sheetNames: wb.SheetNames, file: file.name })
      setSheetNames(wb.SheetNames)
      const first = wb.SheetNames[0]
      setActiveSheet(first)
      loadSheet(wb, first)
    } catch (e) {
      setError(`Could not parse file: ${e instanceof Error ? e.message : 'unknown error'}`)
    }
  }

  function loadSheet(wb: XLSX.WorkBook, sheetName: string) {
    const sheet = wb.Sheets[sheetName]
    if (!sheet) return
    const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: true })
    if (data.length === 0) {
      setHeaders([])
      setRows([])
      return
    }
    const hdrs = Object.keys(data[0])
    setHeaders(hdrs)
    setRows(data)
    setColMap(autoMap(hdrs))
  }

  function onChangeSheet(sheetName: string) {
    setActiveSheet(sheetName)
    if (!fileInputRef.current?.files?.[0]) return
    fileInputRef.current.files[0].arrayBuffer().then(buf => {
      const wb = XLSX.read(buf, { type: 'array' })
      loadSheet(wb, sheetName)
    })
  }

  function getCell(row: Record<string, unknown>, mapKey: string): unknown {
    if (mapKey === NONE) return null
    return row[mapKey] ?? null
  }

  function toNumber(v: unknown): number | null {
    if (v === null || v === undefined || v === '') return null
    if (typeof v === 'number') return Number.isFinite(v) ? v : null
    const s = String(v).replace(/[^0-9.\-]/g, '')
    const n = Number(s)
    return Number.isFinite(n) ? n : null
  }

  function toText(v: unknown): string | null {
    if (v === null || v === undefined) return null
    return String(v).trim() || null
  }

  function mappedRows(): ImportRow[] {
    return rows
      .map(r => {
        const ltText = toText(getCell(r, colMap.line_type))?.toLowerCase() ?? ''
        const isMaterial =
          ltText.includes('material') ||
          ltText.startsWith('m') ||
          (toText(getCell(r, colMap.discipline_code)) ?? '').toLowerCase().includes('(m)')
        return {
          discipline_code: toText(getCell(r, colMap.discipline_code)),
          sub_skill_code: toText(getCell(r, colMap.sub_skill_code)),
          description: toText(getCell(r, colMap.description)),
          uom: toText(getCell(r, colMap.uom)),
          budget_amount: toNumber(getCell(r, colMap.budget_amount)),
          committed_amount: toNumber(getCell(r, colMap.committed_amount)),
          paid_amount: toNumber(getCell(r, colMap.paid_amount)),
          line_type: (isMaterial ? 'material' : 'work') as 'work' | 'material',
        }
      })
      .filter(r => r.discipline_code !== null || (r.budget_amount ?? 0) > 0)
  }

  async function handleCommit() {
    if (!projectId) {
      setError('Pick a project first')
      return
    }
    const data = mappedRows()
    if (data.length === 0) {
      setError('No rows match the column mapping — adjust the mappings above')
      return
    }
    setBusy(true)
    setError('')
    const res = await commitImport({
      filename,
      project_id: projectId,
      rows: data,
      raw_data: rawData,
    })
    setBusy(false)
    if (res?.error) {
      setError(res.error)
      return
    }
    setResult({ imported: res.imported ?? 0, skipped: res.skipped ?? 0, errors: res.errors ?? [] })
    startTransition(() => router.refresh())
  }

  function reset() {
    setFilename('')
    setSheetNames([])
    setActiveSheet('')
    setHeaders([])
    setRows([])
    setRawData(null)
    setColMap({
      discipline_code: NONE,
      sub_skill_code: NONE,
      description: NONE,
      uom: NONE,
      budget_amount: NONE,
      committed_amount: NONE,
      paid_amount: NONE,
      line_type: NONE,
    })
    setResult(null)
    setError('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const data = mappedRows()
  const mappedCount = data.length
  const totalBudget = data.reduce((a, r) => a + (r.budget_amount ?? 0), 0)

  if (result) {
    return (
      <Card className="p-6 border-green-200 bg-green-50">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="h-6 w-6 text-green-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="text-base font-semibold text-green-900">Import committed</h3>
            <p className="text-sm text-green-800 mt-1">
              <b>{result.imported}</b> budget lines imported · <b>{result.skipped}</b> skipped
            </p>
            {result.errors.length > 0 && (
              <details className="mt-3">
                <summary className="text-xs text-amber-800 cursor-pointer">
                  {result.errors.length} warning{result.errors.length === 1 ? '' : 's'}
                </summary>
                <ul className="mt-2 text-xs text-amber-800 space-y-0.5 max-h-40 overflow-y-auto">
                  {result.errors.map((e, i) => (
                    <li key={i}>• {e}</li>
                  ))}
                </ul>
              </details>
            )}
            <div className="mt-4 flex gap-2">
              <Button onClick={reset} variant="outline" size="sm">
                Import another file
              </Button>
            </div>
          </div>
        </div>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {!filename && (
        <Card className="p-0 overflow-hidden border-dashed">
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={e => {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'copy'
            }}
            onDrop={async e => {
              e.preventDefault()
              const f = e.dataTransfer.files[0]
              if (f) await handleFile(f)
            }}
            className="p-10 text-center cursor-pointer hover:bg-blue-50/50 transition-colors"
          >
            <Upload className="h-10 w-10 mx-auto text-gray-300 mb-3" />
            <p className="text-sm font-medium text-gray-900">Drop an Excel file here</p>
            <p className="text-xs text-gray-500 mt-1">or click to browse — .xlsx, .xls, .csv</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.xlsm,.csv"
              className="hidden"
              onChange={async e => {
                const f = e.target.files?.[0]
                if (f) await handleFile(f)
              }}
            />
          </div>
        </Card>
      )}

      {error && (
        <Card className="p-3 bg-red-50 border-red-200 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-red-600 shrink-0" />
          <span className="text-sm text-red-800 flex-1">{error}</span>
        </Card>
      )}

      {filename && (
        <Card className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-blue-600" />
              <div>
                <div className="text-sm font-semibold text-gray-900">{filename}</div>
                <div className="text-xs text-gray-500">
                  {rows.length} rows · {headers.length} columns
                </div>
              </div>
            </div>
            <button onClick={reset} className="p-1.5 rounded-md text-gray-400 hover:bg-red-50 hover:text-red-600">
              <X className="h-4 w-4" />
            </button>
          </div>

          {sheetNames.length > 1 && (
            <div>
              <Label className="text-xs">Sheet</Label>
              <select
                value={activeSheet}
                onChange={e => onChangeSheet(e.target.value)}
                className="mt-1 w-full h-10 rounded-md border border-gray-300 bg-white px-3 text-sm"
              >
                {sheetNames.map(s => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <Label className="text-xs">Target project *</Label>
            <select
              value={projectId}
              onChange={e => setProjectId(e.target.value)}
              className="mt-1 w-full h-10 rounded-md border border-gray-300 bg-white px-3 text-sm"
            >
              <option value="">— pick project —</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>
                  {p.code} — {p.name}
                  {p.cc_status === 'setup_incomplete' ? ' (setup incomplete)' : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-gray-900 mb-2">Column mapping</h4>
            <p className="text-xs text-gray-500 mb-3">
              We auto-detected these based on header names — adjust if needed.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {(
                [
                  ['discipline_code', 'Discipline code *'],
                  ['sub_skill_code', 'Sub-skill code'],
                  ['description', 'Description'],
                  ['uom', 'UOM'],
                  ['budget_amount', 'Budget amount *'],
                  ['committed_amount', 'Committed amount'],
                  ['paid_amount', 'Paid amount'],
                  ['line_type', 'Line type (work/material)'],
                ] as [keyof ColMap, string][]
              ).map(([key, label]) => (
                <div key={key}>
                  <Label className="text-xs">{label}</Label>
                  <select
                    value={colMap[key]}
                    onChange={e => setColMap(m => ({ ...m, [key]: e.target.value }))}
                    className="mt-1 w-full h-9 rounded-md border border-gray-300 bg-white px-2 text-sm"
                  >
                    <option value={NONE}>— not mapped —</option>
                    {headers.map(h => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>

          {mappedCount > 0 && (
            <Card className="p-3 bg-blue-50 border-blue-200">
              <div className="text-sm text-blue-900">
                <b>{mappedCount}</b> rows mapped · total budget{' '}
                <b>{totalBudget.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })}</b>
              </div>
            </Card>
          )}

          {mappedCount > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-gray-900 mb-2">Preview (first 10 rows)</h4>
              <div className="overflow-x-auto border border-gray-200 rounded-md">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="text-left px-2 py-1 font-medium">Disc</th>
                      <th className="text-left px-2 py-1 font-medium">Sub</th>
                      <th className="text-left px-2 py-1 font-medium">Description</th>
                      <th className="text-left px-2 py-1 font-medium">UOM</th>
                      <th className="text-right px-2 py-1 font-medium">Budget</th>
                      <th className="text-right px-2 py-1 font-medium">Committed</th>
                      <th className="text-right px-2 py-1 font-medium">Paid</th>
                      <th className="text-left px-2 py-1 font-medium">Type</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.slice(0, 10).map((r, i) => (
                      <tr key={i}>
                        <td className="px-2 py-1 font-mono">{r.discipline_code ?? '—'}</td>
                        <td className="px-2 py-1 font-mono">{r.sub_skill_code ?? '—'}</td>
                        <td className="px-2 py-1 truncate max-w-[200px]">{r.description ?? '—'}</td>
                        <td className="px-2 py-1">{r.uom ?? '—'}</td>
                        <td className="px-2 py-1 text-right tabular-nums">
                          {r.budget_amount?.toLocaleString('en-IN') ?? '—'}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">
                          {r.committed_amount?.toLocaleString('en-IN') ?? '—'}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">
                          {r.paid_amount?.toLocaleString('en-IN') ?? '—'}
                        </td>
                        <td className="px-2 py-1">{r.line_type}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {mappedCount > 10 && (
                <p className="text-xs text-gray-500 mt-1">… {mappedCount - 10} more rows</p>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
            <Button onClick={reset} variant="outline" disabled={busy}>
              Cancel
            </Button>
            <Button
              onClick={handleCommit}
              disabled={busy || !projectId || mappedCount === 0 || colMap.discipline_code === NONE || colMap.budget_amount === NONE}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              Commit {mappedCount} row{mappedCount === 1 ? '' : 's'}
            </Button>
          </div>
        </Card>
      )}
    </div>
  )
}
