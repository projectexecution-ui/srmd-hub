// Management-only: AI audit of the summary screenshot an engineer uploaded.
//
// The AI ONLY transcribes the numbers it can see (vision is good at reading,
// unreliable at arithmetic). All the maths — row totals (qty × rate),
// the line-item subtotal, and the grand-total chain (subtotal + escalation +
// GST …) — is recomputed here in code, exactly. So the verdict is trustworthy
// and self-contained: it checks the sheet's OWN internal consistency, not any
// external number.
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

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

interface Extraction {
  readable: boolean
  title: string | null
  line_items: Array<{ desc: string | null; qty: number | null; rate: number | null; amount: number | null }>
  subtotal: number | null
  adjustments: Array<{ label: string | null; amount: number | null }>
  grand_total: number | null
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!(await checkIsCcReviewer())) {
    return NextResponse.json({ ok: false, reason: 'Management only.' }, { status: 403 })
  }

  const supabase = await createClient()
  const { data: ws, error } = await supabase
    .from('cc_working_sheets')
    .select('id, summary_image_url, summary_image_name')
    .eq('id', id)
    .single()
  if (error || !ws) return NextResponse.json({ ok: false, reason: 'Working sheet not found.' }, { status: 404 })
  if (!ws.summary_image_url) {
    return NextResponse.json({ ok: false, reason: 'No summary screenshot was uploaded on this sheet.' }, { status: 400 })
  }

  const { data: blob, error: dlErr } = await supabase.storage.from('cc-sheets').download(ws.summary_image_url as string)
  if (dlErr || !blob) return NextResponse.json({ ok: false, reason: 'Could not read the screenshot.' }, { status: 500 })
  const base64 = Buffer.from(await blob.arrayBuffer()).toString('base64')
  const mimeType = blob.type || guessMime(ws.summary_image_name as string | null)

  // Step 1 — transcription only. No maths, no fixing.
  const res = await generateJSON<Extraction>({
    system: 'You are a meticulous data-entry clerk. Transcribe the construction cost estimate in the image to JSON EXACTLY as printed. Do NOT calculate, correct, or infer anything — copy the numbers you see. Reply ONLY with JSON.',
    user: `Transcribe this budget summary. Strip commas / ₹ from numbers (e.g. "1,44,89,879" → 14489879). Blank cells → null.

Return exactly:
{
 "readable": true or false,
 "title": string or null,
 "line_items": [{"desc": string, "qty": number|null, "rate": number|null, "amount": number|null}],
 "subtotal": number|null,          // the "Total" of the line-item amounts, as printed
 "adjustments": [{"label": string, "amount": number|null}],  // rows between the subtotal and grand total (escalation, GST, etc.) — amounts as printed
 "grand_total": number|null        // the final / highlighted total, as printed
}
Only include real line items in line_items (not the Total / GST / Grand Total rows — those go in subtotal / adjustments / grand_total). readable=false only if the image is too blurry/cropped to transcribe.`,
    image: { data: base64, mimeType },
    maxOutputTokens: 2200,
  })

  if (!res.ok) return NextResponse.json({ ok: false, reason: res.reason }, { status: 200 })
  const ex = res.data
  if (!ex || ex.readable === false) {
    return NextResponse.json({ ok: true, verdict: 'unreadable', issues: [], checks: [], note: 'Could not read the screenshot clearly — please open the Excel.' })
  }

  // Step 2 — verify the maths in code (exact). Tolerance absorbs rounding.
  const items = Array.isArray(ex.line_items) ? ex.line_items : []
  const issues: string[] = []
  const checks: string[] = []
  const tol = (base: number) => Math.max(5, Math.abs(base) * 0.005) // ₹5 or 0.5%

  // (a) Row maths: qty × rate vs printed amount.
  let rowChecked = 0
  for (const r of items) {
    if (r.qty != null && r.rate != null && r.amount != null && r.qty !== 0 && r.rate !== 0) {
      rowChecked++
      const expected = r.qty * r.rate
      if (Math.abs(expected - r.amount) > tol(r.amount)) {
        issues.push(`${r.desc ?? 'A row'}: ${r.qty.toLocaleString('en-IN')} × ${inr(r.rate)} = ${inr(expected)}, but the sheet shows ${inr(r.amount)}`)
      }
    }
  }
  if (rowChecked > 0 && issues.length === 0) checks.push(`All ${rowChecked} row totals (qty × rate) match`)

  // (b) Subtotal: sum of line amounts vs printed "Total".
  const sumAmounts = items.reduce((s, r) => s + (r.amount ?? 0), 0)
  if (ex.subtotal != null) {
    if (Math.abs(sumAmounts - ex.subtotal) > tol(ex.subtotal)) {
      issues.push(`The line items add up to ${inr(sumAmounts)}, but the Total row shows ${inr(ex.subtotal)}`)
    } else {
      checks.push(`Line items add up to the Total (${inr(ex.subtotal)})`)
    }
  }

  // (c) Grand total: subtotal + adjustments vs printed grand total.
  const base = ex.subtotal ?? sumAmounts
  const adjustments = Array.isArray(ex.adjustments) ? ex.adjustments : []
  const adjSum = adjustments.reduce((s, a) => s + (a.amount ?? 0), 0)
  const computedGrand = base + adjSum
  if (ex.grand_total != null) {
    if (Math.abs(computedGrand - ex.grand_total) > tol(ex.grand_total)) {
      const parts = [inr(base), ...adjustments.map(a => inr(a.amount ?? 0))].join(' + ')
      issues.push(`Adding it up (${parts}) = ${inr(computedGrand)}, but the Grand Total shows ${inr(ex.grand_total)}`)
    } else {
      checks.push(`Grand total is consistent (${inr(ex.grand_total)})`)
    }
  }

  const verdict = issues.length === 0 ? 'looks_correct' : 'has_issues'
  const note = verdict === 'looks_correct'
    ? `Read ${items.length} line item${items.length === 1 ? '' : 's'} — the sheet's own maths adds up.`
    : `Found ${issues.length} thing${issues.length === 1 ? '' : 's'} worth checking against the Excel.`

  return NextResponse.json({
    ok: true,
    verdict,
    computed_grand_total: ex.grand_total != null ? computedGrand : null,
    shown_grand_total: ex.grand_total,
    rows: items.length,
    issues,
    checks,
    note,
  })
}
