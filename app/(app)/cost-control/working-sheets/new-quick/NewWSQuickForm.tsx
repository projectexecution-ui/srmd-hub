'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase/client'
import { generateSmartWSCode } from '@/components/cost-control/ws-code-action'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MoneyInput } from '@/components/ui/money-input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { Loader2, Upload, FileSpreadsheet, X, Sparkles, AlertTriangle, Image as ImageIcon, Download, Paperclip, FileText } from 'lucide-react'
import { formatINR } from '@/lib/utils'
import { downloadBoqTemplate } from '@/lib/cost-control/boq-template-xlsx'
import { COL as BOQ_COL } from '@/lib/cost-control/boq-template'
import { detectTemplate, parseTemplateSheet, evaluateItem } from '@/lib/cost-control/boq-template-parse'
import { parseSourceRef } from '@/lib/cost-control/formula-ref'
import { TemplateReviewGrid, type EditableGridRow, type GridSummary } from './TemplateReviewGrid'

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

/** The exact row shape inserted into cc_excel_rows — declared so the template
 *  and fuzzy branches unify to one type for supabase.insert(). */
type CcExcelRowInsert = {
  working_sheet_id: string
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
  ai_meta: AiRowMeta | null
  source_sheet: string | null
  source_cell: string | null
  qty_formula: string | null
  qty_basis: 'measured' | 'estimated' | null
  qty_note: string | null
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
  /** FULL catalogue — the dropdowns offer every (non-archived) discipline and
   *  sub-skill, not just the project's enabled set. Whatever is picked is
   *  auto-enabled for the project on submit. */
  allDisciplines: DRow[]
  allSubSkills: SRow[]
  defaultProjectId?: string
  /** Prefill discipline + sub-skill when arriving from a sub-skill row. */
  defaultDisciplineId?: string
  defaultSubSkillId?: string
  canSetDeadline?: boolean
  /** The check route is approver-only (403 for engineers) — skip the
   *  post-upload auto-check unless the uploader is a reviewer. */
  reviewer?: boolean
  /** cc_cumulative_versions flag — shows the standard-template download +
   *  (later slices) the template-mode parse. OFF = today's free-form upload. */
  cumulativeVersions?: boolean
  /** Prior version's BOQ (when raising from a sub-skill that already has
   *  sheets) — the template download is pre-filled with it as the next
   *  version, so the engineer edits deltas and the v-to-v match stays clean. */
  priorVersion?: {
    versionNo: number
    wsCode: string
    lineType: 'work' | 'material' | 'combined' | null
    rows: Array<{ description: string; unit: string | null; qty: number | null; qtyFormula: string | null; material: number | null; installation: number | null; ml: number | null }>
  } | null
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
  // 0 = none yet, 1 = plain "Total"/"Sub-total", 2 = "Grand Total".
  // A grand-total row always beats plain totals; within the same rank the
  // BOTTOM-most row wins (Indian sheets put the real total last, after
  // contingency/GST). The old "biggest total wins" picked the pre-tax
  // TOTAL row on Supply/Install sheets — the approval went out without GST.
  let grandTotalRank = 0

  for (let i = headerIdx + 1; i < aoa.length; i++) {
    const r = aoa[i]
    if (!r || r.every(c => c == null || c === '')) continue
    const label  = r[0] != null ? String(r[0]) : null
    // Fall back to column A: total rows often carry their label there
    // ("Grand Total" in A with an empty Description cell).
    const desc   = descCol ? (r[descCol.i] != null ? String(r[descCol.i]) : label) : label
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
      const rank = /grand\s*total/i.test(desc!) ? 2 : 1
      if (rank >= grandTotalRank) { grandTotalRank = rank; grandTotal = amount }
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

export function NewWSQuickForm({ projects, allDisciplines, allSubSkills, defaultProjectId, defaultDisciplineId, defaultSubSkillId, canSetDeadline = false, reviewer = false, cumulativeVersions = false, priorVersion = null }: Props) {
  const router = useRouter()
  const [projectId, setProjectId]     = useState(defaultProjectId ?? projects[0]?.id ?? '')
  const [disciplineId, setDisciplineId] = useState(defaultDisciplineId ?? '')
  const [subSkillId, setSubSkillId]   = useState(defaultSubSkillId ?? '')
  // Opened from a sub-skill row (discipline + sub-skill pre-filled)? Collapse
  // the picker to a one-line summary so the engineer lands straight on
  // Download template → Upload. "Change" reopens it.
  const cameFromRow = !!(defaultDisciplineId && defaultSubSkillId)
  const [showContext, setShowContext] = useState(!cameFromRow)
  // Combined (M+L) is the standard — Work / Material are the split exceptions.
  // Continue the prior version's Type (keeps it in the same chain); else the
  // Combined (M+L) standard.
  const [lineType, setLineType]       = useState<'work' | 'material' | 'combined'>(priorVersion?.lineType ?? 'combined')
  const [summaryTotal, setSummaryTotal] = useState('')
  const [deadline, setDeadline] = useState('')
  const [deadlineNotes, setDeadlineNotes] = useState('')
  const [file, setFile]               = useState<File | null>(null)
  // Screenshot of the Excel summary — compulsory for engineers, so anyone
  // opening the sheet can glance the working without opening the file.
  const [shot, setShot]               = useState<File | null>(null)
  const [shotPreview, setShotPreview] = useState<string | null>(null)
  const [parsed, setParsed]           = useState<{ rows: ParsedRow[]; grandTotal: number | null; aoa: unknown[][] } | null>(null)
  const [aiSummary, setAiSummary]     = useState<AiSummary | null>(null)
  const [aiMode, setAiMode]           = useState<'ai' | 'fallback' | null>(null)
  const [parsing, setParsing]         = useState(false)
  const [aiParsing, setAiParsing]     = useState(false)
  const [submitting, setSubmitting]   = useState(false)
  const [error, setError]             = useState<string | null>(null)

  // ── Standard-template mode (cc_cumulative_versions) ──────────────────────
  // When the uploaded file carries our _meta marker we parse it strictly and
  // show the verify-and-fix grid instead of the fuzzy preview.
  const [tplActive, setTplActive]     = useState(false)
  const [tplRows, setTplRows]         = useState<EditableGridRow[]>([])
  const [tplContPct, setTplContPct]   = useState<number | null>(5)
  const [tplGstPct, setTplGstPct]     = useState<number | null>(18)
  const [tplSummary, setTplSummary]   = useState<GridSummary | null>(null)
  const [notTemplate, setNotTemplate] = useState(false)
  // Working / measurement evidence behind the quantities (cc_cumulative_versions).
  // Attached here so it's all in one place; at least one is required before the
  // sheet can be sent for approval (enforced in cc_submit_working_sheet).
  const [workFiles, setWorkFiles]     = useState<File[]>([])

  // In template mode the approval amount IS the BOQ's recomputed grand total —
  // keep them locked together so the "Estimate Amount for approval" can never
  // drift from what the review grid shows (the earlier prefill used the parser's
  // ladder, which could differ from the grid's default %, showing a stale total).
  const gridGrand = tplActive ? (tplSummary?.grandTotal ?? null) : null
  useEffect(() => {
    if (gridGrand != null) setSummaryTotal(String(Math.round(gridGrand)))
  }, [gridGrand])

  // Full catalogue: every discipline, and every sub-skill under the picked
  // discipline. Not scoped to the project — the picked pair is enabled on submit.
  const disciplines = allDisciplines
  const subSkills = useMemo(
    () => allSubSkills.filter(s => s.discipline_id === disciplineId),
    [allSubSkills, disciplineId],
  )

  const selProject    = useMemo(() => projects.find(p => p.id === projectId), [projects, projectId])
  const selDiscipline = useMemo(() => disciplines.find(d => d.id === disciplineId), [disciplines, disciplineId])
  const selSubSkill   = useMemo(() => subSkills.find(s => s.id === subSkillId), [subSkills, subSkillId])

  function onDownloadTemplate() {
    downloadBoqTemplate({
      projectCode: selProject?.code,   projectName: selProject?.name,
      disciplineCode: selDiscipline?.code, disciplineName: selDiscipline?.name,
      subSkillCode: selSubSkill?.code, subSkillName: selSubSkill?.name,
      lineTypeLabel: lineType === 'work' ? 'Work' : lineType === 'material' ? 'Material' : 'Combined',
      dateText: new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
      projectId, disciplineId, subSkillId,
      // When a prior version exists, pre-fill it and stamp the next version #.
      seedRows: priorVersion?.rows,
      versionNo: priorVersion ? priorVersion.versionNo + 1 : undefined,
    })
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f); setError(null); setParsing(true); setParsed(null); setAiSummary(null); setAiMode(null)
    setTplActive(false); setTplRows([]); setTplSummary(null); setNotTemplate(false)
    try {
      // Standard-template path (flag ON): read every sheet, detect our marker,
      // and parse strictly by column. This is the trustworthy route — no fuzzy
      // guessing, precise per-row errors, everything recomputed.
      if (cumulativeVersions) {
        const buf = await f.arrayBuffer()
        const wb = XLSX.read(buf, { type: 'array', cellFormula: true })
        const sheets = wb.SheetNames.map(name => ({
          name,
          aoa: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: null }),
        }))
        const det = detectTemplate(sheets)
        if (det.isTemplate) {
          const boq = sheets.find(s => s.name === 'BOQ') ?? sheets[0]
          const res = parseTemplateSheet(boq.aoa, det.meta)
          // The raw XLSX BOQ sheet still holds each Qty cell's FORMULA
          // (=Measurement!G6). Capture it so a quantity traces back to the exact
          // take-off cell it came from.
          const boqXlsx = wb.Sheets[boq.name] as Record<string, { f?: string }> | undefined
          const grid: EditableGridRow[] = res.rows.map((r, i) => {
            let sourceSheet: string | null = null
            let sourceCell: string | null = null
            let qtyFormula: string | null = null
            if (r.kind !== 'heading' && boqXlsx) {
              const qCell = boqXlsx[XLSX.utils.encode_cell({ r: r.aoa_row_idx, c: BOQ_COL.qty })]
              if (qCell?.f) {
                // The Qty cell IS a formula → the quantity is MEASURED (inline
                // take-off like =946+104.5, or a link like =Measurement!G6).
                qtyFormula = String(qCell.f)
                const ref = parseSourceRef(qtyFormula); sourceSheet = ref.sheet; sourceCell = ref.cell
              }
            }
            // Basis: a formula → measured; a plain typed number → estimated
            // (no drawing). Headings carry no basis.
            const qtyBasis: 'measured' | 'estimated' | undefined =
              r.kind === 'heading' ? undefined : (qtyFormula ? 'measured' : 'estimated')
            return {
              key: `tpl-${i}`,
              isHeading: r.kind === 'heading',
              description: r.description ?? '',
              unit: r.unit ?? '',
              qty: r.qty, material: r.material, installation: r.installation, ml: r.ml,
              remarks: r.remarks ?? '',
              sourceSheet, sourceCell, qtyFormula, qtyBasis, qtyNote: '',
            }
          })
          setTplRows(grid)
          setTplContPct(res.ladder?.contingencyPct ?? 5)
          setTplGstPct(res.ladder?.gstPct ?? 18)
          setTplActive(true)
          if (res.ladder && !summaryTotal) setSummaryTotal(String(res.ladder.grandTotal))
          setParsing(false)
          return
        }
        // Flag on but NOT our template — REJECT it. The standard template is
        // mandatory so every BOQ is structured and its Qty is linked to a
        // Measurement cell. No fuzzy fallback, no "gone ahead with a random
        // sheet". The file stays shown with the download-the-template banner.
        setNotTemplate(true)
        setParsing(false)
        return
      }

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
      // The AI parse is a MANAGEMENT tool — never auto-run it on an
      // engineer's upload. Management can re-parse with AI from the WS
      // detail page if they choose. (Also skips the silent auto-fire.)
      const needsAi = reviewer && (() => {
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
    setTplActive(false); setTplRows([]); setTplSummary(null); setNotTemplate(false)
  }

  function onPickWorking(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? [])
    e.target.value = ''
    const tooBig = picked.find(f => f.size > 25 * 1024 * 1024)
    if (tooBig) { setError(`${tooBig.name} is over 25 MB`); return }
    setError(null)
    setWorkFiles(prev => [...prev, ...picked])
  }
  function removeWorking(idx: number) {
    setWorkFiles(prev => prev.filter((_, i) => i !== idx))
  }

  function onShot(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    if (!f.type.startsWith('image/')) { setError('The summary screenshot must be an image (PNG / JPG)'); return }
    if (f.size > 10 * 1024 * 1024) { setError('Screenshot too large — keep it under 10 MB'); return }
    setError(null)
    if (shotPreview) URL.revokeObjectURL(shotPreview)
    setShot(f)
    setShotPreview(URL.createObjectURL(f))
  }

  function clearShot() {
    if (shotPreview) URL.revokeObjectURL(shotPreview)
    setShot(null); setShotPreview(null)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!file) { setError('Attach an Excel and wait for parsing to finish'); return }
    if (!tplActive && !parsed) { setError('Attach an Excel and wait for parsing to finish'); return }
    // Template mode: block on hard row errors + reconciliation before we
    // ever create the sheet.
    if (tplActive) {
      if (tplRows.filter(r => !r.isHeading).length === 0) { setError('Add at least one item row'); return }
      if (tplSummary && tplSummary.hardErrors > 0) {
        setError(`Fix the ${tplSummary.hardErrors} highlighted row problem${tplSummary.hardErrors > 1 ? 's' : ''} before submitting`); return
      }
      if (tplSummary && !tplSummary.reconciledToClaim) {
        setError('The rows don’t add up to your approval amount. Fix the rows or correct the amount below.'); return
      }
      // Estimate reason is optional — not a submit gate.
    }
    // Under the cumulative flow the file MUST be the standard template (its
    // Working Sheet tab is the take-off) — a random Excel can't be raised.
    if (cumulativeVersions && !tplActive) {
      setError('Only the standard BOQ template can be raised. Download it, fill the BOQ + Working Sheet tabs, and re-upload.'); return
    }
    // Summary screenshot is optional — the structured review grid + BOQ table
    // already give approvers the rows and take-off at a glance.
    // No comment is collected here: the mandatory justification is captured once,
    // at "Send for approval" (WSApprovalActions), so it isn't asked for twice.
    if (!projectId || !disciplineId || !subSkillId) { setError('Pick project / discipline / sub-skill'); return }
    setSubmitting(true); setError(null)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setError('Not signed in'); setSubmitting(false); return }

    // Auto-enable the picked discipline + sub-skill for this project so the
    // sheet (and its sub-skill) show up on the project's Internal Estimate —
    // no separate setup step. Best-effort: never block the request on it.
    const { error: scopeErr } = await supabase.rpc('cc_ensure_project_scope', {
      p_project: projectId, p_discipline: disciplineId, p_sub_skill: subSkillId,
    })
    if (scopeErr) console.warn('[new-quick] auto-enable scope failed:', scopeErr.message)

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

    // 1b. Upload the summary screenshot (same bucket, image path).
    let shotPath: string | null = null
    if (shot) {
      const safeShot = shot.name.replace(/[^A-Za-z0-9._-]/g, '_')
      shotPath = `${projectId}/${ts}-summary-${safeShot}`
      const { error: shotErr } = await supabase.storage.from('cc-sheets').upload(shotPath, shot, {
        cacheControl: '3600', upsert: false,
        contentType: shot.type || 'image/png',
      })
      if (shotErr) { setError(`Screenshot upload failed: ${shotErr.message}`); setSubmitting(false); return }
    }

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
      summary_image_url: shotPath,
      summary_image_name: shot?.name ?? null,
      summary_total: Number(summaryTotal) || null,
      summary_notes: null, // justification now lives on the approval note (see doSubmit)
      deadline_date:  deadline || null,
      deadline_notes: deadlineNotes.trim() || null,
      ai_parse_meta: aiMode === 'ai' && aiSummary ? aiSummary : null,
    }).select('id').single()
    if (wsErr || !ws) { setError(`Save failed: ${wsErr?.message}`); setSubmitting(false); return }

    // 4. Insert parsed rows. Template mode builds them from the verified grid
    //    (everything recomputed); fuzzy mode uses the parsed rows as before.
    const rowsToInsert: CcExcelRowInsert[] = tplActive
      ? tplRows.map((r, i): CcExcelRowInsert => {
          if (r.isHeading) {
            return {
              working_sheet_id: ws.id, row_no: i + 1, raw_label: null,
              description: r.description || null, unit: null, qty: null, rate: null, amount: null,
              formula_in_amount: null, rate_breakdown: null, amount_breakdown: null, ai_meta: null,
              source_sheet: null, source_cell: null,
              qty_formula: null, qty_basis: null, qty_note: null,
            }
          }
          const ev = evaluateItem(r)
          const breakdown: Array<{ label: string; value: number }> = []
          if (r.material != null) breakdown.push({ label: 'Material', value: r.material })
          if (r.installation != null) breakdown.push({ label: 'Installation', value: r.installation })
          if (r.ml != null) breakdown.push({ label: 'M+L', value: r.ml })
          // Basis is derived from the Qty cell only: a formula/link is measured,
          // a plain number is an estimate. No manual toggle — never trust a
          // stray qtyBasis. The estimate reason (qty_note) is optional.
          const hasF = !!((r.qtyFormula ?? '').trim())
          const basis: 'measured' | 'estimated' = hasF ? 'measured' : 'estimated'
          return {
            working_sheet_id: ws.id, row_no: i + 1, raw_label: null,
            description: r.description || null, unit: r.unit || null, qty: r.qty,
            rate: ev.rate, amount: ev.amount, formula_in_amount: null,
            rate_breakdown: breakdown.length ? breakdown : null, amount_breakdown: null, ai_meta: null,
            source_sheet: r.sourceSheet ?? null, source_cell: r.sourceCell ?? null,
            qty_formula: r.qtyFormula ?? null, qty_basis: basis,
            // Only estimates carry a reason; a measured-typed row needs none.
            qty_note: (!hasF && basis === 'estimated') ? (r.qtyNote?.trim() || null) : null,
          } as CcExcelRowInsert
        })
      : (parsed?.rows ?? []).map((r): CcExcelRowInsert => {
          const src = cumulativeVersions ? parseSourceRef(r.formula_in_amount) : { sheet: null, cell: null }
          return {
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
            source_sheet: src.sheet,
            source_cell: src.cell,
            qty_formula: null, qty_basis: null, qty_note: null,
          }
        })
    if (rowsToInsert.length > 0) {
      const { error: rowsErr } = await supabase.from('cc_excel_rows').insert(rowsToInsert)
      if (rowsErr) { setError(`Row save failed: ${rowsErr.message}`); setSubmitting(false); return }
    }

    // 4a. Register the standard template itself as the working — its
    //     Measurement tab IS the take-off. Points at the same storage object as
    //     source_excel (no re-upload), so the sheet always has a real, linked
    //     working and the submit gate is satisfied. No random loose file.
    if (cumulativeVersions && tplActive) {
      const { error: tplAttErr } = await supabase.from('cc_ws_attachments').insert({
        working_sheet_id: ws.id, path: sourceUrl, name: file.name, kind: 'working', uploaded_by: user.id,
      })
      if (tplAttErr) { setError(`Working link failed: ${tplAttErr.message}`); setSubmitting(false); return }
    }

    // 4b. Extra supporting documents (optional). Upload each to the same bucket
    //     and register it in cc_ws_attachments so it shows in the sheet's
    //     "Working & evidence" panel.
    if (cumulativeVersions && workFiles.length > 0) {
      for (const wf of workFiles) {
        const safeWf = wf.name.replace(/[^A-Za-z0-9._-]/g, '_')
        const wfPath = `${projectId}/${ts}-working-${safeWf}`
        const { error: wfErr } = await supabase.storage.from('cc-sheets').upload(wfPath, wf, {
          cacheControl: '3600', upsert: false, contentType: wf.type || 'application/octet-stream',
        })
        if (wfErr) { setError(`Working file upload failed: ${wfErr.message}`); setSubmitting(false); return }
        const { error: attErr } = await supabase.from('cc_ws_attachments').insert({
          working_sheet_id: ws.id, path: wfPath, name: wf.name, kind: 'working', uploaded_by: user.id,
        })
        if (attErr) { setError(`Working file save failed: ${attErr.message}`); setSubmitting(false); return }
      }
    }

    // 5. Fire the check route (non-blocking — UI navigates anyway). The
    // route is approver-only, so engineers skip it: their sheet gets
    // checked when a reviewer opens it.
    if (reviewer) {
      fetch(`/api/cost-control/working-sheets/${ws.id}/check`, { method: 'POST' }).catch(() => null)
    }

    router.push(`/cost-control/working-sheets/${ws.id}`)
    router.refresh()
  }

  if (projects.length === 0) {
    return <p className="text-sm text-gray-600">No active Cost Control projects yet — set one up first.</p>
  }

  // Everything still required before the sheet can be sent. Shown under the
  // button so a disabled Save & send is never a mystery. Template mode uses
  // tplActive (parsed stays null there) — the old `!parsed` check wrongly
  // disabled the button for every standard-template upload.
  const missingToSend: string[] = []
  if (!file) missingToSend.push('attach the BOQ Excel')
  else if (parsing) missingToSend.push('wait for the file to finish parsing')
  else if (cumulativeVersions && notTemplate) missingToSend.push('upload the STANDARD template — this file isn’t it')
  else if (!tplActive && !parsed) missingToSend.push('the file could not be read — re-upload it')
  if (tplActive && tplSummary && tplSummary.hardErrors > 0) missingToSend.push(`fix ${tplSummary.hardErrors} highlighted row problem${tplSummary.hardErrors > 1 ? 's' : ''}`)
  if (tplActive && tplSummary && tplSummary.notesNeeded > 0) missingToSend.push(`give a reason for ${tplSummary.notesNeeded} estimate row${tplSummary.notesNeeded > 1 ? 's' : ''} (no drawing)`)
  if (tplActive && tplSummary && !tplSummary.reconciledToClaim) missingToSend.push('rows must add up to the approval amount')

  return (
    <form onSubmit={submit} className="space-y-5">
      {error && <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</p>}

      {!showContext && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5">
          <p className="text-sm text-gray-700 min-w-0 truncate">
            <span className="font-semibold text-gray-900">{selProject?.code}</span>
            <span className="text-gray-400"> · </span>{selDiscipline?.code} {selDiscipline?.name}
            <span className="text-gray-400"> → </span>{selSubSkill?.code} {selSubSkill?.name}
            <span className="text-gray-400"> · {lineType === 'combined' ? 'Combined (M+L)' : lineType === 'material' ? 'Material' : 'Work'}</span>
          </p>
          <Button type="button" size="sm" variant="ghost" className="flex-shrink-0" onClick={() => setShowContext(true)}>Change</Button>
        </div>
      )}

      <div className={`grid grid-cols-1 md:grid-cols-2 gap-3 ${showContext ? '' : 'hidden'}`}>
        <div>
          <Label>Project *</Label>
          <SearchableSelect
            value={projectId}
            onChange={pid => { setProjectId(pid); setDisciplineId(''); setSubSkillId('') }}
            options={projects.map(p => ({ id: p.id, label: `${p.code} — ${p.name}` }))}
            placeholder="Select a project"
            required
          />
        </div>
        <div>
          <Label>Type *</Label>
          <select value={lineType} onChange={e => setLineType(e.target.value as 'work' | 'material' | 'combined')}
            className="mt-1 flex h-10 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm">
            <option value="combined">Combined (Material + Labour)</option>
            <option value="work">Work (labour / service)</option>
            <option value="material">Material (procurement)</option>
          </select>
        </div>
        <div>
          <Label>Discipline *</Label>
          <SearchableSelect
            value={disciplineId}
            onChange={did => { setDisciplineId(did); setSubSkillId('') }}
            options={disciplines.map(d => ({ id: d.id, label: `${d.code} — ${d.name}` }))}
            disabled={disciplines.length === 0}
            placeholder="— Select —"
            required
          />
        </div>
        <div>
          <Label>Sub-skill *</Label>
          <SearchableSelect
            value={subSkillId}
            onChange={setSubSkillId}
            options={subSkills.map(s => ({ id: s.id, label: `${s.code} — ${s.name}` }))}
            disabled={subSkills.length === 0}
            placeholder={disciplineId ? '— Select —' : 'Pick a discipline first'}
            required
          />
        </div>
      </div>

      <div className="pt-2 border-t border-gray-100 space-y-3">
        {cumulativeVersions && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 flex items-start gap-3">
            <FileSpreadsheet className="h-5 w-5 text-emerald-600 mt-0.5 flex-shrink-0" />
            <div className="min-w-0 flex-1">
              {priorVersion ? (
                <>
                  <p className="text-sm font-semibold text-emerald-900">
                    Download the Version {priorVersion.versionNo + 1} template — pre-filled with {priorVersion.wsCode} (v{priorVersion.versionNo})
                  </p>
                  <p className="text-xs text-emerald-800/80 mt-0.5">
                    The last version&apos;s {priorVersion.rows.length} row{priorVersion.rows.length === 1 ? '' : 's'} are already in it. Change only what&apos;s new, add extra rows at the bottom, then upload — it continues the same chain, so the approver sees exactly what changed since v{priorVersion.versionNo}.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-semibold text-emerald-900">Use the standard BOQ template</p>
                  <p className="text-xs text-emerald-800/80 mt-0.5">
                    Download it pre-filled for this sub-skill, enter your quantities and rates (Rate &amp; Amount
                    calculate themselves), then upload it below. Standard files parse cleanly every time.
                  </p>
                </>
              )}
            </div>
            <Button type="button" size="sm" variant="outline"
              className="flex-shrink-0 border-emerald-300 text-emerald-800 hover:bg-emerald-100"
              onClick={onDownloadTemplate}>
              <Download className="h-4 w-4 mr-1.5" /> {priorVersion ? `Download v${priorVersion.versionNo + 1} template` : 'Download template'}
            </Button>
          </div>
        )}
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
                  {parsing ? 'Parsing…'
                    : tplActive ? `Standard template · ${tplRows.filter(r => !r.isHeading).length} item(s)${tplSummary ? ` · grand total ${formatINR(tplSummary.grandTotal)}` : ''}`
                    : parsed ? `${parsed.rows.length} row(s) parsed${parsed.grandTotal != null ? ` · grand total ${formatINR(parsed.grandTotal)}` : ''}` : '—'}
                </p>
              </div>
              <Button type="button" size="sm" variant="ghost" onClick={clearFile}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>

        {/* Flag on but not our template → HARD reject. A random Excel can't be
            raised — it must be the standard template (with its Measurement tab)
            so every quantity is structured and traceable. */}
        {notTemplate && (
          <div className="rounded-xl border border-rose-300 bg-rose-50 p-3 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-rose-600 mt-0.5 flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-rose-800">This isn&apos;t the standard BOQ template — it can&apos;t be used</p>
              <p className="text-xs text-rose-700 mt-0.5">
                To raise a BOQ, the file must be the standard template (it carries a hidden marker and a
                Working Sheet tab, so every quantity is structured and traceable). Download it, paste your
                figures into the <b>BOQ</b> + <b>Working Sheet</b> tabs, and re-upload. Old / free-form Excels
                aren&apos;t accepted while the cumulative flow is on.
              </p>
              <Button type="button" size="sm" variant="outline"
                className="mt-2 border-rose-300 text-rose-800 hover:bg-rose-100"
                onClick={onDownloadTemplate}>
                <Download className="h-4 w-4 mr-1.5" /> Download the standard template
              </Button>
            </div>
          </div>
        )}

        {/* Verify-and-fix grid — template mode only. */}
        {tplActive && (
          <TemplateReviewGrid
            rows={tplRows}
            onRowsChange={setTplRows}
            contingencyPct={tplContPct}
            gstPct={tplGstPct}
            onPctChange={(which, v) => (which === 'cont' ? setTplContPct(v) : setTplGstPct(v))}
            claimedTotal={summaryTotal ? Number(summaryTotal) : null}
            onSummary={setTplSummary}
          />
        )}

        {/* Extra supporting documents (OPTIONAL). The take-off/working is
            already the Working Sheet tab inside the standard template, which we
            register as the working automatically — so this is only for extras
            like drawings, rate approvals or vendor quotes. */}
        {cumulativeVersions && tplActive && (
          <div>
            <Label>Supporting documents (optional)</Label>
            <p className="text-[11px] text-gray-500 mt-0.5">
              Your take-off is already inside the template&apos;s <b>Working Sheet</b> tab — we keep that as the working automatically. Attach anything extra here (drawings, rate approvals, vendor quotes).
            </p>
            {workFiles.length > 0 && (
              <ul className="mt-2 divide-y divide-gray-100 rounded-xl border border-gray-200">
                {workFiles.map((wf, i) => (
                  <li key={`${wf.name}-${i}`} className="flex items-center gap-3 px-3 py-2">
                    <FileText className="h-4 w-4 text-emerald-600 flex-shrink-0" />
                    <span className="text-sm text-gray-800 truncate flex-1">{wf.name}</span>
                    <button type="button" onClick={() => removeWorking(i)}
                      className="text-rose-600 hover:bg-rose-50 rounded p-1 flex-shrink-0" title="Remove">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <label className="mt-2 flex items-center justify-center gap-2 border-2 border-dashed border-emerald-300 rounded-xl py-4 text-sm text-emerald-800 hover:bg-emerald-50/50 cursor-pointer">
              <Paperclip className="h-4 w-4" />
              <span>{workFiles.length === 0 ? 'Attach supporting document(s) — optional' : 'Add another document'}</span>
              <input type="file" multiple className="hidden" onChange={onPickWorking}
                accept=".xls,.xlsx,.pdf,.png,.jpg,.jpeg,.csv" />
            </label>
          </div>
        )}

        {/* Summary screenshot — OPTIONAL (the review grid + BOQ table already
            give approvers the structured rows). Shown full-width at
            the top of the sheet so approvers can glance the working without
            opening the Excel. */}
        <div>
          <Label>Summary screenshot (optional)</Label>
          {!shot ? (
            <label className="mt-1 flex flex-col items-center justify-center gap-1.5 border-2 border-dashed border-gray-300 rounded-xl px-4 py-5 text-sm text-gray-600 cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/40 transition-colors">
              <ImageIcon className="h-5 w-5 text-gray-400" />
              <span>Attach a screenshot of your summary (PNG / JPG)</span>
              <span className="text-[11px] text-gray-400">It shows on the sheet for everyone — clear enough to read at a glance</span>
              <input type="file" accept="image/*" className="hidden" onChange={onShot} />
            </label>
          ) : (
            <div className="mt-1 border border-gray-200 rounded-xl overflow-hidden">
              <div className="flex items-center gap-3 px-3 py-2 bg-gray-50 border-b border-gray-100">
                <ImageIcon className="h-4 w-4 text-indigo-600 flex-shrink-0" />
                <p className="text-xs font-medium text-gray-800 truncate flex-1">{shot.name}</p>
                <Button type="button" size="sm" variant="ghost" onClick={clearShot}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              {shotPreview && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={shotPreview} alt="Summary screenshot preview" className="max-w-full h-auto max-h-72 mx-auto" />
              )}
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
            <div className="max-h-64 overflow-y-auto overflow-x-auto">
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
                            M {formatINR(r.ai_meta.material_value)} · L {formatINR(r.ai_meta.labour_value)}
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
            <Label>Estimate Amount for approval (₹)</Label>
            <MoneyInput value={summaryTotal}
              onChange={setSummaryTotal} placeholder="auto-filled from Excel"
              readOnly={tplActive}
              className={`mt-1 ${tplActive ? 'bg-gray-50 text-gray-700' : ''}`} />
            {tplActive ? (
              <p className="text-[11px] text-gray-500 mt-1">
                Locked to your BOQ&apos;s grand total (the verified figure in the grid above) — change a row to change it.
              </p>
            ) : (() => {
              // Fuzzy mode only: warn when the typed total disagrees with what
              // the parsed rows add up to (classic miss: the pre-tax TOTAL
              // picked instead of the GST-inclusive Grand Total).
              const rowsSum = (parsed?.rows ?? []).reduce((s, r) => s + (r.amount ?? 0), 0)
              const typed = Number(summaryTotal) || 0
              if (rowsSum > 0 && typed > 0 && Math.abs(rowsSum - typed) > rowsSum * 0.02) {
                return (
                  <p className="text-[11px] text-amber-700 mt-1">
                    Heads-up: the rows in your sheet add up to <b>₹{rowsSum.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</b> — make sure this total includes GST / contingency before submitting.
                  </p>
                )
              }
              return null
            })()}
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

      </div>

      <div className="space-y-1.5">
        <Button type="submit" disabled={submitting || missingToSend.length > 0} className="w-full sm:w-auto">
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
          Create Budget Request
        </Button>
        <p className="text-[11px] text-gray-500">
          {missingToSend.length > 0
            ? <>Before you can create this: {missingToSend.join(' · ')}.</>
            : <>Creates the sheet — you review it and send it for approval on the next screen.</>}
        </p>
      </div>
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
          <p className="font-semibold text-gray-900 tabular-nums">{formatINR(splitTotals.material)}</p>
          <p className="text-[10px] text-gray-500">{pct(splitTotals.material)}%</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 px-2 py-1.5">
          <p className="text-[10px] uppercase tracking-wide text-gray-500">Labour</p>
          <p className="font-semibold text-gray-900 tabular-nums">{formatINR(splitTotals.labour)}</p>
          <p className="text-[10px] text-gray-500">{pct(splitTotals.labour)}%</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 px-2 py-1.5">
          <p className="text-[10px] uppercase tracking-wide text-gray-500">Equipment</p>
          <p className="font-semibold text-gray-900 tabular-nums">{formatINR(splitTotals.equipment)}</p>
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
