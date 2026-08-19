// Auto-send the interactive Telegram approval card to the current-stage
// approver the moment a budget reaches them — the day-to-day mode, mirroring the
// approval email. Called (best-effort, post-response via `after()`) right after
// every status transition: submit, in-app sign-off, and Telegram sign-off.
//
// Idempotent: cc_tg_approval_pings records (ws, stage, user) so an approver
// never gets the same card twice, even if the transition fires the dispatch
// more than once. Gated by the cc_telegram_approvals toggle and, per recipient,
// by who has connected Telegram (the cc_tg_stage_approvers resolver).

import { createClient as createServiceClient } from '@supabase/supabase-js'
import { parseCcSettings } from '@/lib/cost-control/settings'
import { loadApprovalCardInput } from '@/lib/cost-control/approval-card-data'
import { sendApprovalToChat } from './cc-approval-send'

export async function dispatchCardsForSheet(wsId: string): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!url || !key || !token || !wsId) return
  const svc = createServiceClient(url, key, { auth: { persistSession: false } })

  // Toggle off → Telegram stays notify-only, no cards.
  const { data: sRows } = await svc.from('app_settings').select('key, value').like('key', 'cc_%')
  const map: Record<string, string> = {}
  for (const r of sRows ?? []) map[r.key as string] = r.value as string
  if (!['true', '1', 'on'].includes(map['cc_telegram_approvals'] ?? '')) return

  // Who approves THIS sheet at its current stage, and has Telegram connected.
  const { data: targets } = await svc.rpc('cc_tg_stage_approvers', { p_ws_id: wsId })
  const list = (targets ?? []) as Array<{ user_id: string; chat_id: string }>
  if (!list.length) return

  const ccSettings = parseCcSettings(map)
  const data = await loadApprovalCardInput(svc, wsId, ccSettings)
  if (!data || data.isIB) return

  for (const t of list) {
    // One card per (sheet, stage, approver) — never a duplicate.
    const { data: existing } = await svc
      .from('cc_tg_approval_pings')
      .select('id').eq('ws_id', wsId).eq('stage', data.status).eq('user_id', t.user_id).maybeSingle()
    if (existing) continue
    const res = await sendApprovalToChat(svc, token, t.chat_id, data, { attach: true })
    if (res.ok) {
      await svc.from('cc_tg_approval_pings').insert({ ws_id: wsId, stage: data.status, user_id: t.user_id })
    }
  }
}
