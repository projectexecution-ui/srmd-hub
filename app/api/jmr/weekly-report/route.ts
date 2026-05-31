import { NextRequest, NextResponse } from 'next/server'
import { buildExecOnePagerPdf, buildExecSummaryText } from '@/lib/jmr/weekly-report'
import { getJmrSettings } from '@/lib/jmr/settings'
import { createClient } from '@/lib/supabase/server'
import { getMyPermissions, can } from '@/lib/auth'

const CRON_SECRET = process.env.CRON_SECRET

// IST day-of-week (lowercase) for matching against the user-configured
// weekly_report_day setting. Vercel runs in UTC so we need the offset.
function istDayOfWeek(now = new Date()): string {
  const ist = new Date(now.getTime() + 5.5 * 3600 * 1000)
  return ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][ist.getUTCDay()]
}

const LAST_SENT_KEY = 'jmr_last_weekly_report_sent_at'

// Persist a "last sent at" marker in app_settings so we can dedup a
// cron that mis-fires (e.g. Vercel retries) and not double-send.
async function markSent() {
  const supabase = await createClient()
  const now = new Date().toISOString()
  await supabase
    .from('app_settings')
    .upsert({ key: LAST_SENT_KEY, value: now }, { onConflict: 'key' })
}

async function handle(req: NextRequest): Promise<NextResponse> {
  const sp = req.nextUrl.searchParams
  const isCron = sp.get('cron') === '1'
  const send = sp.get('send') === 'true'
  const force = sp.get('force') === '1' // bypass day-gate + dedup for manual testing

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

  // ── Cron-only gates ───────────────────────────────────────────────
  // The Vercel cron fires daily at 09:00 IST (see vercel.json). The
  // user-configurable `weekly_report_day` setting decides which day of
  // the week actually triggers a send. Dedup window: 6 days, so even
  // if cron mis-fires twice in a row we don't double-send.
  if (isCron && !force) {
    const supabaseSettings = await createClient()
    const settings = await getJmrSettings()
    const today = istDayOfWeek()
    if (settings.weekly_report_day.toLowerCase() !== today) {
      return NextResponse.json({ skipped: 'wrong day', configured: settings.weekly_report_day, today })
    }
    // Dedup against app_settings.
    const { data: lastRow } = await supabaseSettings
      .from('app_settings').select('value').eq('key', LAST_SENT_KEY).maybeSingle()
    const lastSent = lastRow?.value ? new Date(lastRow.value as string) : null
    if (lastSent && Date.now() - lastSent.getTime() < 6 * 24 * 3600 * 1000) {
      return NextResponse.json({ skipped: 'already sent within last 6 days', lastSent: lastSent.toISOString() })
    }
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
        'Content-Disposition': `attachment; filename="CT_HUB_JMR_Weekly_${new Date().toISOString().slice(0, 10)}.pdf"`,
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
  const FROM = process.env.RESEND_FROM_EMAIL || 'CT HUB JMR <noreply@srmd.org>'
  if (RESEND_KEY) {
    try {
      const b64 = Buffer.from(pdf).toString('base64')
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: FROM,
          to: recipients,
          subject: `CT HUB Weekly Machinery Report — ${new Date().toISOString().slice(0, 10)}`,
          text: buildExecSummaryText(),
          attachments: [{
            filename: `CT_HUB_JMR_Weekly_${new Date().toISOString().slice(0, 10)}.pdf`,
            content: b64,
          }],
        }),
      })
      if (!r.ok) {
        const txt = await r.text()
        return NextResponse.json({ error: `Resend failed: ${txt}` }, { status: 500 })
      }
      if (isCron) await markSent()
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
    if (isCron) await markSent()
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
