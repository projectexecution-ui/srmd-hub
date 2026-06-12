// AI suggests how each unmatched payment sub-project name maps to a budget
// project (e.g. "New Guest House A-Execution" → "NGH A"). Admin confirms in the
// UI before anything is saved. Free AI chain (Gemini→Groq→Cerebras) via lib/ai.

import { NextResponse } from 'next/server'
import { getMyProfile } from '@/lib/auth'
import { generateJSON, hasAiProvider } from '@/lib/ai'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Suggestion { source: string; name: string; budget_project: string | null; confidence: number }

export async function POST(req: Request) {
  const profile = await getMyProfile()
  if (!profile) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  if (!profile.is_portal_owner && profile.role !== 'admin') {
    return NextResponse.json({ error: 'Only an admin can do this.' }, { status: 403 })
  }
  if (!hasAiProvider()) {
    return NextResponse.json({ error: 'AI isn’t connected yet. Add a free key (Gemini / Groq / Cerebras) in Vercel.' }, { status: 503 })
  }

  let body: { payments?: { source: string; name: string }[]; budgetProjects?: string[] }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad request.' }, { status: 400 }) }
  const payments = (body.payments ?? []).slice(0, 120)
  const budgetProjects = (body.budgetProjects ?? []).slice(0, 200)
  if (payments.length === 0 || budgetProjects.length === 0) {
    return NextResponse.json({ suggestions: [] })
  }

  const r = await generateJSON<{ matches: Suggestion[] }>({
    system:
      'You map a construction PAYMENT project name to a BUDGET target for SRMD. ' +
      'Budget targets are either GROUPS (e.g. "NGH", "VV", "P2 Step Terrace") or individual projects (e.g. "Admin Block", "NGH A"). ' +
      'Payment project names are longer (e.g. "New Guest House", "Vinay Vivek"). Common abbreviations: NGH = New Guest House, ' +
      'VV = Vinay Vivek, SRAH = SR Animal Hospital, DC = Dining Complex, RS = Raj Sabhagruh. ' +
      'PREFER mapping to a GROUP when one fits (the specific A/B/C block resolves automatically downstream); only map to an individual ' +
      'project when there is no matching group (e.g. a standalone like Admin Block). ' +
      'For each payment, pick the SINGLE best budget target from the provided list, or null if none is a confident match. ' +
      'Return JSON: {"matches":[{"name":<payment name verbatim>,"budget_project":<one of the list or null>,"confidence":0..1}]}. ' +
      'Never invent a target not in the list.',
    user: JSON.stringify({ budget_targets: budgetProjects, payment_projects: payments.map(p => p.name) }),
    maxOutputTokens: 4000,
  })

  if (!r.ok) return NextResponse.json({ error: r.reason || 'AI could not suggest matches.' }, { status: 502 })

  // Re-attach source + validate budget_project is in the allowed list.
  const allowed = new Set(budgetProjects)
  const bySrc = new Map(payments.map(p => [p.name, p.source]))
  const suggestions: Suggestion[] = (r.data?.matches ?? [])
    .filter(m => m && typeof m.name === 'string')
    .map(m => ({
      source: bySrc.get(m.name) ?? 'contractor',
      name: m.name,
      budget_project: m.budget_project && allowed.has(m.budget_project) ? m.budget_project : null,
      confidence: typeof m.confidence === 'number' ? m.confidence : 0,
    }))

  return NextResponse.json({ suggestions, provider: r.provider })
}
