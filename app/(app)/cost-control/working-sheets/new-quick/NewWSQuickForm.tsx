'use client'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase/client'
import { generateSmartWSCode } from '@/components/cost-control/ws-code-action'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MoneyInput } from '@/components/ui/money-input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Loader2, Upload, Send, FileSpreadsheet, X, Sparkles, AlertTriangle } from 'lucide-react'

interface ProjectOpt   { id: string; code: string; name: string }
interface DRow         { id: string; code: string; name: string }
interface SRow         { id: string; discipline_id: string; code: string; name: string }

interface Breakdown { label: string; value: number }

interface AiRowMeta {
  suggested_sub_skill_id: string | null
  confidence: number | null
  cleaned_description: string | null
  rate_concern: string | null
  /** Bifurcation tag. material_and_labour rows carry both material_value
   *  and labour_value such that they sum to amount. */
  category: 'material' | 'labour' | 'material_and_labour' | 'equipment' | null
  material_value: number | null
  labour_value: number | null
  anomaly: string | null
  model: string
}

interface ParsedRow {
  row_no: number
  raw_label: string | null
  description: string | null
  unit: string | null
  qty: number | null
  rate: number | null
  amount: number | null
  formula_in_amount: string | null
  rate_breakdown: Breakdown[] | null
  amount_breakdown: Breakdown[] | null
  ai_meta?: AiRowMeta | null
}

interface AiSummary {
  text: string | null
  model: string
  rows_in: number
  rows_out: number
  suggestions_count: number
  rate_concerns_count: number
  totals_by_category?: Partial<Record<'material' | 'labour' | 'material_and_labour' | 'equipment', number>>
  split_totals?: Partial<Record<'material' | 'labour' | 'equipment', number>>
  run_at: string
}

interface Props {
  projects: ProjectOpt[]
  projectDisciplines: Array<{ project_id: string; discipline: DRow }>
  projectSubSkills: Array<{ project_id: string; sub_skill: SRow }>
  defaultProjectId?: string
  canSetDeadline?: boolean
}

type ColKind = 'description' | 'unit' | 'qty' | 'rate' | 'amount'
interface DetectedCol {
  i: number
  kind: ColKind
  isTotal: boolean   // header says "total" / "grand" / "sum" / "combined"
  label: string      // original header text — used for breakdown labels
}

// Engineers' BoQ shapes in the wild vary a lot. Header detection captures
// EVERY rate-like and amount-like column so split layouts like
// "Supply Rate / Erection Rate / Total Rate" parse correctly.
function detectColumns(headerRow: unknown[]): DetectedCol[] {
  const out: DetectedCol[] = []
  headerRow.forEach((h, i) => {
    const raw = String(h ?? '').trim()
    if (!raw) return
    const s = raw.toLowerCase()
    // Amount-like first (so "Total Cost" doesn't bind to 'rate' just because
    // it has 'cost per' nearby — rate regex stays narrow).
    let kind: ColKind | null = null
    if (/(description|item|particular|work|head|nature|scope|sr\.?\s*description)/.test(s)) kind = 'description'
    else if (/^unit$|^uom$|\bof\s+meas/.test(s)) kind = 'unit'
    else if (/^qty\b|^quantity\b|\bnos\b|\bcount\b/.test(s)) kind = 'qty'
    else if (/(amount|value|cost(?!\s*per)|amt|line\s*total)/.test(s)) kind = 'amount'
    else if (/(rate|price|unit\s*rate|cost\s*per|p\/u|per\s*unit)/.test(s)) kind = 'rate'
    if (!kind) return
    const isTotal = /\b(total|grand|sum|combined|all[\s-]*in|net)\b/.test(s)
    out.push({ i, kind, isTotal, label: raw })
  })
  return out
}

// Pull the breakdown label for a rate/amount column. "Supply Rate" → "Supply",
// "Erection Amount" → "Erection". Strips the words "rate / amount / total /
// grand / sum / combined" so the label is the scope only.
function breakdownLabel(raw: string): string {
  return raw
    .replace(/\b(rate|amount|value|cost|amt|total|grand|sum|combined|all[\s-]*in|net|per\s*unit|p\/u)\b/gi, '')
    .replace(/[()\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || raw.trim()
}

function toNum(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[,₹\s]/g, ''))
  return Number.isFinite(n) ? n : null
}

async function parseExcel(file: File): Promise<{ rows: ParsedRow[]; grandTotal: number | null; aoa: unknown[][] }> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array', cellFormula: true })
  // Heuristic: pick the first non-empty sheet
  const sheetName = wb.SheetNames.find(n => {
    const s = wb.Sheets[n]
    return s && s['!ref']
  }) ?? wb.SheetNames[0]
  if (!sheetName) return { rows: [], grandTotal: null, aoa: [] }
  const sheet = wb.Sheets[sheetName]
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null })

  // Find a probable header row: first row whose detected columns include
  // at least description + one of (rate, amount) + (qty or unit).
  let headerIdx = -1
  let cols: DetectedCol[] = []
  for (let i = 0; i < Math.min(aoa.length, 25); i++) {
    const detected = detectColumns(aoa[i])
    const kinds = new Set(detected.map(c => c.kind))
    const hasMoney = kinds.has('rate') || kinds.has('amount')
    const hasShape = kinds.has('qty') || kinds.has('unit')
    if (kinds.has('description') && hasMoney && hasShape) {
      headerIdx = i; cols = detected; break
    }
  }
  if (headerIdx < 0) return { rows: [], grandTotal: null, aoa }

  const descCol  = cols.find(c => c.kind === 'description')
  const unitCol  = cols.find(c => c.kind === 'unit')
  const qtyCol   = cols.find(c => c.kind === 'qty')
  const rateCols   = cols.filter(c => c.kind === 'rate')
  const amountCols = cols.filter(c => c.kind === 'amount')

  // If multiple rate/amount columns exist, prefer the one tagged "total"
  // as the combined value, and treat the rest as the breakdown.
  function pickTotalAndParts(group: DetectedCol[]): { total: DetectedCol | null; parts: DetectedCol[] } {
    if (group.length === 0) return { total: null, parts: [] }
    if (group.length === 1) return { total: group[0], parts: [] }
    const total = group.find(c => c.isTotal) ?? null
    const parts = total ? group.filter(c => c.i !== total.i) : group
    return { total, parts }
  }
  const ratePick   = pickTotalAndParts(rateCols)
  const amountPick = pickTotalAndParts(amountCols)

  const rows: ParsedRow[] = []
  let grandTotal: number | null = null

  for (let i = headerIdx + 1; i < aoa.length; i++) {
    const r = aoa[i]
    if (!r || r.every(c => c == null || c === '')) continue
    const label  = r[0] != null ? String(r[0]) : null
    const desc   = descCol ? (r[descCol.i] != null ? String(r[descCol.i]) : null) : label
    const unit   = unitCol ? (r[unitCol.i] != null ? String(r[unitCol.i]) : null) : null
    const qty    = qtyCol  ? toNum(r[qtyCol.i]) : null

    // --- Rate (combined + breakdown) ---
    let rate: number | null = null
    const rateBreakdown: Breakdown[] = []
    if (ratePick.total) {
      const v = toNum(r[ratePick.total.i])
      if (v != null) rate = v
    }
    for (const c of ratePick.parts) {
      const v = toNum(r[c.i])
      if (v != null) rateBreakdown.push({ label: breakdownLabel(c.label) || 'part', value: v })
    }
    if (rate == null && rateBreakdown.length > 0) {
      rate = rateBreakdown.reduce((s, b) => s + b.value, 0)
    }

    // --- Amount (combined + breakdown) ---
    let amount: number | null = null
    const amountBreakdown: Breakdown[] = []
    if (amountPick.total) {
      const v = toNum(r[amountPick.total.i])
      if (v != null) amount = v
    }
    for (const c of amountPick.parts) {
      const v = toNum(r[c.i])
      if (v != null) amountBreakdown.push({ label: breakdownLabel(c.label) || 'part', value: v })
    }
    if (amount == null && amountBreakdown.length > 0) {
      amount = amountBreakdown.reduce((s, b) => s + b.value, 0)
    }

    // Detect grand-total row (description like "total" / "grand total"
    // with an amount but no qty/rate).
    const isTotalRow = !!desc && /\b(grand\s*total|total|sub[\s-]*total|sum)\b/i.test(desc) && amount != null && (qty == null || rate == null)
    if (isTotalRow) {
      if (grandTotal == null || (amount ?? 0) > grandTotal) grandTotal = amount
      continue
    }

    // Pull the original formula in the amount cell (prefer the total col)
    let formulaInAmount: string | null = null
    const formulaCol = amountPick.total ?? amountPick.parts[0]
    if (formulaCol) {
      const cellRef = XLSX.utils.encode_cell({ r: i, c: formulaCol.i })
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
      rate_breakdown:   rateBreakdown.length   ? rateBreakdown   : null,
      amount_breakdown: amountBreakdown.length ? amountBreakdown : null,
    })
  }

  // If no grand-total row found, sum amount column
  if (grandTotal == null) {
    const sum = rows.reduce((s, r) => s + (r.amount ?? 0), 0)
    grandTotal = sum > 0 ? sum : null
  }
  return { rows, grandTotal, aoa }
}

export function NewWSQuickForm({ projects, projectDisciplines, projectSubSkills, defaultProjectId, canSetDeadline = false }: Props) {
  const router = useRouter()
  const [projectId, setProjectId]     = useState(defaultProjectId ?? projects[0]?.id ?? '')
  const [disciplineId, setDisciplineId] = useState('')
  const [subSkillId, setSubSkillId]   = useState('')
  const [lineType, setLineType]       = useState<'work' | 'material'>('work')
  const [summaryTotal, setSummaryTotal] = useState('')
  const [summaryNotes, setSummaryNotes] = useState('')
  const [deadline, setDeadline] = useState('')
  const [deadlineNotes, setDeadlineNotes] = useState('')
  const [file, setFile]               = useState<File | null>(null)
  const [parsed, setParsed]           = useState<{ rows: ParsedRow[]; grandTotal: number | null; aoa: unknown[][] } | null>(null)
  const [aiSummary, setAiSummary]     = useState<AiSummary | null>(null)
  const [aiMode, setAiMode]           = useState<'ai' | 'fallback' | null>(null)
  const [parsing, setParsing]         = useState(false)
  const [aiParsing, setAiParsing]     = useState(false)
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
    setFile(f); setError(null); setParsing(true); setParsed(null); setAiSummary(null); setAiMode(null)
    try {
      const local = await parseExcel(f)
      setParsed(local)
      if (local.grandTotal != null && !summaryTotal) setSummaryTotal(String(local.grandTotal))

      // Only auto-fire the AI parse when the local regex result looks
      // suspicious. We're on a free Gemini quota (1,500/day shared with
      // every other AI feature) so blowing it on uploads that the regex
      // already parsed perfectly is wasteful. Heuristics:
      //
      //   1. Zero / very few rows extracted (parser missed columns)
      //   2. Sum of row amounts is materially off the stated grand total
      //      (likely heading rows being counted, or wrong column picked)
      //   3. > 30% of rows have NULL rate AND NULL amount (parser confused)
      //
      // The user can ALWAYS click "Re-parse with AI" on the WS detail
      // page later — this gate only skips the silent auto-fire.
      const needsAi = (() => {
        if (!projectId || !disciplineId || !subSkillId) return false
        if (local.rows.length === 0) return true
        if (local.rows.length < 3) return true
        const sumRows = local.rows.reduce((s, r) => s + (r.amount ?? 0), 0)
        if (local.grandTotal && Math.abs(sumRows - local.grandTotal) / local.grandTotal > 0.05) return true
        const blanks = local.rows.filter(r => r.rate == null && r.amount == null).length
        if (blanks / local.rows.length > 0.3) return true
        return false
      })()

      if (needsAi) {
        runAiParse(local).catch(() => null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not parse Excel')
    } finally {
      setParsing(false)
    }
  }

  async function runAiParse(local: { rows: ParsedRow[]; grandTotal: number | null; aoa: unknown[][] }) {
    setAiParsing(true)
    try {
      // Cap the AoA payload to keep request bodies sane on huge sheets.
      const aoaSlim = local.aoa.slice(0, 80)
      const res = await fetch('/api/cost-control/working-sheets/ai-parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          aoa: aoaSlim,
          project_id: projectId,
          discipline_id: disciplineId,
          sub_skill_id: subSkillId,
          line_type: lineType,
          local_rows: local.rows,
          local_grand_total: local.grandTotal,
        }),
      })
      if (!res.ok) return
      const json = await res.json()
      if (!json.ok) return
      setAiMode(json.mode)
      if (json.mode === 'ai' && Array.isArray(json.rows)) {
        // Swap in AI rows + summary. Preserve the original aoa so future
        // re-runs (e.g. if the user changes sub-skill) work.
        setParsed({ rows: json.rows as ParsedRow[], grandTotal: json.grand_total ?? local.grandTotal, aoa: local.aoa })
        setAiSummary(json.ai_summary ?? null)
        if (json.grand_total != null && (!summaryTotal || Number(summaryTotal) === local.grandTotal)) {
          setSummaryTotal(String(json.grand_total))
        }
      }
    } finally {
      setAiParsing(false)
    }
  }

  function clearFile() {
    setFile(null); setParsed(null); setAiSummary(null); setAiMode(null)
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

    // 2. Smart ws_code — e.g. P2A02-1102-Q01 (project, sub-skill, Quick mode, seq).
    // Computed server-side so the seq is consistent with concurrent inserts.
    const wsCode = await generateSmartWSCode({
      project_id: projectId,
      sub_skill_id: subSkillId,
      entry_mode: 'excel_summary',
    })

    // 3. Insert working sheet header — include AI parse meta when the AI
    // path ran so the WS detail page can show the bifurcation summary.
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
      deadline_date:  deadline || null,
      deadline_notes: deadlineNotes.trim() || null,
      ai_parse_meta: aiMode === 'ai' && aiSummary ? aiSummary : null,
    }).select('id').single()
    if (wsErr || !ws) { setError(`Save failed: ${wsErr?.message}`); setSubmitting(false); return }

    // 4. Insert parsed rows — including the AI metadata when present.
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
          rate_breakdown:   r.rate_breakdown,
          amount_breakdown: r.amount_breakdown,
          ai_meta: r.ai_meta ?? null,
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

        {aiParsing && (
          <div className="inline-flex items-center gap-2 text-xs text-violet-700 bg-violet-50 border border-violet-200 rounded-lg px-3 py-1.5">
            <Sparkles className="h-3.5 w-3.5 animate-pulse" />
            AI is re-parsing this sheet — bifurcating material vs labour, mapping sub-skills, checking rates…
          </div>
        )}

        {aiSummary && (
          <AiSummaryBanner summary={aiSummary} parsedRows={parsed?.rows ?? []} />
        )}

        {parsed && parsed.rows.length > 0 && (
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500 bg-gray-50 flex items-center justify-between">
              <span>Preview (first 8 rows)</span>
              {aiMode === 'ai' && (
                <span className="inline-flex items-center gap-1 text-violet-700 text-[10px] font-bold normal-case">
                  <Sparkles className="h-3 w-3" /> AI-parsed
                </span>
              )}
            </p>
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
                    <tr key={r.row_no} className="border-t border-gray-100 align-top">
                      <td className="px-2 py-1.5 text-gray-400">{r.row_no}</td>
                      <td className="px-2 py-1.5 text-gray-800 max-w-xs">
                        <div className="truncate">{r.ai_meta?.cleaned_description ?? r.description ?? '—'}</div>
                        {r.ai_meta?.category && <CategoryChip cat={r.ai_meta.category} />}
                        {r.ai_meta?.rate_concern && (
                          <div className="text-[10px] text-amber-700 mt-0.5 inline-flex items-center gap-0.5">
                            <AlertTriangle className="h-2.5 w-2.5" /> {r.ai_meta.rate_concern}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-gray-600">{r.unit ?? ''}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{r.qty ?? ''}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {r.rate ?? ''}
                        {r.rate_breakdown && (
                          <div className="text-[10px] text-gray-400 font-normal">
                            {r.rate_breakdown.map(b => `${b.label} ${b.value}`).join(' + ')}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {r.amount ?? ''}
                        {r.amount_breakdown && (
                          <div className="text-[10px] text-gray-400 font-normal">
                            {r.amount_breakdown.map(b => `${b.label} ${b.value}`).join(' + ')}
                          </div>
                        )}
                        {r.ai_meta?.category === 'material_and_labour' && r.ai_meta.material_value != null && r.ai_meta.labour_value != null && (
                          <div className="text-[10px] text-gray-500 font-normal">
                            M ₹{r.ai_meta.material_value.toLocaleString('en-IN')} · L ₹{r.ai_meta.labour_value.toLocaleString('en-IN')}
                          </div>
                        )}
                      </td>
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
            <MoneyInput value={summaryTotal}
              onChange={setSummaryTotal} placeholder="auto-filled from Excel" className="mt-1" />
          </div>
          {canSetDeadline && (
            <div>
              <Label>Deadline</Label>
              <Input type="date" value={deadline} onChange={e => setDeadline(e.target.value)} className="mt-1" />
              <p className="text-[11px] text-gray-500 mt-1">When does this need to be approved + WO issued by?</p>
            </div>
          )}
        </div>
        {canSetDeadline ? (
          <div>
            <Label>Deadline notes</Label>
            <Input value={deadlineNotes} onChange={e => setDeadlineNotes(e.target.value)}
              placeholder="optional — e.g. site mobilisation tied to this" className="mt-1" />
          </div>
        ) : (
          <p className="text-xs text-gray-500">
            Deadlines are set by the Head once the sheet is raised.
          </p>
        )}

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

// ──────────────────────────────────────────────────────────────────────
// AI summary banner — shown after AI re-parses the sheet. Bifurcates
// material vs labour totals + lists rate concerns + flags rows where AI
// thinks the sub-skill differs from what the user selected.
// ──────────────────────────────────────────────────────────────────────
function AiSummaryBanner({ summary, parsedRows }: { summary: AiSummary; parsedRows: ParsedRow[] }) {
  // Pull totals from the rows directly so the banner stays in sync if
  // the user edits state later.
  const splitTotals = parsedRows.reduce(
    (acc, r) => {
      const m = r.ai_meta?.category
      if (m === 'material') acc.material += r.amount ?? 0
      else if (m === 'labour') acc.labour += r.amount ?? 0
      else if (m === 'material_and_labour') {
        acc.material += r.ai_meta?.material_value ?? 0
        acc.labour   += r.ai_meta?.labour_value   ?? 0
      } else if (m === 'equipment') acc.equipment += r.amount ?? 0
      return acc
    },
    { material: 0, labour: 0, equipment: 0 } as Record<string, number>,
  )
  const total = splitTotals.material + splitTotals.labour + splitTotals.equipment
  const pct = (v: number) => total > 0 ? Math.round((v / total) * 100) : 0
  const rateConcerns = parsedRows.filter(r => r.ai_meta?.rate_concern).length
  return (
    <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-violet-700" />
        <p className="text-sm font-semibold text-violet-900">AI parse complete</p>
        <span className="text-[10px] text-violet-600">{summary.model}</span>
      </div>
      {summary.text && <p className="text-xs text-violet-900/90 whitespace-pre-line">{summary.text}</p>}
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="bg-white rounded-lg border border-gray-200 px-2 py-1.5">
          <p className="text-[10px] uppercase tracking-wide text-gray-500">Material</p>
          <p className="font-semibold text-gray-900 tabular-nums">₹{splitTotals.material.toLocaleString('en-IN')}</p>
          <p className="text-[10px] text-gray-500">{pct(splitTotals.material)}%</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 px-2 py-1.5">
          <p className="text-[10px] uppercase tracking-wide text-gray-500">Labour</p>
          <p className="font-semibold text-gray-900 tabular-nums">₹{splitTotals.labour.toLocaleString('en-IN')}</p>
          <p className="text-[10px] text-gray-500">{pct(splitTotals.labour)}%</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 px-2 py-1.5">
          <p className="text-[10px] uppercase tracking-wide text-gray-500">Equipment</p>
          <p className="font-semibold text-gray-900 tabular-nums">₹{splitTotals.equipment.toLocaleString('en-IN')}</p>
          <p className="text-[10px] text-gray-500">{pct(splitTotals.equipment)}%</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-violet-900/80">
        <span>{summary.rows_out} line items</span>
        {summary.suggestions_count > 0 && (
          <span className="inline-flex items-center gap-1 text-blue-700">
            <Sparkles className="h-3 w-3" /> {summary.suggestions_count} row{summary.suggestions_count === 1 ? '' : 's'} fit a different sub-skill — visible on detail
          </span>
        )}
        {rateConcerns > 0 && (
          <span className="inline-flex items-center gap-1 text-amber-700">
            <AlertTriangle className="h-3 w-3" /> {rateConcerns} rate concern{rateConcerns === 1 ? '' : 's'}
          </span>
        )}
      </div>
    </div>
  )
}

function CategoryChip({ cat }: { cat: 'material' | 'labour' | 'material_and_labour' | 'equipment' }) {
  const map = {
    material: { label: 'Material', cls: 'bg-blue-100 text-blue-800 border-blue-200' },
    labour: { label: 'Labour', cls: 'bg-green-100 text-green-800 border-green-200' },
    material_and_labour: { label: 'M + L', cls: 'bg-violet-100 text-violet-800 border-violet-200' },
    equipment: { label: 'Equipment', cls: 'bg-amber-100 text-amber-800 border-amber-200' },
  } as const
  const c = map[cat]
  return (
    <span className={`inline-block mt-0.5 text-[9px] font-semibold tracking-wide uppercase rounded px-1 py-px border ${c.cls}`}>
      {c.label}
    </span>
  )
}
