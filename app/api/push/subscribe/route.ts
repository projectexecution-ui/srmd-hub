// Register / unregister THIS browser or phone for Web Push. Called by the
// "Enable notifications on this device" button after the browser hands us a
// PushSubscription. Saves it (per user + endpoint) and flips the user's
// web_push preference on so notify_user starts queuing pushes for them.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: { endpoint?: string; keys?: { p256dh?: string; auth?: string }; userAgent?: string } | null = null
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }) }

  const endpoint = body?.endpoint
  const p256dh = body?.keys?.p256dh
  const auth = body?.keys?.auth
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: 'bad-subscription' }, { status: 400 })
  }

  const { error } = await supabase.from('push_subscriptions').upsert(
    { user_id: user.id, endpoint, p256dh, auth, user_agent: body?.userAgent ?? null },
    { onConflict: 'user_id,endpoint' },
  )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Registering a device is the opt-in — make sure the pref is on so
  // notify_user actually queues web_push deliveries for this user.
  await supabase.from('notification_preferences').upsert(
    { user_id: user.id, web_push: true }, { onConflict: 'user_id' },
  )

  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: { endpoint?: string } | null = null
  try { body = await req.json() } catch { body = null }
  const endpoint = body?.endpoint
  if (endpoint) {
    await supabase.from('push_subscriptions').delete().eq('user_id', user.id).eq('endpoint', endpoint)
  }
  return NextResponse.json({ ok: true })
}
