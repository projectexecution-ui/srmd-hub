// Smart preset prompt suggestions for the WS Ask-AI box.
//
// Generated once per sheet and cached in cc_working_sheets.ai_preset_prompts.
// Subsequent panel opens read from cache — zero Gemini calls. The user
// can force a refresh by passing { force: true } in the request body
// (wired to a "Refresh suggestions" link in the panel UI).

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { checkIsCcReviewer } from '@/components/cost-control/ws-actions'
import { generateJSON, hasAiProvider } from '@/lib/ai'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface PresetOut {
  label: string   // 4–7 words, button-friendly
  prompt: string  // full question we'll feed to the Ask endpoint
}

interface CachedPresets {
  presets: PresetOut[]
  model: string
  generated_at: string
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requirePermission('cost-control', 'view')
  // AI review tools are approver-only (engineers submit raw workings).
  if (!(await checkIsCcReviewer())) {
    return NextResponse.json({ ok: false, reason: 'AI review tools are for approvers only.' }, { status: 403 })
  }
  const { id } = await params

  // Body is optional — when force=true we bypass the cache and regenerate.
  let force = false
  try {
    const body = await req.json().catch(() => null)
    if (body && typeof body === 'object' && (body as { force?: boolean }).force === true) force = true
  } catch { /* no body, fine */ }

  const supabase = await createClient()

  // Cache hit: skip AI entirely.
  if (!force) {
    const { data: cached } = await supabase
      .from('cc_working_sheets')
      .select('ai_preset_prompts')
      .eq('id', id)
      .single()
    const meta = cached?.ai_preset_prompts as CachedPresets | null
    if (meta && Array.isArray(meta.presets) && meta.presets.length > 0) {
      return NextResponse.json({
        ok: true,
        cached: true,
        model: meta.model,
        provider: 'cache',
        presets: meta.presets,
        generated_at: meta.generated_at,
      })
    }
  }

  if (!hasAiProvider()) {
    return NextResponse.json({ ok: false, reason: 'No AI key configured' }, { status: 503 })
  }

  const { data: ws } = await supabase
    .from('cc_working_sheets')
    .select('ws_code, line_type, entry_mode, total_amount, ai_parse_meta, cc_disciplines(code, name), cc_sub_skills(code, name)')
    .eq('id', id)
    .single()
  if (!ws) return NextResponse.json({ ok: false, reason: 'Working sheet not found' }, { status: 404 })

  const { data: rows } = await supabase
    .from('cc_excel_rows')
    .select('row_no, description, unit, qty, rate, amount, ai_meta, flag, flag_reason')
    .eq('working_sheet_id', id)
    .order('row_no')
    .limit(40)

  function pick<T>(x: T | T[] | null | undefined): T | null {
    if (!x) return null; return Array.isArray(x) ? (x[0] ?? null) : x
  }
  const dis = pick(ws.cc_disciplines as { code?: string; name?: string } | null)
  const sub = pick(ws.cc_sub_skills as { code?: string; name?: string } | null)

  // Trim each row to a compact signature; full descriptions on rows >20
  // would blow up the prompt without adding much signal.
  const ctx = {
    ws_code: ws.ws_code,
    discipline: dis ? `${dis.code} ${dis.name}` : null,
    sub_skill: sub ? `${sub.code} ${sub.name}` : null,
    line_type: ws.line_type,
    estimate_amount: ws.total_amount,
    bifurcation_summary: ws.ai_parse_meta ?? null,
    rows: (rows ?? []).map(r => ({
      row: r.row_no,
      desc: typeof r.description === 'string' ? r.description.slice(0, 120) : null,
      unit: r.unit,
      qty: r.qty,
      rate: r.rate,
      amount: r.amount,
      category: (r.ai_meta as { category?: string } | null)?.category ?? null,
      flag: r.flag,
    })),
  }

  const system = `You are a construction cost-control assistant for SRMD. Given a working sheet's content, produce the TOP 5 most useful questions an Indian PM / HOD would want to ask AI about THIS specific sheet — questions tailored to what's actually in the rows, not generic prompts.

Rules:
- Look at the actual line items, discipline, sub-skill, rates, and any flagged rows.
- Prefer questions that draw on the specifics — e.g. "Is ₹4,950 a reasonable rate for a 2MP CCTV dome in 2026?" beats "Are the rates reasonable?".
- Mix categories: rate review, missing-item suggestions, peer comparison, vendor suggestion, anomaly investigation, scope sanity-check.
- Each label is button-friendly: 4–7 words, sentence case, no trailing punctuation.
- Each prompt is the full question we'll feed back to the AI on click — concrete, with the relevant context built in.
- Indian English. ₹ for currency. No jargon.

Output STRICTLY JSON, no markdown:
{
  "presets": [
    { "label": "<button text, 4-7 words>", "prompt": "<full question>" },
    ...
  ]
}`

  const user = `Working sheet context:\n\`\`\`json\n${JSON.stringify(ctx)}\n\`\`\`\n\nReturn 5 presets.`

  const r = await generateJSON<{ presets?: PresetOut[] }>({ system, user, maxOutputTokens: 1500 })
  if (!r.ok) {
    return NextResponse.json({ ok: false, reason: r.reason }, { status: 502 })
  }
  const presets = (r.data.presets ?? [])
    .filter((p): p is PresetOut => !!p && typeof p.label === 'string' && typeof p.prompt === 'string')
    .slice(0, 5)
    .map(p => ({ label: p.label.trim(), prompt: p.prompt.trim() }))

  // Fallback to a safe minimum if the model returns nothing usable.
  // (Don't cache the fallback — next time someone opens, try AI again.)
  if (presets.length === 0) {
    return NextResponse.json({
      ok: true,
      cached: false,
      model: r.model,
      provider: r.provider,
      presets: [
        { label: 'Summarise this sheet',     prompt: 'Give me a one-paragraph summary of this Working Sheet — total, biggest line items, anything to watch out for.' },
        { label: 'Are the rates reasonable', prompt: 'Looking at the descriptions and rates, are any rates clearly off for Indian construction in 2026? Be specific about which rows.' },
        { label: 'Suggest missing items',    prompt: 'Based on the work scope, are there obvious line items that seem missing from this sheet?' },
        { label: 'Material vs labour split', prompt: 'Walk me through the material vs labour split for this sheet. Is the ratio typical for this kind of work?' },
        { label: 'Help me approve',          prompt: 'I am the approving HOD. Give me a 3-bullet review: what to question, what is fine, what is risky.' },
      ],
    })
  }

  // Persist for next time — single biggest token saver.
  const cachePayload: CachedPresets = {
    presets,
    model: r.model,
    generated_at: new Date().toISOString(),
  }
  await supabase
    .from('cc_working_sheets')
    .update({ ai_preset_prompts: cachePayload })
    .eq('id', id)

  return NextResponse.json({
    ok: true,
    cached: false,
    model: r.model,
    provider: r.provider,
    presets,
    generated_at: cachePayload.generated_at,
  })
}
