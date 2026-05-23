import { NextRequest, NextResponse } from 'next/server'
import { buildExecOnePagerPdf, buildExecSummaryText } from '@/lib/jmr/weekly-report'
import { getJmrSettings } from '@/lib/jmr/settings'
import { createClient } from '@/lib/supabase/server'
import { getMyPermissions, can } from '@/lib/auth'

const CRON_SECRET = process.env.CRON_SECRET

async function handle(req: NextRequest): Promise<NextResponse> {
  const sp = req.nextUrl.searchParams
  const isCron = sp.get('cron') === '1'
  const send = sp.get('send') === 'true'

  // Auth: cron jobs use the CRON_SECRET, users use the hub's permission system.
  if (isCron) {
    const auth = req.headers.get('authorization') || ''
    if (CRON_SECRET && auth !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  } else {
    const perms = await getMyPermissions()
    if (!can(perms, 'jmr', 'view')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // 1. Generate PDF
  let pdf: Uint8Array
  try {
    pdf = await buildExecOnePagerPdf()
  } catch (e) {
    return NextResponse.json({ error: `PDF gen failed: ${e instanceof Error ? e.message : 'unknown'}` }, { status: 500 })
  }

  // 2. Decide what to do with it
  if (!send && !isCron) {
    // Return PDF for download.
    return new NextResponse(pdf as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="SRMD_JMR_Weekly_${new Date().toISOString().slice(0, 10)}.pdf"`,
      },
    })
  }

  // 3. Send via email if configured.
  const settings = await getJmrSettings()
  const recipients = settings.weekly_report_recipients
  if (recipients.length === 0) {
    return NextResponse.json({
      generated: true,
      sentTo: [],
      note: 'No recipients configured in JMR settings. PDF was generated but not sent.',
    })
  }

  const RESEND_KEY = process.env.RESEND_API_KEY
  const FROM = process.env.RESEND_FROM_EMAIL || 'SRMD JMR <noreply@srmd.org>'
  if (RESEND_KEY) {
    try {
      const b64 = Buffer.from(pdf).toString('base64')
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: FROM,
          to: recipients,
          subject: `SRMD Weekly Machinery Report — ${new Date().toISOString().slice(0, 10)}`,
          text: buildExecSummaryText(),
          attachments: [{
            filename: `SRMD_JMR_Weekly_${new Date().toISOString().slice(0, 10)}.pdf`,
            content: b64,
          }],
        }),
      })
      if (!r.ok) {
        const txt = await r.text()
        return NextResponse.json({ error: `Resend failed: ${txt}` }, { status: 500 })
      }
      return NextResponse.json({ generated: true, sentTo: recipients, channel: 'resend' })
    } catch (e) {
      return NextResponse.json({ error: `Email send failed: ${e instanceof Error ? e.message : 'unknown'}` }, { status: 500 })
    }
  }

  // 4. No Resend key — store the PDF in Supabase storage and return a signed URL.
  try {
    const supabase = await createClient()
    const path = `weekly/${new Date().toISOString().slice(0, 10)}.pdf`
    await supabase.storage.from('jmr-photos').upload(path, pdf, {
      contentType: 'application/pdf', upsert: true,
    })
    const { data: signed } = await supabase.storage.from('jmr-photos').createSignedUrl(path, 60 * 60 * 24 * 7)
    return NextResponse.json({
      generated: true,
      sentTo: [],
      note: 'No RESEND_API_KEY configured. PDF stored; recipients can download from the signed URL below.',
      pdfUrl: signed?.signedUrl ?? null,
    })
  } catch (e) {
    return NextResponse.json({ error: `Storage failed: ${e instanceof Error ? e.message : 'unknown'}` }, { status: 500 })
  }
}

export async function GET(req: NextRequest) { return handle(req) }
export async function POST(req: NextRequest) { return handle(req) }
