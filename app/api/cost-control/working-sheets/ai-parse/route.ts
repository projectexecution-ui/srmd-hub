// AI-powered Working Sheet Excel parser.
//
// Input: the raw array-of-arrays (headers + body, up to ~80 rows) from the
// uploaded Excel + project context (chosen discipline + the project's
// enabled sub-skills + line type). The local regex parser ships ITS guess
// as `local_rows` so Claude can correct rather than start from scratch.
//
// Output: the same row shape the regex parser produces, plus per-row
// `ai_meta` (suggested sub-skill / cleaned description / rate concerns).
//
// Falls back gracefully when ANTHROPIC_API_KEY is missing or Claude
// errors — the client uses its local parse result in that case.

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const breakdown = z.object({ label: z.string(), value: z.number() })

const localRowSchema = z.object({
  row_no: z.number(),
  raw_label: z.string().nullable(),
  description: z.string().nullable(),
  unit: z.string().nullable(),
  qty: z.number().nullable(),
  rate: z.number().nullable(),
  amount: z.number().nullable(),
  formula_in_amount: z.string().nullable(),
  rate_breakdown: z.array(breakdown).nullable(),
  amount_breakdown: z.array(breakdown).nullable(),
})

const bodySchema = z.object({
  aoa: z.array(z.array(z.unknown())).min(1),
  project_id: z.string().uuid(),
  discipline_id: z.string().uuid(),
  sub_skill_id: z.string().uuid(),
  line_type: z.enum(['work', 'material']),
  local_rows: z.array(localRowSchema),
  local_grand_total: z.number().nullable(),
})

type Category = 'material' | 'labour' | 'material_and_labour' | 'equipment' | null

interface AiRow {
  row_no: number
  raw_label: string | null
  description: string | null
  unit: string | null
  qty: number | null
  rate: number | null
  amount: number | null
  formula_in_amount: string | null
  rate_breakdown: Array<{ label: string; value: number }> | null
  amount_breakdown: Array<{ label: string; value: number }> | null
  ai_meta: {
    suggested_sub_skill_id: string | null
    confidence: number | null
    cleaned_description: string | null
    rate_concern: string | null
    /** What kind of cost this row represents. material_and_labour means
     *  the contractor delivers both (BOM contract). When material_value
     *  + labour_value are both present, they break down a combined row. */
    category: Category
    material_value: number | null
    labour_value:   number | null
    anomaly: string | null
    model: string
  } | null
}

interface SubSkillCtx { id: string; code: string; name: string; discipline_id: string }

export async function POST(req: Request) {
  await requirePermission('cost-control', 'edit')

  const json = await req.json().catch(() => null)
  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Bad input', issues: parsed.error.issues }, { status: 400 })
  }
  const { aoa, project_id, discipline_id, sub_skill_id, line_type, local_rows, local_grand_total } = parsed.data

  // Fetch the project's enabled disciplines + sub-skills so we can hand
  // Claude the catalogue to map rows onto.
  const supabase = await createClient()
  const [discRes, subRes] = await Promise.all([
    supabase
      .from('cc_project_disciplines')
      .select('discipline_id, cc_disciplines(id, code, name)')
      .eq('project_id', project_id)
      .eq('is_enabled', true),
    supabase
      .from('cc_project_sub_skills')
      .select('sub_skill_id, cc_sub_skills(id, discipline_id, code, name)')
      .eq('project_id', project_id)
      .eq('is_enabled', true),
  ])
  type SubJoin = { sub_skill_id: string; cc_sub_skills: SubSkillCtx | SubSkillCtx[] | null }
  const enabledSubs: SubSkillCtx[] = ((subRes.data ?? []) as SubJoin[])
    .map(r => Array.isArray(r.cc_sub_skills) ? r.cc_sub_skills[0] : r.cc_sub_skills)
    .filter((s): s is SubSkillCtx => !!s)

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({
      ok: true,
      mode: 'fallback',
      reason: 'ANTHROPIC_API_KEY missing — local parser kept',
      rows: local_rows.map(r => ({ ...r, ai_meta: null })),
      grand_total: local_grand_total,
      ai_summary: null,
    })
  }

  // Slim the payload to what Claude needs: first 80 rows of the AoA + the
  // local parser's guess + the catalogue. Claude returns a corrected row
  // list with metadata.
  const aoaSlim = aoa.slice(0, 80)
  const subCatalogue = enabledSubs.map(s => ({ id: s.id, code: s.code, name: s.name, discipline_id: s.discipline_id }))

  const systemPrompt = `You are a construction cost-control Excel parser for the SRMD Cost Control system. Engineers upload BOQ-style sheets in wildly different formats — some are material-only POs, some are labour-only contracts, and many MIX BOTH (the contractor supplies material AND erects). Your job:

1. Look at the RAW SHEET (array of arrays — first cell of each row is column A) AND the LOCAL PARSER'S BEST GUESS. The local parser uses regex on column headers and often gets Indian construction sheets wrong.

2. Produce a corrected, structured list of LINE ITEM ROWS. Drop heading / section / sub-total / grand-total rows.

3. CATEGORY BIFURCATION — for each row, decide whether the cost is:
   - "material"           → just material supply (e.g. cement bags, M.S. rebar, PVC pipes)
   - "labour"             → just installation / erection / labour service
   - "material_and_labour" → contractor supplies AND installs (BOM contract). MUST split.
   - "equipment"          → equipment hire (cranes, vibrators, hoists)
   Many sheets mix all of these in one file. Look at the description AND the column headers:
   - "Supply + Installation" split columns → material_and_labour, split into material_value/labour_value using the breakdown
   - "M&L" / "SITC" / "Supply Install Test Commission" in description → material_and_labour
   - description starts with "providing & laying" / "P&L" → material_and_labour (usually)
   - description starts with "fixing" / "erecting" / "labour for" / "installing" without material spec → labour
   - description is a material spec (brand, grade, dimension) without verb → material

4. For "material_and_labour" rows, populate BOTH material_value AND labour_value such that they sum to amount. Use rate_breakdown if Supply/Installation columns are present. If only a combined number is available, estimate the split using typical industry ratios for that item (e.g. tiling ~60% material / 40% labour; PCC ~70% material / 30% labour; brickwork ~50/50; structural steel fab ~75/25) AND set anomaly="estimated split — no breakdown columns".

5. Tag the most likely SUB-SKILL from the supplied catalogue (suggested_sub_skill_id). null when unsure — confidence < 0.4 should be null.

6. Flag rate concerns briefly (rate_concern) when the rate looks impossible for the description (e.g. ₹50/cum for RCC concrete).

7. Be conservative: when uncertain, keep the local parser's value and set anomaly to explain.

Output STRICTLY JSON matching this schema (no preamble, no markdown):
{
  "rows": [
    {
      "row_no": <1-based sequence in your output>,
      "raw_label": <string|null>,
      "description": <string|null>,
      "unit": <string|null>,
      "qty": <number|null>,
      "rate": <number|null>,
      "amount": <number|null>,
      "rate_breakdown": [{"label":<string>,"value":<number>}]|null,
      "amount_breakdown": [{"label":<string>,"value":<number>}]|null,
      "ai_meta": {
        "suggested_sub_skill_id": <uuid|null from the catalogue>,
        "confidence": <0..1>,
        "cleaned_description": <string|null — only when materially different from input>,
        "rate_concern": <string|null>,
        "category": "material"|"labour"|"material_and_labour"|"equipment"|null,
        "material_value": <number|null — portion of amount that is material>,
        "labour_value":   <number|null — portion of amount that is labour>,
        "anomaly": <string|null>
      }
    }
  ],
  "grand_total": <number|null>,
  "summary": <string — 2-4 sentences: total counts by category, any rate concerns, sheet quality>,
  "totals_by_category": {
    "material": <number>,
    "labour": <number>,
    "material_and_labour": <number>,
    "equipment": <number>
  }
}`

  const userPayload = {
    line_type,
    project_chosen_sub_skill_id: sub_skill_id,
    project_chosen_discipline_id: discipline_id,
    sub_skill_catalogue: subCatalogue,
    raw_sheet_aoa: aoaSlim,
    local_parser_rows: local_rows.slice(0, 100),
    local_parser_grand_total: local_grand_total,
  }

  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const resp = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 8000,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: `Sheet to parse (JSON):\n\`\`\`json\n${JSON.stringify(userPayload)}\n\`\`\``,
      }],
    })
    const textBlock = resp.content.find(b => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') throw new Error('No text response')
    // Claude sometimes wraps JSON in ```json fences even when told not to.
    const text = textBlock.text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim()
    const aiResult = JSON.parse(text) as {
      rows: Array<Record<string, unknown>>
      grand_total: number | null
      summary: string
      totals_by_category?: Partial<Record<'material' | 'labour' | 'material_and_labour' | 'equipment', number>>
    }

    const validSubIds = new Set(enabledSubs.map(s => s.id))
    const VALID_CATS = ['material', 'labour', 'material_and_labour', 'equipment'] as const

    // Normalise + validate Claude's output. Cast each field through the
    // same shape as the local parser's, so the client doesn't care which
    // path produced the data.
    const aiRows: AiRow[] = (aiResult.rows ?? []).map((r, i) => {
      const meta = (r.ai_meta ?? {}) as Record<string, unknown>
      const suggested = typeof meta.suggested_sub_skill_id === 'string' && validSubIds.has(meta.suggested_sub_skill_id) ? meta.suggested_sub_skill_id : null
      const cat = VALID_CATS.includes(meta.category as typeof VALID_CATS[number])
        ? (meta.category as Category)
        : null
      // Sanity-check the material/labour split — when it's a combined row
      // with both values, they should roughly equal amount. If they don't,
      // keep them but note the mismatch in anomaly.
      const matV = typeof meta.material_value === 'number' ? meta.material_value : null
      const labV = typeof meta.labour_value   === 'number' ? meta.labour_value   : null
      const amount = typeof r.amount === 'number' ? r.amount : null
      let anomaly = typeof meta.anomaly === 'string' ? meta.anomaly : null
      if (cat === 'material_and_labour' && amount != null && matV != null && labV != null) {
        const sum = matV + labV
        if (Math.abs(sum - amount) > Math.max(1, amount * 0.02)) {
          const note = `Split (${matV} + ${labV}) ≠ amount (${amount})`
          anomaly = anomaly ? `${anomaly}. ${note}` : note
        }
      }
      return {
        row_no: typeof r.row_no === 'number' ? r.row_no : i + 1,
        raw_label: typeof r.raw_label === 'string' ? r.raw_label : null,
        description: typeof r.description === 'string' ? r.description : null,
        unit: typeof r.unit === 'string' ? r.unit : null,
        qty: typeof r.qty === 'number' ? r.qty : null,
        rate: typeof r.rate === 'number' ? r.rate : null,
        amount,
        formula_in_amount: null,
        rate_breakdown: Array.isArray(r.rate_breakdown) ? (r.rate_breakdown as Array<{ label: string; value: number }>) : null,
        amount_breakdown: Array.isArray(r.amount_breakdown) ? (r.amount_breakdown as Array<{ label: string; value: number }>) : null,
        ai_meta: {
          suggested_sub_skill_id: suggested,
          confidence: typeof meta.confidence === 'number' ? Math.max(0, Math.min(1, meta.confidence)) : null,
          cleaned_description: typeof meta.cleaned_description === 'string' ? meta.cleaned_description : null,
          rate_concern: typeof meta.rate_concern === 'string' ? meta.rate_concern : null,
          category: cat,
          material_value: matV,
          labour_value: labV,
          anomaly,
          model: 'claude-sonnet-4-5',
        },
      }
    })

    // Re-compute totals_by_category from row-level data so the client can
    // trust them even if Claude's top-level totals object disagrees.
    const computedTotals = aiRows.reduce(
      (acc, r) => {
        if (!r.ai_meta?.category || r.amount == null) return acc
        acc[r.ai_meta.category] = (acc[r.ai_meta.category] ?? 0) + r.amount
        return acc
      },
      { material: 0, labour: 0, material_and_labour: 0, equipment: 0 } as Record<'material' | 'labour' | 'material_and_labour' | 'equipment', number>,
    )
    // Also derive a material-vs-labour pure split (combined rows
    // contribute their material_value + labour_value separately).
    const splitTotals = aiRows.reduce(
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
      { material: 0, labour: 0, equipment: 0 } as Record<'material' | 'labour' | 'equipment', number>,
    )

    return NextResponse.json({
      ok: true,
      mode: 'ai',
      rows: aiRows,
      grand_total: typeof aiResult.grand_total === 'number' ? aiResult.grand_total : local_grand_total,
      ai_summary: {
        text: typeof aiResult.summary === 'string' ? aiResult.summary : null,
        model: 'claude-sonnet-4-5',
        rows_in: local_rows.length,
        rows_out: aiRows.length,
        suggestions_count: aiRows.filter(r => r.ai_meta?.suggested_sub_skill_id && r.ai_meta.suggested_sub_skill_id !== sub_skill_id).length,
        rate_concerns_count: aiRows.filter(r => r.ai_meta?.rate_concern).length,
        totals_by_category: computedTotals,
        split_totals: splitTotals,
        run_at: new Date().toISOString(),
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'AI parse failed'
    return NextResponse.json({
      ok: true,
      mode: 'fallback',
      reason: msg,
      rows: local_rows.map(r => ({ ...r, ai_meta: null })),
      grand_total: local_grand_total,
      ai_summary: null,
    })
  }
}
