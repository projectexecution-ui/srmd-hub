// Web Push sender. The database (dispatch_push_delivery trigger via pg_net)
// POSTs one queued web_push delivery here; we load the notification + all of
// that user's registered devices and send over the Web Push protocol using the
// `web-push` library. Authenticated by the same shared secret as email
// (NOTIFY_INTERNAL_SECRET), so the public route can't be abused.
//
// Required env (Vercel → Settings → Environment Variables):
//   NEXT_PUBLIC_VAPID_PUBLIC_KEY   VAPID public key (safe to expose)
//   VAPID_PRIVATE_KEY              VAPID private key (secret)
//   VAPID_SUBJECT (optional)       mailto: contact; defaults below
//   SUPABASE_SERVICE_ROLE_KEY      to read the notification + subscriptions
//   NOTIFY_INTERNAL_SECRET         shared secret; matches the DB copy

import { NextRequest, NextResponse } from 'next/server'
import webpush from 'web-push'
import { createClient as createServiceClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PUB = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
const PRIV = process.env.VAPID_PRIVATE_KEY

export async function POST(req: NextRequest) {
  const secret = process.env.NOTIFY_INTERNAL_SECRET
  if (!secret) return NextResponse.json({ error: 'not-configured' }, { status: 503 })
  if (req.headers.get('x-internal-secret') !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!PUB || !PRIV || !serviceKey) {
    return NextResponse.json({ error: 'push-not-configured' }, { status: 503 })
  }

  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:construction@srmd.org', PUB, PRIV)

  let body: { deliveryId?: string } | null = null
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }) }
  const deliveryId = body?.deliveryId
  if (!deliveryId) return NextResponse.json({ error: 'missing-delivery' }, { status: 400 })

  const svc = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, {
    auth: { persistSession: false },
  })

  // delivery → notification → recipient
  const { data: del } = await svc
    .from('notification_deliveries').select('notification_id').eq('id', deliveryId).single()
  if (!del) return NextResponse.json({ error: 'delivery-not-found' }, { status: 404 })
  const { data: n } = await svc
    .from('notifications').select('user_id, title, body, url').eq('id', del.notification_id).single()
  if (!n) return NextResponse.json({ error: 'notification-not-found' }, { status: 404 })

  // Write the true outcome back to the delivery row (like email), so 'sent'
  // means a device actually took it. 'skipped' = no live device (retrying won't
  // help); 'failed' = a transient error worth a retry.
  const mark = (status: 'sent' | 'failed' | 'skipped', error?: string) =>
    svc.from('notification_deliveries').update(
      status === 'sent'
        ? { status, sent_at: new Date().toISOString(), error: null }
        : { status, error: error ?? null },
    ).eq('id', deliveryId)

  const { data: subs } = await svc
    .from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('user_id', n.user_id)
  if (!subs || subs.length === 0) {
    await mark('skipped', 'no registered device')
    return NextResponse.json({ ok: true, sent: 0 })
  }

  const origin = (process.env.NEXT_PUBLIC_APP_URL || 'https://ct-hub.vercel.app').replace(/\/$/, '')
  const rawUrl = (n.url as string | null) ?? null
  const url = rawUrl ? (rawUrl.startsWith('http') ? rawUrl : origin + rawUrl) : origin
  const payload = JSON.stringify({ title: n.title || 'CT HUB', body: n.body || '', url })

  let sent = 0, pruned = 0, failedTransient = 0, lastError = ''
  await Promise.all((subs as Array<{ id: string; endpoint: string; p256dh: string; auth: string }>).map(async s => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload)
      sent++
    } catch (e) {
      // 404 / 410 Gone → the browser dropped this subscription; prune it so we
      // stop trying. Other errors are transient and worth a retry.
      const code = (e as { statusCode?: number })?.statusCode
      if (code === 404 || code === 410) {
        await svc.from('push_subscriptions').delete().eq('id', s.id)
        pruned++
      } else {
        failedTransient++
        lastError = e instanceof Error ? e.message : String(e)
      }
    }
  }))

  // Any device took it → sent. None took it but a transient error → failed
  // (retry). Otherwise every sub was dead/pruned → skipped (retry won't help).
  if (sent > 0) await mark('sent')
  else if (failedTransient > 0) await mark('failed', lastError.slice(0, 300))
  else await mark('skipped', 'all devices unsubscribed')

  return NextResponse.json({ ok: true, sent, pruned, failed: failedTransient })
}
