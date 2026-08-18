'use server'

// "Send me a test" for Telegram budget approvals. Renders the caller's own
// pending approval cards and pushes them — as SAFE test cards (buttons validate
// the plumbing but change nothing) — to the caller's connected Telegram, with
// the working files attached. This is the dry-run: you see the exact card, tap
// the exact buttons, and confirm identity + delivery without moving any budget.

import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { getMyUser } from '@/lib/auth'
import { getCcSettings } from '@/lib/cost-control/settings'
import { loadApprovalCardInput } from '@/lib/cost-control/approval-card-data'
import { sendApprovalToChat } from '@/lib/telegram/cc-approval-send'

const STAGE_FOR_ROLE: Record<string, string[]> = {
  project_head: ['submitted'],
  head: ['ph_approved'],
  founder: ['atm_approved', 'partially_approved'],
}

export async function sendMyApprovalTest(): Promise<{ ok: boolean; error?: string; sent?: number }> {
  const user = await getMyUser()
  if (!user) return { ok: false, error: 'Not signed in' }

  const supabase = await createClient()

  // The caller's Telegram must be connected.
  const { data: pref } = await supabase
    .from('notification_preferences')
    .select('telegram, telegram_chat_id')
    .eq('user_id', user.id)
    .maybeSingle()
  const chatId = pref?.telegram_chat_id as string | null
  if (!chatId || pref?.telegram === false) {
    return { ok: false, error: 'Connect your Telegram first (Settings → Notifications → Connect Telegram).' }
  }

  const token = process.env.TELEGRAM_BOT_TOKEN
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!token || !url || !key) return { ok: false, error: 'Telegram is not fully configured on the server yet.' }
  const svc = createServiceClient(url, key, { auth: { persistSession: false } })

  // Which stages are "mine": admins can act on any; otherwise map the effective
  // role to its stage. We only ever send TEST cards, so this is just about
  // showing the caller a realistic card.
  const [{ data: prof }, { data: eff }] = await Promise.all([
    supabase.from('profiles').select('role').eq('id', user.id).maybeSingle(),
    supabase.rpc('effective_user_role', { p_user_id: user.id, p_module_slug: 'cost-control' }),
  ])
  const isAdmin = (prof?.role as string | null) === 'admin'
  const role = (eff as string | null) ?? (prof?.role as string | null) ?? ''
  const stages = isAdmin
    ? ['submitted', 'ph_approved', 'atm_approved', 'partially_approved']
    : (STAGE_FOR_ROLE[role] ?? [])
  if (stages.length === 0) {
    return { ok: false, error: 'Your role does not sign off budgets, so there is nothing to preview.' }
  }

  const ccSettings = await getCcSettings()

  // Candidate pending sheets at my stage(s); [IB] filtered out by loadApprovalCardInput.
  const { data: cands } = await svc
    .from('cc_working_sheets')
    .select('id, submitted_at')
    .in('status', stages)
    .is('archived_at', null)
    .order('submitted_at', { ascending: true })
    .limit(8)

  // One card keeps the request well within the serverless time budget (render +
  // send + attachment downloads). It's a look-and-feel + plumbing test, not a
  // dump of every pending sheet.
  let sent = 0
  let tried = 0
  let lastError: string | null = null
  for (const c of cands ?? []) {
    if (sent >= 1) break
    let data
    try {
      data = await loadApprovalCardInput(svc, c.id as string, ccSettings)
    } catch (e) {
      lastError = e instanceof Error ? e.message : 'card build failed'
      continue
    }
    if (!data || data.isIB) continue
    tried++
    try {
      // attach:false — keep the test fast + reliable; the real approver cards
      // carry the working Excel + evidence.
      const res = await sendApprovalToChat(svc, token, chatId, data, { dryRun: true, attach: false })
      if (res.ok) sent++
      else lastError = res.error ?? 'send failed'
    } catch (e) {
      lastError = e instanceof Error ? e.message : 'send threw'
    }
  }

  if (sent > 0) return { ok: true, sent }
  if (tried === 0) {
    return { ok: false, error: 'No budgets are waiting at your stage right now, so there was nothing to preview.' }
  }
  // Cards were found but none went out — surface the real reason.
  return { ok: false, error: `Found ${tried} budget${tried === 1 ? '' : 's'} but the Telegram send failed: ${lastError ?? 'unknown error'}` }
}
