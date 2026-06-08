// Re-run the AI parser on an existing working sheet's source Excel.
// Used by the "Re-parse with AI" button on the WS detail page when the
// initial upload happened before an AI key was set, or when the engineer
// wants to retry after improving the prompt.
//
// Loads the file from storage, parses the AoA, calls the configured AI
// provider (Gemini → Groq fallback, see lib/ai/index.ts), then replaces
// cc_excel_rows + cc_working_sheets.ai_parse_meta on success.

import { NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { generateJSON, hasAiProvider } from '@/lib/ai'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface SubSkillCtx { id: string; code: string; name: string; discipline_id: string }

interface Breakdown { label: string; value: number }

interface AiRow {
  row_no: number
  raw_label: string | null
  description: string | null
  unit: string | null
  qty: number | null
  rate: number | null
  amount: number | null
  rate_breakdown: Breakdown[] | null
  amount_breakdown: Breakdown[] | null
  ai_meta: {
    suggested_sub_skill_id: string | null
    confidence: number | null
    cleaned_description: string | null
    rate_concern: string | null
    category: 'material' | 'labour' | 'material_and_labour' | 'equipment' | null
    material_value: number | null
    labour_value: number | null
    anomaly: string | null
    model: string
  }
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requirePermission('cost-control', 'edit')
  const { id } = await params

  if (!hasAiProvider()) {
    return NextResponse.json({
      ok: false,
      reason: 'No AI key configured on the server. Add GEMINI_API_KEY (free — https://aistudio.google.com/apikey) in Vercel → Settings → Environment Variables and redeploy.',
    }, { status: 503 })
  }

  const supabase = await createClient()

  // 1. Load WS + the rows we'll be replacing
  const { data: ws, error: wsErr } = await supabase
    .from('cc_working_sheets')
    .select('id, project_id, discipline_id, sub_skill_id, line_type, entry_mode, source_excel_url')
    .eq('id', id)
    .single()
  if (wsErr || !ws) return NextResponse.json({ ok: false, reason: 'Working sheet not found' }, { status: 404 })
  if (ws.entry_mode !== 'excel_summary') {
    return NextResponse.json({ ok: false, reason: 'This is a line-item working sheet — AI parse only applies to Quick (Excel) mode.' }, { status: 400 })
  }
  if (!ws.source_excel_url) {
    return NextResponse.json({ ok: false, reason: 'No source Excel attached to this working sheet' }, { status: 400 })
  }

  // 2. Download the source Excel from storage
  const { data: fileBlob, error: dlErr } = await supabase.storage.from('cc-sheets').download(ws.source_excel_url)
  if (dlErr || !fileBlob) {
    return NextResponse.json({ ok: false, reason: `Could not download source Excel: ${dlErr?.message ?? 'unknown'}` }, { status: 500 })
  }
  const buf = await fileBlob.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const sheetName = wb.SheetNames.find(n => wb.Sheets[n] && wb.Sheets[n]['!ref']) ?? wb.SheetNames[0]
  if (!sheetName) return NextResponse.json({ ok: false, reason: 'Source Excel is empty' }, { status: 400 })
  const sheet = wb.Sheets[sheetName]
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null })

  // 3. Load the project's enabled sub-skills as the catalogue Claude maps onto
  const { data: subRes } = await supabase
    .from('cc_project_sub_skills')
    .select('sub_skill_id, cc_sub_skills(id, discipline_id, code, name)')
    .eq('project_id', ws.project_id)
    .eq('is_enabled', true)
  type SubJoin = { sub_skill_id: string; cc_sub_skills: SubSkillCtx | SubSkillCtx[] | null }
  const enabledSubs: SubSkillCtx[] = ((subRes ?? []) as SubJoin[])
    .map(r => Array.isArray(r.cc_sub_skills) ? r.cc_sub_skills[0] : r.cc_sub_skills)
    .filter((s): s is SubSkillCtx => !!s)

  // 4. Load the existing rows as "local parser guess" so Claude has the
  // best regex extraction to correct from
  const { data: existingRows } = await supabase
    .from('cc_excel_rows')
    .select('row_no, raw_label, description, unit, qty, rate, amount, rate_breakdown, amount_breakdown')
    .eq('working_sheet_id', id)
    .order('row_no')

  const systemPrompt = `You are a construction cost-control Excel parser for the SRMD Cost Control system. Engineers upload BOQ-style sheets in wildly different formats — some are material-only POs, some are labour-only contracts, and many MIX BOTH (the contractor supplies material AND erects). Your job:

1. Look at the RAW SHEET (array of arrays — first cell of each row is column A) AND the LOCAL PARSER'S BEST GUESS. The local parser uses regex on column headers and often gets Indian construction sheets wrong.

2. Produce a corrected, structured list of LINE ITEM ROWS. Drop heading / section / sub-total / grand-total rows.

3. CATEGORY BIFURCATION — for each row, decide whether the cost is:
   - "material"            → just material supply
   - "labour"              → just installation / erection / labour service
   - "material_and_labour" → contractor supplies AND installs (BOM contract). MUST split.
   - "equipment"           → equipment hire
   Look at the description AND column headers:
   - "Supply + Installation" split columns → material_and_labour, split into material_value/labour_value using the breakdown
   - "M&L" / "SITC" / "Supply Install Test Commission" in description → material_and_labour
   - description starts with "providing & laying" / "P&L" → material_and_labour
   - description starts with "fixing" / "erecting" / "labour for" / "installing" without material spec → labour
   - description is a material spec without verb → material

4. For "material_and_labour" rows, populate BOTH material_value AND labour_value such that they sum to amount. Use rate_breakdown if Supply/Installation columns are present. If only a combined number is available, estimate using typical ratios (tiling ~60/40, PCC ~70/30, brickwork ~50/50, structural steel fab ~75/25) AND set anomaly="estimated split".

5. Tag the most likely SUB-SKILL from the catalogue (suggested_sub_skill_id). null when confidence < 0.4.

6. Flag rate concerns briefly (rate_concern) when the rate looks impossible.

7. Be conservative; when uncertain set anomaly.

Output STRICTLY JSON (no preamble, no markdown):
{
  "rows": [
    {
      "row_no": <1-based>,
      "raw_label": <string|null>,
      "description": <string|null>,
      "unit": <string|null>,
      "qty": <number|null>,
      "rate": <number|null>,
      "amount": <number|null>,
      "rate_breakdown": [{"label":<string>,"value":<number>}]|null,
      "amount_breakdown": [{"label":<string>,"value":<number>}]|null,
      "ai_meta": {
        "suggested_sub_skill_id": <uuid|null>,
        "confidence": <0..1>,
        "cleaned_description": <string|null>,
        "rate_concern": <string|null>,
        "category": "material"|"labour"|"material_and_labour"|"equipment"|null,
        "material_value": <number|null>,
        "labour_value":   <number|null>,
        "anomaly": <string|null>
      }
    }
  ],
  "grand_total": <number|null>,
  "summary": <string — 2-4 sentences>
}`

  const payload = {
    line_type: ws.line_type,
    project_chosen_sub_skill_id: ws.sub_skill_id,
    project_chosen_discipline_id: ws.discipline_id,
    sub_skill_catalogue: enabledSubs.map(s => ({ id: s.id, code: s.code, name: s.name, discipline_id: s.discipline_id })),
    raw_sheet_aoa: aoa.slice(0, 80),
    local_parser_rows: (existingRows ?? []).slice(0, 100),
  }

  const aiCall = await generateJSON<{ rows: Array<Record<string, unknown>>; grand_total: number | null; summary: string }>({
    system: systemPrompt,
    user: `Sheet to parse (JSON):\n\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``,
    maxOutputTokens: 8000,
  })
  if (!aiCall.ok) {
    return NextResponse.json({ ok: false, reason: aiCall.reason }, { status: 500 })
  }
  const aiResult = aiCall.data
  const aiModel = aiCall.model
  try {

    const validSubIds = new Set(enabledSubs.map(s => s.id))
    const VALID_CATS = ['material', 'labour', 'material_and_labour', 'equipment'] as const

    const aiRows: AiRow[] = (aiResult.rows ?? []).map((r, i) => {
      const meta = (r.ai_meta ?? {}) as Record<string, unknown>
      const suggested = typeof meta.suggested_sub_skill_id === 'string' && validSubIds.has(meta.suggested_sub_skill_id) ? meta.suggested_sub_skill_id : null
      const cat = VALID_CATS.includes(meta.category as typeof VALID_CATS[number]) ? meta.category as typeof VALID_CATS[number] : null
      return {
        row_no: typeof r.row_no === 'number' ? r.row_no : i + 1,
        raw_label: typeof r.raw_label === 'string' ? r.raw_label : null,
        description: typeof r.description === 'string' ? r.description : null,
        unit: typeof r.unit === 'string' ? r.unit : null,
        qty: typeof r.qty === 'number' ? r.qty : null,
        rate: typeof r.rate === 'number' ? r.rate : null,
        amount: typeof r.amount === 'number' ? r.amount : null,
        rate_breakdown: Array.isArray(r.rate_breakdown) ? (r.rate_breakdown as Breakdown[]) : null,
        amount_breakdown: Array.isArray(r.amount_breakdown) ? (r.amount_breakdown as Breakdown[]) : null,
        ai_meta: {
          suggested_sub_skill_id: suggested,
          confidence: typeof meta.confidence === 'number' ? Math.max(0, Math.min(1, meta.confidence)) : null,
          cleaned_description: typeof meta.cleaned_description === 'string' ? meta.cleaned_description : null,
          rate_concern: typeof meta.rate_concern === 'string' ? meta.rate_concern : null,
          category: cat,
          material_value: typeof meta.material_value === 'number' ? meta.material_value : null,
          labour_value: typeof meta.labour_value === 'number' ? meta.labour_value : null,
          anomaly: typeof meta.anomaly === 'string' ? meta.anomaly : null,
          model: aiModel,
        },
      }
    })

    // Replace strategy: drop existing rows + re-insert. This keeps row_no
    // contiguous after AI removed headers / sub-totals.
    const { error: delErr } = await supabase.from('cc_excel_rows').delete().eq('working_sheet_id', id)
    if (delErr) return NextResponse.json({ ok: false, reason: `DB delete failed: ${delErr.message}` }, { status: 500 })

    if (aiRows.length > 0) {
      const { error: insErr } = await supabase.from('cc_excel_rows').insert(
        aiRows.map(r => ({
          working_sheet_id: id,
          row_no: r.row_no,
          raw_label: r.raw_label,
          description: r.description,
          unit: r.unit,
          qty: r.qty,
          rate: r.rate,
          amount: r.amount,
          rate_breakdown: r.rate_breakdown,
          amount_breakdown: r.amount_breakdown,
          ai_meta: r.ai_meta,
        })),
      )
      if (insErr) return NextResponse.json({ ok: false, reason: `DB insert failed: ${insErr.message}` }, { status: 500 })
    }

    // Compute split totals + persist summary
    const splitTotals = aiRows.reduce(
      (acc, r) => {
        const m = r.ai_meta.category
        if (m === 'material') acc.material += r.amount ?? 0
        else if (m === 'labour') acc.labour += r.amount ?? 0
        else if (m === 'material_and_labour') {
          acc.material += r.ai_meta.material_value ?? 0
          acc.labour   += r.ai_meta.labour_value   ?? 0
        } else if (m === 'equipment') acc.equipment += r.amount ?? 0
        return acc
      },
      { material: 0, labour: 0, equipment: 0 } as Record<'material' | 'labour' | 'equipment', number>,
    )
    const summary = {
      text: typeof aiResult.summary === 'string' ? aiResult.summary : null,
      model: aiModel,
      rows_in: (existingRows ?? []).length,
      rows_out: aiRows.length,
      suggestions_count: aiRows.filter(r => r.ai_meta.suggested_sub_skill_id && r.ai_meta.suggested_sub_skill_id !== ws.sub_skill_id).length,
      rate_concerns_count: aiRows.filter(r => r.ai_meta.rate_concern).length,
      split_totals: splitTotals,
      run_at: new Date().toISOString(),
    }
    await supabase.from('cc_working_sheets').update({ ai_parse_meta: summary }).eq('id', id)

    return NextResponse.json({ ok: true, rows_out: aiRows.length, summary })
  } catch (err) {
    return NextResponse.json({
      ok: false,
      reason: err instanceof Error ? err.message : 'AI parse failed',
    }, { status: 500 })
  }
}
