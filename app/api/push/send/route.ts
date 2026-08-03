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

  const { data: subs } = await svc
    .from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('user_id', n.user_id)
  if (!subs || subs.length === 0) return NextResponse.json({ ok: true, sent: 0 })

  const origin = (process.env.NEXT_PUBLIC_APP_URL || 'https://ct-hub.vercel.app').replace(/\/$/, '')
  const rawUrl = (n.url as string | null) ?? null
  const url = rawUrl ? (rawUrl.startsWith('http') ? rawUrl : origin + rawUrl) : origin
  const payload = JSON.stringify({ title: n.title || 'CT HUB', body: n.body || '', url })

  let sent = 0, pruned = 0
  await Promise.all((subs as Array<{ id: string; endpoint: string; p256dh: string; auth: string }>).map(async s => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload)
      sent++
    } catch (e) {
      // 404 / 410 Gone → the browser dropped this subscription; prune it so we
      // stop trying. Other errors are transient and left alone.
      const code = (e as { statusCode?: number })?.statusCode
      if (code === 404 || code === 410) {
        await svc.from('push_subscriptions').delete().eq('id', s.id)
        pruned++
      }
    }
  }))

  return NextResponse.json({ ok: true, sent, pruned })
}
