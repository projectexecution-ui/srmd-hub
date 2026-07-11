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
import { checkIsCcReviewer } from '@/components/cost-control/ws-actions'
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
    category: 'material' | 'labour' | 'material_and_labour' | 'equipment' | 'tax' | 'addon' | 'discount' | null
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
  // AI review tools are approver-only (engineers submit raw workings).
  if (!(await checkIsCcReviewer())) {
    return NextResponse.json({ ok: false, reason: 'AI review tools are for approvers only.' }, { status: 403 })
  }
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
    .select('id, status, project_id, discipline_id, sub_skill_id, line_type, entry_mode, source_excel_url')
    .eq('id', id)
    .single()
  if (wsErr || !ws) return NextResponse.json({ ok: false, reason: 'Working sheet not found' }, { status: 404 })
  // Re-parse rewrites cc_excel_rows wholesale. Once a sheet is in the
  // approval flow those rows are the evidence behind approved figures —
  // refuse to touch them.
  if (ws.status !== 'draft' && ws.status !== 'returned') {
    return NextResponse.json({
      ok: false,
      reason: 'This sheet is already in approval — re-parsing is locked so the approved figures keep their backing rows. Return it to draft first if you really need to re-read the Excel.',
    }, { status: 409 })
  }
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

  // 3. Catalogue — only sub-skills under the WS's discipline. Sending
  // every sub-skill in the project burned input tokens for no gain.
  const { data: subRes } = await supabase
    .from('cc_project_sub_skills')
    .select('sub_skill_id, cc_sub_skills!inner(id, discipline_id, code, name)')
    .eq('project_id', ws.project_id)
    .eq('is_enabled', true)
    .eq('cc_sub_skills.discipline_id', ws.discipline_id)
  type SubJoin = { sub_skill_id: string; cc_sub_skills: SubSkillCtx | SubSkillCtx[] | null }
  const enabledSubs: SubSkillCtx[] = ((subRes ?? []) as SubJoin[])
    .map(r => Array.isArray(r.cc_sub_skills) ? r.cc_sub_skills[0] : r.cc_sub_skills)
    .filter((s): s is SubSkillCtx => !!s)

  // 4. Load the existing rows IN FULL — they serve both as the "local
  // parser guess" the AI corrects from, and as the restore copy if the
  // re-insert fails after the delete below.
  const { data: existingRows, error: exErr } = await supabase
    .from('cc_excel_rows')
    .select('working_sheet_id, row_no, raw_label, description, unit, qty, rate, amount, formula_in_amount, rate_breakdown, amount_breakdown, ai_meta, flag, flag_reason, flag_severity')
    .eq('working_sheet_id', id)
    .order('row_no')
  if (exErr) {
    return NextResponse.json({ ok: false, reason: 'Couldn\'t read the existing rows — nothing was changed. Please try again.' }, { status: 500 })
  }
  const originalRows = existingRows ?? []

  // Size guard BEFORE anything destructive: the AI input is capped, so a
  // bigger sheet would be re-parsed from a truncated view and the rows
  // past the cap silently lost. Refuse instead and keep the original parse.
  if (originalRows.length > 60 || aoa.length > 120) {
    return NextResponse.json({
      ok: false,
      reason: `This sheet is too large for AI re-parse (${Math.max(aoa.length, originalRows.length)} rows) — the original parse is kept.`,
    }, { status: 413 })
  }

  const systemPrompt = `You are a construction cost-control Excel parser for the SRMD Cost Control system. Engineers upload BOQ-style sheets in wildly different formats — some are material-only POs, some are labour-only contracts, and many MIX BOTH (the contractor supplies material AND erects). Your job:

1. Look at the RAW SHEET (array of arrays — first cell of each row is column A) AND the LOCAL PARSER'S BEST GUESS. The local parser uses regex on column headers and often gets Indian construction sheets wrong.

2. Produce a corrected, structured list of LINE ITEM ROWS. Drop heading / section / sub-total / grand-total rows.

3. CATEGORY BIFURCATION — for each row, decide whether the cost is:
   - "material"            → just material supply
   - "labour"              → just installation / erection / labour service
   - "material_and_labour" → contractor supplies AND installs (BOM contract). MUST split.
   - "equipment"           → equipment hire
   - "tax"                 → GST, CGST, SGST, IGST, UTGST, TDS, TCS, cess, VAT, service tax
   - "addon"               → freight, transport, P&F, packing, insurance, handling, misc / other / sundry charges
   - "discount"            → rebates / trade discounts / less amounts (treat as negative)
   IMPORTANT: KEEP tax / addon / discount rows in the output — only drop true
   heading / sub-total / grand-total rows. The reconciliation depends on them:
   line items + addons + tax − discounts ≈ sheet grand total.
   Look at the description AND column headers:
   - "Supply + Installation" split columns → material_and_labour, split into material_value/labour_value using the breakdown
   - "M&L" / "SITC" / "Supply Install Test Commission" in description → material_and_labour
   - description starts with "providing & laying" / "P&L" → material_and_labour
   - description starts with "fixing" / "erecting" / "labour for" / "installing" without material spec → labour
   - description is a material spec without verb → material

4. For "material_and_labour" rows, populate BOTH material_value AND labour_value such that they sum to amount. Use rate_breakdown if Supply/Installation columns are present. If only a combined number is available, estimate using typical ratios (tiling ~60/40, PCC ~70/30, brickwork ~50/50, structural steel fab ~75/25) AND set anomaly="estimated split".

4b. CRITICAL — SPLIT-COLUMN SHEETS: when the sheet has Supply / Installation (or Material / Labour) value columns side by side, EVERY row's "amount" MUST be the combined TOTAL (supply + installation), NEVER the supply column alone. This applies to tax / addon / contingency / discount rows too — sheets often compute GST or contingency separately per column; amount = the SUM across both columns for that row. Record the per-column split in amount_breakdown. For unit-rate rows, "rate" is the combined per-unit rate (so qty × rate = amount), with the per-column rates in rate_breakdown. Done right, the rows sum EXACTLY to the sheet's grand total.

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
        "category": "material"|"labour"|"material_and_labour"|"equipment"|"tax"|"addon"|"discount"|null,
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
    raw_sheet_aoa: aoa.slice(0, 120),
    // Trimmed columns only — ai_meta / flags would burn input tokens.
    local_parser_rows: originalRows.map(r => ({
      row_no: r.row_no, raw_label: r.raw_label, description: r.description, unit: r.unit,
      qty: r.qty, rate: r.rate, amount: r.amount,
      rate_breakdown: r.rate_breakdown, amount_breakdown: r.amount_breakdown,
    })),
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
    const VALID_CATS = ['material', 'labour', 'material_and_labour', 'equipment', 'tax', 'addon', 'discount'] as const

    const aiRows: AiRow[] = (aiResult.rows ?? []).map((r, i) => {
      const meta = (r.ai_meta ?? {}) as Record<string, unknown>
      const suggested = typeof meta.suggested_sub_skill_id === 'string' && validSubIds.has(meta.suggested_sub_skill_id) ? meta.suggested_sub_skill_id : null
      const cat = VALID_CATS.includes(meta.category as typeof VALID_CATS[number]) ? meta.category as typeof VALID_CATS[number] : null
      // Sanity-check the material/labour split — mirrors /ai-parse so the
      // two routes stay consistent. When a combined row's M+L don't add to
      // amount, keep them but flag in anomaly.
      const matV = typeof meta.material_value === 'number' ? meta.material_value : null
      const labV = typeof meta.labour_value   === 'number' ? meta.labour_value   : null
      let amount = typeof r.amount === 'number' ? r.amount : null
      let rate   = typeof r.rate   === 'number' ? r.rate   : null
      const qty  = typeof r.qty    === 'number' ? r.qty    : null
      let anomaly = typeof meta.anomaly === 'string' ? meta.anomaly : null
      if (cat === 'material_and_labour' && matV != null && labV != null) {
        const sum = matV + labV
        if (amount == null || Math.abs(sum - amount) > Math.max(1, sum * 0.02)) {
          if (amount != null) {
            const note = `Line total corrected to material+labour (${sum}); AI had ${amount}`
            anomaly = anomaly ? `${anomaly}. ${note}` : note
          }
          amount = sum
        }
        // Keep table arithmetic honest: qty × rate must equal the (now
        // combined) amount. If the AI kept the supply-only unit rate,
        // derive the combined per-unit rate from the corrected amount.
        if (qty != null && qty > 0 && amount != null && (rate == null || Math.abs(rate * qty - amount) > Math.max(1, amount * 0.02))) {
          rate = amount / qty
        }
      }
      return {
        row_no: typeof r.row_no === 'number' ? r.row_no : i + 1,
        raw_label: typeof r.raw_label === 'string' ? r.raw_label : null,
        description: typeof r.description === 'string' ? r.description : null,
        unit: typeof r.unit === 'string' ? r.unit : null,
        qty,
        rate,
        amount,
        rate_breakdown: Array.isArray(r.rate_breakdown) ? (r.rate_breakdown as Breakdown[]) : null,
        amount_breakdown: Array.isArray(r.amount_breakdown) ? (r.amount_breakdown as Breakdown[]) : null,
        ai_meta: {
          suggested_sub_skill_id: suggested,
          confidence: typeof meta.confidence === 'number' ? Math.max(0, Math.min(1, meta.confidence)) : null,
          cleaned_description: typeof meta.cleaned_description === 'string' ? meta.cleaned_description : null,
          rate_concern: typeof meta.rate_concern === 'string' ? meta.rate_concern : null,
          category: cat,
          material_value: matV,
          labour_value: labV,
          anomaly,
          model: aiModel,
        },
      }
    })

    // An empty AI result must never destroy the existing parse: with no
    // rows to insert, the delete below would wipe the sheet and report
    // success. Refuse instead.
    if (aiRows.length === 0) {
      return NextResponse.json({
        ok: false,
        reason: 'The AI couldn\'t read any line items from this sheet — your original rows were kept unchanged.',
      }, { status: 422 })
    }

    // Replace strategy: drop existing rows + re-insert. This keeps row_no
    // contiguous after AI removed headers / sub-totals.
    const { error: delErr } = await supabase.from('cc_excel_rows').delete().eq('working_sheet_id', id)
    if (delErr) return NextResponse.json({ ok: false, reason: `Couldn't replace the old rows (${delErr.message}) — nothing was changed. Please try again.` }, { status: 500 })

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
      if (insErr) {
        // Best-effort rollback: the delete already ran, so put the saved
        // originals back rather than leave the sheet with zero rows.
        let restored = true
        if (originalRows.length > 0) {
          const { error: restoreErr } = await supabase.from('cc_excel_rows').insert(originalRows)
          if (restoreErr) {
            restored = false
            console.error('[ai-reparse] failed to restore original rows after insert failure:', restoreErr.message)
          }
        }
        return NextResponse.json({
          ok: false,
          reason: restored
            ? 'Saving the AI\'s new rows failed, so your original rows were restored — nothing was lost. Please try again.'
            : 'Saving the AI\'s new rows failed, and restoring the originals also failed — please re-upload the Excel or tell your admin.',
        }, { status: 500 })
      }
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
      rows_in: originalRows.length,
      rows_out: aiRows.length,
      suggestions_count: aiRows.filter(r => r.ai_meta.suggested_sub_skill_id && r.ai_meta.suggested_sub_skill_id !== ws.sub_skill_id).length,
      rate_concerns_count: aiRows.filter(r => r.ai_meta.rate_concern).length,
      split_totals: splitTotals,
      run_at: new Date().toISOString(),
    }
    // Re-parse invalidates the cached Ask-AI presets — they were built
    // off the previous row content. Next panel open will regenerate.
    await supabase
      .from('cc_working_sheets')
      .update({ ai_parse_meta: summary, ai_preset_prompts: null })
      .eq('id', id)

    return NextResponse.json({ ok: true, rows_out: aiRows.length, summary })
  } catch (err) {
    return NextResponse.json({
      ok: false,
      reason: err instanceof Error ? err.message : 'AI parse failed',
    }, { status: 500 })
  }
}
