// Management-only: AI sanity-check of the summary screenshot an engineer
// uploaded with a working sheet. Sends the image to Gemini (vision) and asks
// whether a manager can trust it at a glance or should open the Excel.
// A hint, never a gate — the Excel stays the source of truth.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkIsCcReviewer } from '@/components/cost-control/ws-actions'
import { generateJSON } from '@/lib/ai'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function guessMime(name: string | null): string {
  const n = (name ?? '').toLowerCase()
  if (n.endsWith('.jpg') || n.endsWith('.jpeg')) return 'image/jpeg'
  if (n.endsWith('.webp')) return 'image/webp'
  if (n.endsWith('.gif')) return 'image/gif'
  return 'image/png'
}

interface Verdict {
  verdict: 'looks_good' | 'check_excel'
  confidence: 'high' | 'medium' | 'low'
  total_seen: number | null
  issues: string[]
  note: string
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  // Management only — this is a reviewer aid.
  if (!(await checkIsCcReviewer())) {
    return NextResponse.json({ ok: false, reason: 'Management only.' }, { status: 403 })
  }

  const supabase = await createClient()
  const { data: ws, error } = await supabase
    .from('cc_working_sheets')
    .select('id, total_amount, summary_image_url, summary_image_name')
    .eq('id', id)
    .single()
  if (error || !ws) return NextResponse.json({ ok: false, reason: 'Working sheet not found.' }, { status: 404 })
  if (!ws.summary_image_url) {
    return NextResponse.json({ ok: false, reason: 'No summary screenshot was uploaded on this sheet.' }, { status: 400 })
  }

  // Pull the screenshot bytes from storage → base64 for the vision model.
  const { data: blob, error: dlErr } = await supabase.storage.from('cc-sheets').download(ws.summary_image_url as string)
  if (dlErr || !blob) return NextResponse.json({ ok: false, reason: 'Could not read the screenshot.' }, { status: 500 })
  const base64 = Buffer.from(await blob.arrayBuffer()).toString('base64')
  const mimeType = blob.type || guessMime(ws.summary_image_name as string | null)

  const total = Number(ws.total_amount ?? 0)
  const totalLine = total > 0
    ? `The sheet's recorded grand total is ₹${Math.round(total).toLocaleString('en-IN')}.`
    : `No grand total is recorded for this sheet yet.`

  const result = await generateJSON<Verdict>({
    system: 'You verify "summary" screenshots uploaded alongside construction cost working sheets. Be strict but fair. Reply ONLY with the requested JSON, no prose.',
    user: `${totalLine}

Look at the attached screenshot of a budget summary and decide whether a manager can trust it at a glance, or should open the full Excel to be sure.

Check:
1. Is it a legible budget / cost summary (not blank, random, or too blurry to read)?
2. Is a grand total clearly visible?
${total > 0 ? `3. Does the visible grand total match ₹${Math.round(total).toLocaleString('en-IN')}? (small rounding differences are fine)` : ''}
4. Any signs it is cut off, edited/tampered, or missing expected lines (e.g. GST, contingency)?

Return JSON exactly: {"verdict":"looks_good"|"check_excel","confidence":"high"|"medium"|"low","total_seen": <number or null>,"issues": [short strings], "note": "one short sentence a manager can read"}. Use "check_excel" whenever anything is unclear or doesn't match.`,
    image: { data: base64, mimeType },
    maxOutputTokens: 700,
  })

  if (!result.ok) return NextResponse.json({ ok: false, reason: result.reason }, { status: 200 })
  return NextResponse.json({ ok: true, ...result.data })
}
