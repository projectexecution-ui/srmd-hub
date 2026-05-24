'use client'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Loader2, Upload, Send, FileSpreadsheet, X } from 'lucide-react'

interface ProjectOpt   { id: string; code: string; name: string }
interface DRow         { id: string; code: string; name: string }
interface SRow         { id: string; discipline_id: string; code: string; name: string }

interface ParsedRow {
  row_no: number
  raw_label: string | null
  description: string | null
  unit: string | null
  qty: number | null
  rate: number | null
  amount: number | null
  formula_in_amount: string | null
}

interface Props {
  projects: ProjectOpt[]
  projectDisciplines: Array<{ project_id: string; discipline: DRow }>
  projectSubSkills: Array<{ project_id: string; sub_skill: SRow }>
  defaultProjectId?: string
}

// Try to detect which column in each row carries which value. Engineers'
// Excels in the wild have wildly different shapes, so we use header
// heuristics + fall back to position.
function detectColumns(headerRow: unknown[]): Record<string, number> {
  const map: Record<string, number> = {}
  headerRow.forEach((h, i) => {
    const s = String(h ?? '').toLowerCase().trim()
    if (!s) return
    if (map.description === undefined && /(description|item|particular|work|head)/.test(s)) map.description = i
    if (map.unit === undefined        && /^unit$|^uom$/.test(s)) map.unit = i
    if (map.qty === undefined         && /(qty|quantity|nos|count)/.test(s)) map.qty = i
    if (map.rate === undefined        && /(rate|price|unit\s*rate)/.test(s)) map.rate = i
    if (map.amount === undefined      && /(amount|total|value|cost)/.test(s)) map.amount = i
  })
  return map
}

function toNum(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[,₹\s]/g, ''))
  return Number.isFinite(n) ? n : null
}

async function parseExcel(file: File): Promise<{ rows: ParsedRow[]; grandTotal: number | null }> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array', cellFormula: true })
  // Heuristic: pick the first non-empty sheet
  const sheetName = wb.SheetNames.find(n => {
    const s = wb.Sheets[n]
    return s && s['!ref']
  }) ?? wb.SheetNames[0]
  if (!sheetName) return { rows: [], grandTotal: null }
  const sheet = wb.Sheets[sheetName]
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null })

  // Find a probable header row: first row where >=3 of the standard
  // column words appear.
  let headerIdx = -1
  let colMap: Record<string, number> = {}
  for (let i = 0; i < Math.min(aoa.length, 25); i++) {
    const m = detectColumns(aoa[i])
    const hits = ['description','rate','amount','qty','unit'].filter(k => k in m).length
    if (hits >= 3) { headerIdx = i; colMap = m; break }
  }
  if (headerIdx < 0) return { rows: [], grandTotal: null }

  const rows: ParsedRow[] = []
  let grandTotal: number | null = null

  for (let i = headerIdx + 1; i < aoa.length; i++) {
    const r = aoa[i]
    if (!r || r.every(c => c == null || c === '')) continue
    const label  = r[0] != null ? String(r[0]) : null
    const desc   = colMap.description !== undefined ? (r[colMap.description] != null ? String(r[colMap.description]) : null) : label
    const unit   = colMap.unit        !== undefined ? (r[colMap.unit]        != null ? String(r[colMap.unit])        : null) : null
    const qty    = colMap.qty         !== undefined ? toNum(r[colMap.qty])     : null
    const rate   = colMap.rate        !== undefined ? toNum(r[colMap.rate])    : null
    const amount = colMap.amount      !== undefined ? toNum(r[colMap.amount])  : null

    // Detect grand-total row (description like "total" / "grand total"
    // with an amount but no qty/rate).
    const isTotalRow = !!desc && /\b(grand\s*total|total|sub[\s-]*total|sum)\b/i.test(desc) && amount != null && (qty == null || rate == null)
    if (isTotalRow) {
      if (grandTotal == null || (amount ?? 0) > grandTotal) grandTotal = amount
      continue
    }

    // Pull the original formula in the Amount cell if present
    let formulaInAmount: string | null = null
    if (colMap.amount !== undefined) {
      const cellRef = XLSX.utils.encode_cell({ r: i, c: colMap.amount })
      const cell = sheet[cellRef] as { f?: string } | undefined
      if (cell && cell.f) formulaInAmount = String(cell.f)
    }

    rows.push({
      row_no: rows.length + 1,
      raw_label: label,
      description: desc,
      unit,
      qty,
      rate,
      amount,
      formula_in_amount: formulaInAmount,
    })
  }

  // If no grand-total row found, sum amount column
  if (grandTotal == null) {
    const sum = rows.reduce((s, r) => s + (r.amount ?? 0), 0)
    grandTotal = sum > 0 ? sum : null
  }
  return { rows, grandTotal }
}

export function NewWSQuickForm({ projects, projectDisciplines, projectSubSkills, defaultProjectId }: Props) {
  const router = useRouter()
  const [projectId, setProjectId]     = useState(defaultProjectId ?? projects[0]?.id ?? '')
  const [disciplineId, setDisciplineId] = useState('')
  const [subSkillId, setSubSkillId]   = useState('')
  const [lineType, setLineType]       = useState<'work' | 'material'>('work')
  const [summaryTotal, setSummaryTotal] = useState('')
  const [summaryNotes, setSummaryNotes] = useState('')
  const [file, setFile]               = useState<File | null>(null)
  const [parsed, setParsed]           = useState<{ rows: ParsedRow[]; grandTotal: number | null } | null>(null)
  const [parsing, setParsing]         = useState(false)
  const [submitting, setSubmitting]   = useState(false)
  const [error, setError]             = useState<string | null>(null)

  const disciplines = useMemo(
    () => projectDisciplines.filter(pd => pd.project_id === projectId).map(pd => pd.discipline),
    [projectDisciplines, projectId],
  )
  const subSkills = useMemo(
    () => projectSubSkills
      .filter(ps => ps.project_id === projectId && ps.sub_skill.discipline_id === disciplineId)
      .map(ps => ps.sub_skill),
    [projectSubSkills, projectId, disciplineId],
  )

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f); setError(null); setParsing(true); setParsed(null)
    try {
      const result = await parseExcel(f)
      setParsed(result)
      if (result.grandTotal != null && !summaryTotal) setSummaryTotal(String(result.grandTotal))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not parse Excel')
    } finally {
      setParsing(false)
    }
  }

  function clearFile() {
    setFile(null); setParsed(null)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!file || !parsed) { setError('Attach an Excel and wait for parsing to finish'); return }
    if (!projectId || !disciplineId || !subSkillId) { setError('Pick project / discipline / sub-skill'); return }
    setSubmitting(true); setError(null)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setError('Not signed in'); setSubmitting(false); return }

    // 1. Upload the Excel
    const ts = Date.now()
    const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, '_')
    const path = `${projectId}/${ts}-${safeName}`
    const { error: upErr } = await supabase.storage.from('cc-sheets').upload(path, file, {
      cacheControl: '3600', upsert: false,
      contentType: file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    if (upErr) { setError(`Upload failed: ${upErr.message}`); setSubmitting(false); return }
    const sourceUrl = path  // we store the path; reads use signed URLs

    // 2. Auto-generate ws_code (timestamp; admin can rename)
    const wsCode = `WS-Q-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Math.random().toString(36).slice(2,5).toUpperCase()}`

    // 3. Insert working sheet header
    const { data: ws, error: wsErr } = await supabase.from('cc_working_sheets').insert({
      ws_code: wsCode,
      project_id: projectId,
      discipline_id: disciplineId,
      sub_skill_id: subSkillId,
      line_type: lineType,
      status: 'draft',
      engineer_id: user.id,
      total_amount: Number(summaryTotal) || null,
      entry_mode: 'excel_summary',
      source_excel_url: sourceUrl,
      source_excel_name: file.name,
      summary_total: Number(summaryTotal) || null,
      summary_notes: summaryNotes.trim() || null,
    }).select('id').single()
    if (wsErr || !ws) { setError(`Save failed: ${wsErr?.message}`); setSubmitting(false); return }

    // 4. Insert parsed rows
    if (parsed.rows.length > 0) {
      const { error: rowsErr } = await supabase.from('cc_excel_rows').insert(
        parsed.rows.map(r => ({
          working_sheet_id: ws.id,
          row_no: r.row_no,
          raw_label: r.raw_label,
          description: r.description,
          unit: r.unit,
          qty: r.qty,
          rate: r.rate,
          amount: r.amount,
          formula_in_amount: r.formula_in_amount,
        })),
      )
      if (rowsErr) { setError(`Row save failed: ${rowsErr.message}`); setSubmitting(false); return }
    }

    // 5. Fire the check route (non-blocking — UI navigates anyway)
    fetch(`/api/cost-control/working-sheets/${ws.id}/check`, { method: 'POST' }).catch(() => null)

    router.push(`/cost-control/working-sheets/${ws.id}`)
    router.refresh()
  }

  if (projects.length === 0) {
    return <p className="text-sm text-gray-600">No active Cost Control projects yet — set one up first.</p>
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      {error && <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <Label>Project *</Label>
          <select value={projectId} onChange={e => { setProjectId(e.target.value); setDisciplineId(''); setSubSkillId('') }}
            required className="mt-1 flex h-10 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm">
            {projects.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
          </select>
        </div>
        <div>
          <Label>Line type *</Label>
          <select value={lineType} onChange={e => setLineType(e.target.value as 'work' | 'material')}
            className="mt-1 flex h-10 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm">
            <option value="work">Work</option>
            <option value="material">Material</option>
          </select>
        </div>
        <div>
          <Label>Discipline *</Label>
          <select value={disciplineId} onChange={e => { setDisciplineId(e.target.value); setSubSkillId('') }}
            required disabled={disciplines.length === 0}
            className="mt-1 flex h-10 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm">
            <option value="">— Select —</option>
            {disciplines.map(d => <option key={d.id} value={d.id}>{d.code} — {d.name}</option>)}
          </select>
        </div>
        <div>
          <Label>Sub-skill *</Label>
          <select value={subSkillId} onChange={e => setSubSkillId(e.target.value)}
            required disabled={subSkills.length === 0}
            className="mt-1 flex h-10 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm">
            <option value="">— Select —</option>
            {subSkills.map(s => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
          </select>
        </div>
      </div>

      <div className="pt-2 border-t border-gray-100 space-y-3">
        <div>
          <Label>Source Excel *</Label>
          {!file ? (
            <label className="mt-1 flex flex-col items-center justify-center gap-2 border-2 border-dashed border-gray-300 rounded-xl py-8 text-sm text-gray-500 hover:bg-gray-50 cursor-pointer">
              <Upload className="h-5 w-5" />
              <span>Click to attach your quantification Excel (.xlsx / .xls)</span>
              <input type="file" accept=".xls,.xlsx" className="hidden" onChange={onFile} />
            </label>
          ) : (
            <div className="mt-1 flex items-center gap-3 p-3 border border-gray-200 rounded-xl">
              <FileSpreadsheet className="h-5 w-5 text-green-600" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-900 truncate">{file.name}</p>
                <p className="text-xs text-gray-500">
                  {parsing ? 'Parsing…' : parsed ? `${parsed.rows.length} row(s) parsed${parsed.grandTotal != null ? ` · grand total ₹${parsed.grandTotal.toLocaleString('en-IN')}` : ''}` : '—'}
                </p>
              </div>
              <Button type="button" size="sm" variant="ghost" onClick={clearFile}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>

        {parsed && parsed.rows.length > 0 && (
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500 bg-gray-50">Preview (first 8 rows)</p>
            <div className="max-h-64 overflow-y-auto">
              <table className="min-w-full text-xs">
                <thead className="bg-gray-50 text-left text-gray-500">
                  <tr>
                    <th className="px-2 py-1.5 w-8">#</th>
                    <th className="px-2 py-1.5">Description</th>
                    <th className="px-2 py-1.5">Unit</th>
                    <th className="px-2 py-1.5 text-right">Qty</th>
                    <th className="px-2 py-1.5 text-right">Rate</th>
                    <th className="px-2 py-1.5 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.rows.slice(0, 8).map(r => (
                    <tr key={r.row_no} className="border-t border-gray-100">
                      <td className="px-2 py-1.5 text-gray-400">{r.row_no}</td>
                      <td className="px-2 py-1.5 text-gray-800 truncate max-w-xs">{r.description ?? '—'}</td>
                      <td className="px-2 py-1.5 text-gray-600">{r.unit ?? ''}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{r.qty ?? ''}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{r.rate ?? ''}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{r.amount ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label>Grand total (₹)</Label>
            <Input type="number" step="any" inputMode="decimal" value={summaryTotal}
              onChange={e => setSummaryTotal(e.target.value)} placeholder="auto-filled from Excel" className="mt-1" />
          </div>
        </div>

        <div>
          <Label>Notes</Label>
          <Textarea value={summaryNotes} onChange={e => setSummaryNotes(e.target.value)} rows={2} placeholder="What's this sheet for?" className="mt-1" />
        </div>
      </div>

      <Button type="submit" disabled={submitting || parsing || !file || !parsed}>
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        Save & analyse
      </Button>
    </form>
  )
}
