// Threaded approval-progress updates for the managers who watch approvals
// (connected admins). Every stage transition posts a short line that REPLIES TO
// the previous one for that budget, so tapping a message walks the whole chain
// back: Raised -> PH signed -> Atm signed -> Trustee released. Each carries an
// "Open in CT Hub" button for the full trail. Threads are tracked per
// (chat, working sheet) in cc_tg_progress_threads.

import type { SupabaseClient } from '@supabase/supabase-js'

const api = (token: string, m: string) => `https://api.telegram.org/bot${token}/${m}`
const inr = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN')
function appBase(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://ct-hub.vercel.app').replace(/\/$/, '')
}
function pickFirst<T>(v: T | T[] | null | undefined): T | null {
  return v ? (Array.isArray(v) ? v[0] ?? null : v) : null
}

// Send a message (optionally as a reply, to thread it) and return its id.
async function sendReturningId(token: string, chatId: string, text: string, replyTo: number | null, wsUrl: string): Promise<number | null> {
  try {
    const body: Record<string, unknown> = {
      chat_id: chatId, text, disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [[{ text: 'Open in CT Hub', url: wsUrl }]] },
    }
    if (replyTo) { body.reply_to_message_id = replyTo; body.allow_sending_without_reply = true }
    const r = await fetch(api(token, 'sendMessage'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean; result?: { message_id?: number } }
    return j?.ok ? (j.result?.message_id ?? null) : null
  } catch { return null }
}

const STAGE_LINE: Record<string, (who: string) => string> = {
  submitted: who => `• Raised — ${who}. With the Project Head.`,
  ph_approved: who => `✓ Project Head signed — ${who}. Now with the Atm Head.`,
  atm_approved: who => `✓ Atm Head signed — ${who}. Now with the Trustee to release.`,
  partially_approved: who => `✓ Trustee released a part — ${who}. Balance still pending.`,
  approved: who => `✅ Trustee released — ${who}. Fully approved (awaiting IN4 entry).`,
  returned: who => `↩ Returned for changes — ${who}.`,
}

interface CodeName { code: string | null; name: string | null }

export async function notifyApprovalProgress(svc: SupabaseClient, token: string, wsId: string): Promise<void> {
  if (!token || !wsId) return
  const { data: ws } = await svc
    .from('cc_working_sheets')
    .select('ws_code, status, total_amount, summary_notes, engineer_id, ph_checked_by, atm_checked_by, approved_for_erp_by, returned_by, projects(code, name), cc_sub_skills(code, name)')
    .eq('id', wsId)
    .maybeSingle()
  if (!ws) return
  if (((ws.summary_notes as string | null) ?? '').startsWith('[IB')) return
  const status = ws.status as string
  const lineFn = STAGE_LINE[status]
  if (!lineFn) return

  const actorId = status === 'submitted' ? ws.engineer_id
    : status === 'ph_approved' ? ws.ph_checked_by
    : status === 'atm_approved' ? ws.atm_checked_by
    : (status === 'approved' || status === 'partially_approved') ? ws.approved_for_erp_by
    : status === 'returned' ? ws.returned_by
    : null
  let who = 'someone'
  if (actorId) {
    const { data: pr } = await svc.from('profiles').select('full_name, name').eq('id', actorId as string).maybeSingle()
    who = (pr?.full_name as string | null) ?? (pr?.name as string | null) ?? 'someone'
  }

  const proj = pickFirst(ws.projects as CodeName | CodeName[] | null)
  const sub = pickFirst(ws.cc_sub_skills as CodeName | CodeName[] | null)
  const projName = proj?.name || proj?.code || 'Project'
  const subLabel = sub ? [sub.code, sub.name].filter(Boolean).join(' ') : ''
  const text = `${ws.ws_code} · ${projName}${subLabel ? ` · ${subLabel}` : ''} — ${inr(Number(ws.total_amount ?? 0))}\n${lineFn(who)}`
  const wsUrl = `${appBase()}/cost-control/working-sheets/${wsId}`

  // Watchers = connected admins.
  const { data: admins } = await svc.from('profiles').select('id').eq('role', 'admin').eq('is_active', true)
  const ids = (admins ?? []).map(a => a.id as string)
  if (!ids.length) return
  const { data: prefs } = await svc
    .from('notification_preferences').select('user_id, telegram_chat_id')
    .in('user_id', ids).eq('telegram', true).not('telegram_chat_id', 'is', null)

  for (const p of prefs ?? []) {
    const chatId = p.telegram_chat_id as string
    const { data: th } = await svc
      .from('cc_tg_progress_threads').select('last_message_id')
      .eq('chat_id', chatId).eq('ws_id', wsId).maybeSingle()
    const replyTo = th?.last_message_id != null ? Number(th.last_message_id) : null
    const mid = await sendReturningId(token, chatId, text, replyTo, wsUrl)
    if (mid != null) {
      await svc.from('cc_tg_progress_threads').upsert({ chat_id: chatId, ws_id: wsId, last_message_id: mid, updated_at: new Date().toISOString() })
    }
  }
}
