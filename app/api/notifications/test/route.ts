// "Send myself a test" — an admin fires a real notification to their OWN
// account (bell + email + phone push) to confirm delivery reaches them. Distinct
// from "Run retry now" (which only re-sends things that already failed).
import { NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getMyProfile, isPortalOwner } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST() {
  const [profile, po] = await Promise.all([getMyProfile(), isPortalOwner()])
  if (!(po || profile?.role === 'admin')) {
    return NextResponse.json({ ok: false, reason: 'Admin only' }, { status: 403 })
  }
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) return NextResponse.json({ ok: false, reason: 'Missing service key' }, { status: 503 })

  const svc = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, {
    auth: { persistSession: false },
  })
  const { error } = await svc.rpc('notify_user', {
    p_user_id: profile!.id,
    p_type: 'system_test',
    p_title: 'CT HUB — test alert',
    p_body: 'A test you triggered from Admin → Notifications. If it reached your email inbox and your phone, delivery is working. (Check Spam/Promotions if the email is missing.)',
    p_url: '/dashboard',
  })
  if (error) return NextResponse.json({ ok: false, reason: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
