// Command Centre — "Ask AI" across the user's triaged inbox.
//
// Body: { q: string }
// Returns: { answer }
//
// Loads the caller's own open ecc_items (RLS-scoped) as context and answers
// the question with the free-tier lib/ai helper. Read-only: it reasons over
// the triage, it does not send or change anything.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateText, hasAiProvider } from '@/lib/ai'

interface Body { q?: string }

export async function POST(req: NextRequest) {
  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const q = (body.q ?? '').trim()
  if (!q) return NextResponse.json({ error: 'Ask a question' }, { status: 400 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const { data: items } = await supabase
    .from('ecc_items')
    .select('category, subject, sender, sender_email, summary, snippet, amount_inr, age_days, chase_on, priority, is_vip')
    .eq('user_id', user.id)
    .neq('status', 'done')
    .order('priority', { ascending: false })
    .limit(80)

  if (!items || items.length === 0) {
    return NextResponse.json({ answer: 'Your Command Centre is empty right now — nothing to analyse.' })
  }

  if (!hasAiProvider()) {
    return NextResponse.json({ error: 'AI is not configured on the server yet (set GEMINI_API_KEY in Vercel).' }, { status: 503 })
  }

  const context = items.map((i, n) =>
    `${n + 1}. [${i.category}${i.is_vip ? ' · VIP' : ''}] "${i.subject}" from ${i.sender}` +
    (i.amount_inr ? ` (Rs ${i.amount_inr})` : '') +
    ` · ${i.age_days}d old` +
    (i.summary ? ` — ${i.summary}` : ''),
  ).join('\n')

  const res = await generateText({
    system:
      'You are the assistant inside a construction Project Manager\'s email Command Centre at SRMD, Dharampur. Answer the user\'s question using ONLY the triaged inbox list provided. Be concise and practical, plain Indian English. Use short bullet points or a numbered list when helpful. Reference emails by sender + subject. If asked to draft something, write it ready to send. Do not invent emails that aren\'t in the list.',
    user: `My triaged inbox (most urgent first):\n${context}\n\nQuestion: ${q}`,
    maxOutputTokens: 900,
  })

  if (!res.ok) return NextResponse.json({ error: res.reason }, { status: 502 })
  return NextResponse.json({ answer: res.data })
}
