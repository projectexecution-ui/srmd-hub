// Generates a one-line, plain-English description for a user ROLE, from its
// name + (optionally) the modules it can access. Used by the "✨ AI" button on
// /admin/permissions so admins don't have to write descriptions by hand.
// Free providers (Gemini → Groq → Cerebras) via lib/ai. Portal Owner / admin
// only, so the AI quota can't be burned by ordinary users.

import { NextResponse } from 'next/server'
import { getMyProfile } from '@/lib/auth'
import { generateText, hasAiProvider } from '@/lib/ai'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const profile = await getMyProfile()
  if (!profile) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  if (!profile.is_portal_owner && profile.role !== 'admin') {
    return NextResponse.json({ error: 'Only an admin can do this.' }, { status: 403 })
  }
  if (!hasAiProvider()) {
    return NextResponse.json({
      error: 'AI isn’t connected yet. Add a free key (Gemini / Groq / Cerebras) in Vercel and redeploy.',
    }, { status: 503 })
  }

  let body: { roleName?: string; context?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad request.' }, { status: 400 }) }
  const roleName = (body.roleName || '').trim()
  if (!roleName) return NextResponse.json({ error: 'Type a role name first.' }, { status: 400 })
  const context = (body.context || '').trim().slice(0, 500)

  const r = await generateText({
    system:
      'You write the description of a user ROLE inside SRMD\'s construction-management app ' +
      '(modules include Indents, Purchase Orders, GRN, Invoices, Inventory, JMR, Budget vs Actual, Cost Control, Contractor Report). ' +
      'Reply with ONE plain-English sentence, max ~18 words, describing who this role is and what they do. ' +
      'Write for a non-technical admin. No preamble, no quotes, no markdown.',
    user:
      `Role name: "${roleName}".` +
      (context ? ` In this app it can: ${context}.` : '') +
      ' Write its one-line description.',
    maxOutputTokens: 80,
  })

  if (!r.ok) return NextResponse.json({ error: r.reason || 'AI could not generate a description.' }, { status: 502 })
  const description = r.data.trim().replace(/^["']+|["']+$/g, '').replace(/\s+/g, ' ').slice(0, 200)
  return NextResponse.json({ description, provider: r.provider })
}
