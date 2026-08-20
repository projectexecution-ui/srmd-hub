// Trustee release digest: instead of one card per budget, the founder (the last
// stage on every project) gets ONE grouped summary of everything waiting for
// their release, so they aren't flooded. Gated by cc_telegram_approvals AND
// cc_tg_trustee_digest. Fired by the cron; an admin can preview to themselves.

import type { SupabaseClient } from '@supabase/supabase-js'

const api = (token: string, m: string) => `https://api.telegram.org/bot${token}/${m}`
const inr = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN')
function appBase(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://ct-hub.vercel.app').replace(/\/$/, '')
}
function pickFirst<T>(v: T | T[] | null | undefined): T | null {
  return v ? (Array.isArray(v) ? v[0] ?? null : v) : null
}
async function send(token: string, chatId: string, text: string, url: string): Promise<boolean> {
  try {
    const r = await fetch(api(token, 'sendMessage'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true, reply_markup: { inline_keyboard: [[{ text: 'Review & release', url }]] } }),
    })
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean }
    return !!j.ok
  } catch { return false }
}

interface Acc { chatId: string; projects: Map<string, { count: number; sum: number }>; count: number; sum: number }

/** Send each connected release-approver their grouped digest. `onlyUser` limits
 *  to one user (admin preview). Returns how many digests went out. */
export async function sendTrusteeDigests(svc: SupabaseClient, token: string, onlyUser: string | null = null): Promise<{ sent: number }> {
  if (!token) return { sent: 0 }
  const { data: sRows } = await svc.from('app_settings').select('key, value').in('key', ['cc_telegram_approvals', 'cc_tg_trustee_digest'])
  const map: Record<string, string> = {}
  for (const r of sRows ?? []) map[r.key as string] = r.value as string
  if (!['true', '1', 'on'].includes(map['cc_telegram_approvals'] ?? '')) return { sent: 0 }
  if (!['true', '1', 'on'].includes(map['cc_tg_trustee_digest'] ?? '')) return { sent: 0 }

  const { data: sheets } = await svc
    .from('cc_working_sheets')
    .select('id, total_amount, approved_for_erp_amt, summary_notes, projects(code, name)')
    .in('status', ['atm_approved', 'partially_approved'])
    .is('archived_at', null)
  const pend = (sheets ?? []).filter(s => !(((s.summary_notes as string | null) ?? '').startsWith('[IB')))

  const byChat = new Map<string, Acc>()
  for (const s of pend) {
    const { data: appr } = await svc.rpc('cc_tg_stage_approvers', { p_ws_id: s.id })
    for (const a of (appr ?? []) as Array<{ user_id: string; chat_id: string }>) {
      if (onlyUser && a.user_id !== onlyUser) continue
      let acc = byChat.get(a.chat_id)
      if (!acc) { acc = { chatId: a.chat_id, projects: new Map(), count: 0, sum: 0 }; byChat.set(a.chat_id, acc) }
      const proj = pickFirst(s.projects as { code: string | null; name: string | null } | Array<{ code: string | null; name: string | null }> | null)
      const pname = proj?.name || proj?.code || 'Project'
      const remaining = Math.max(Number(s.total_amount ?? 0) - Number(s.approved_for_erp_amt ?? 0), 0)
      const pe = acc.projects.get(pname) ?? { count: 0, sum: 0 }
      pe.count++; pe.sum += remaining; acc.projects.set(pname, pe)
      acc.count++; acc.sum += remaining
    }
  }

  let sent = 0
  for (const acc of byChat.values()) {
    const lines = [...acc.projects.entries()].sort((a, b) => b[1].sum - a[1].sum).map(([name, p]) => `• ${name} — ${p.count} · ${inr(p.sum)}`)
    const text = `🏛 Budgets waiting for your release\n${acc.count} across ${acc.projects.size} project${acc.projects.size === 1 ? '' : 's'} · ${inr(acc.sum)} to release\n\n${lines.join('\n')}\n\nTap to review & release.`
    if (await send(token, acc.chatId, text, `${appBase()}/cost-control/approvals`)) sent++
  }
  return { sent }
}
