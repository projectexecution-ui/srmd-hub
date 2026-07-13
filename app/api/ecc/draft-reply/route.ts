// Command Centre — AI-written reply for one triaged email.
//
// Body: { itemId: string }
// Returns: { reply, subject, to }  (the client opens Gmail compose pre-filled)
//
// Read-only w.r.t. Gmail — we only GENERATE the reply text here. Actually
// sending / saving to Drafts as the user is Phase 2 (needs Gmail API). The
// client uses this text to open a pre-filled Gmail compose window, so the
// user reviews and sends in one click.
//
// Authorisation: the item is loaded from ecc_items under the caller's own
// RLS (user_id = auth.uid()), so a user can only draft replies to their own
// mail.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateText, hasAiProvider } from '@/lib/ai'

interface Body { itemId?: string; intent?: string }

export async function POST(req: NextRequest) {
  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!body.itemId) {
    return NextResponse.json({ error: 'itemId required' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const { data: item, error } = await supabase
    .from('ecc_items')
    .select('subject, sender, sender_email, snippet, suggested_action, amount_inr')
    .eq('id', body.itemId)
    .single()
  if (error || !item) {
    return NextResponse.json({ error: 'Item not found' }, { status: 404 })
  }

  const subject = item.subject?.toLowerCase().startsWith('re:')
    ? item.subject
    : `Re: ${item.subject ?? ''}`

  if (!hasAiProvider()) {
    // Graceful fallback — a neutral acknowledgement the user can edit.
    const reply = `Dear ${item.sender ?? 'Sir'},\n\nThank you for your email regarding "${item.subject ?? ''}". Noted — I will revert shortly.\n\nRegards,\nAkshay`
    return NextResponse.json({ reply, subject, to: item.sender_email ?? '' })
  }

  const res = await generateText({
    system:
      'You draft short, professional email replies for a construction Project Manager at SRMD, Dharampur. Plain Indian English, courteous, concise (3-6 sentences). Sign off as "Regards, Akshay". Do not invent facts, figures, or commitments — if a specific number or date is needed, leave a clear [placeholder] for the user to fill. Return ONLY the email body, no subject line.',
    user:
      `Draft a reply to this email.\n` +
      `From: ${item.sender ?? ''} <${item.sender_email ?? ''}>\n` +
      `Subject: ${item.subject ?? ''}\n` +
      `Snippet: ${item.snippet ?? ''}\n` +
      (item.suggested_action ? `Intended action: ${item.suggested_action}\n` : '') +
      (item.amount_inr ? `Amount involved: Rs ${item.amount_inr}\n` : '') +
      // The chip the user tapped — the reply must take THIS stance.
      (body.intent ? `\nThe reply must take this stance: "${body.intent}". Write the reply accordingly.\n` : ''),
    maxOutputTokens: 500,
  })

  if (!res.ok) {
    return NextResponse.json({ error: res.reason }, { status: 502 })
  }

  return NextResponse.json({ reply: res.data, subject, to: item.sender_email ?? '' })
}
