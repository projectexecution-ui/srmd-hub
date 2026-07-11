// Ask-AI Q&A for a single Working Sheet. The user types a free-form
// question; we attach the WS + its parsed rows + project context, send
// it through the free Gemini → Groq wrapper, and stream the answer back.
//
// Scope: this WS only (line items + project / discipline / sub-skill +
// recent peer rates). Wider scopes (whole project, cross-project) will
// get their own endpoints later.

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { checkIsCcReviewer } from '@/components/cost-control/ws-actions'
import { generateText, hasAiProvider } from '@/lib/ai'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  question: z.string().trim().min(3, 'Question too short').max(2000, 'Question too long'),
})

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requirePermission('cost-control', 'view')
  // AI review tools are for the approval chain (PH / Atm Head / Trustee /
  // admin) — engineers submit raw workings, reviewers cross-check with AI.
  if (!(await checkIsCcReviewer())) {
    return NextResponse.json({ ok: false, reason: 'AI review tools are for approvers only.' }, { status: 403 })
  }
  const { id } = await params

  if (!hasAiProvider()) {
    return NextResponse.json({
      ok: false,
      reason: 'No AI key configured. Set GEMINI_API_KEY (free — https://aistudio.google.com/apikey) in Vercel.',
    }, { status: 503 })
  }

  const raw = await req.json().catch(() => null)
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, reason: parsed.error.issues[0]?.message ?? 'Bad input' }, { status: 400 })
  }
  const { question } = parsed.data

  const supabase = await createClient()
  const { data: ws, error: wsErr } = await supabase
    .from('cc_working_sheets')
    .select('id, ws_code, status, total_amount, approved_for_erp_amt, summary_total, summary_notes, line_type, entry_mode, projects(code, name), cc_disciplines(code, name), cc_sub_skills(code, name)')
    .eq('id', id)
    .single()
  if (wsErr || !ws) return NextResponse.json({ ok: false, reason: 'Working sheet not found' }, { status: 404 })

  const { data: rows } = await supabase
    .from('cc_excel_rows')
    .select('row_no, description, unit, qty, rate, amount, ai_meta, flag, flag_reason, flag_severity')
    .eq('working_sheet_id', id)
    .order('row_no')

  // Peer context — last 30 approved rates in the same sub-skill across
  // projects so the model can answer "is this rate reasonable" with a
  // local comparison.
  type SubLite = { sub_skill_id?: string } & Record<string, unknown>
  const subId = (ws as SubLite).sub_skill_id
  const { data: peerItems } = subId ? await supabase
    .from('cc_working_sheet_items')
    .select('description, qty, uom, rate, cc_working_sheets!inner(status, sub_skill_id)')
    .eq('cc_working_sheets.sub_skill_id', subId)
    .in('cc_working_sheets.status', ['approved', 'wo_issued', 'paid'])
    .neq('working_sheet_id', id)
    .limit(30) : { data: null }

  const proj = pickJoin(ws.projects)
  const dis  = pickJoin(ws.cc_disciplines)
  const sub  = pickJoin(ws.cc_sub_skills)

  const ctx = {
    ws: {
      code: ws.ws_code,
      status: ws.status,
      line_type: ws.line_type,
      entry_mode: ws.entry_mode,
      estimate_amount: ws.total_amount,
      approved_for_erp: ws.approved_for_erp_amt,
      summary_total: ws.summary_total,
      summary_notes: ws.summary_notes,
    },
    project: proj ? { code: proj.code, name: proj.name } : null,
    discipline: dis ? { code: dis.code, name: dis.name } : null,
    sub_skill: sub ? { code: sub.code, name: sub.name } : null,
    rows: (rows ?? []).slice(0, 80).map(r => ({
      row: r.row_no,
      description: r.description,
      unit: r.unit,
      qty: r.qty,
      rate: r.rate,
      amount: r.amount,
      category: (r.ai_meta as { category?: string } | null)?.category ?? null,
      material_value: (r.ai_meta as { material_value?: number } | null)?.material_value ?? null,
      labour_value:   (r.ai_meta as { labour_value?: number } | null)?.labour_value ?? null,
      flag: r.flag,
      flag_reason: r.flag_reason,
      flag_severity: r.flag_severity,
    })),
    peer_rates: (peerItems ?? []).slice(0, 30).map(p => ({
      description: p.description,
      qty: p.qty,
      uom: p.uom,
      rate: p.rate,
    })),
  }

  const system = `You are a construction cost-control assistant for SRMD Dharampur — a charitable trust running multiple construction projects in India. Answer the user's question about a single Working Sheet. The whole context is supplied as JSON.

Rules:
- Be concise. Aim for 3–8 short bullet points or 1 short paragraph. No preamble.
- Use Indian rupee notation (₹1,23,456 lakh/crore grouping) for all amounts.
- Quote row numbers when referring to specific lines (e.g. "Row 7: …").
- When asked "is this rate reasonable", compare to peer_rates if relevant items exist; otherwise say so honestly.
- If the question can't be answered from the supplied context, say what extra info would help. Do NOT invent numbers.
- Avoid jargon ("tranche", "amortise"). Use what an Indian PM would say ("release", "split").`

  const user = `User question: ${question.trim()}\n\nWorking sheet context (JSON):\n\`\`\`json\n${JSON.stringify(ctx)}\n\`\`\``

  const r = await generateText({ system, user, maxOutputTokens: 1200 })
  if (!r.ok) {
    return NextResponse.json({ ok: false, reason: r.reason }, { status: 502 })
  }
  return NextResponse.json({
    ok: true,
    answer: r.data,
    model: r.model,
    provider: r.provider,
  })
}

function pickJoin<T>(j: T | T[] | null | undefined): T | null {
  if (!j) return null
  return Array.isArray(j) ? (j[0] ?? null) : j
}
