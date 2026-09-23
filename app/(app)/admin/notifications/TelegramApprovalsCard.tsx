'use client'
// Approve budgets from Telegram — the switch, the Trustee digest and the test
// cards. Lived on Internal Estimate settings until 23 Sep 2026 (F5); it is a
// message setting, so it sits with the other alerts on Messages › Instant
// alerts. Same keys, same actions, same behaviour: each switch saves the
// moment it is tapped.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Loader2, Send } from 'lucide-react'
import { SwitchRow } from '@/app/(app)/cost-control/settings/settings-form'
import { sendMyApprovalTest, sendApprovalTestToUser } from '@/app/(app)/cost-control/settings/approval-test-action'

export function TelegramApprovalsCard({ initial, connectedUsers }: {
  initial: { telegram_approvals: boolean; tg_trustee_digest: boolean }
  connectedUsers: Array<{ id: string; name: string; role: string }>
}) {
  const router = useRouter()
  const [v, setV] = useState(initial)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [teammate, setTeammate] = useState('')
  const [, start] = useTransition()

  async function flip(key: 'telegram_approvals' | 'tg_trustee_digest', settingKey: string, label: string) {
    const next = !v[key]
    setV(p => ({ ...p, [key]: next })); setErr(null); setMsg(null); setBusy(key)
    const { error } = await createClient().from('app_settings').upsert({ key: settingKey, value: String(next) }, { onConflict: 'key' })
    setBusy(null)
    if (error) { setV(p => ({ ...p, [key]: !next })); setErr(`Couldn't save: ${error.message}`); return }
    setMsg(`${label} ${next ? 'on' : 'off'} — saved.`)
    start(() => router.refresh())
  }

  async function testMe() {
    setBusy('test'); setMsg(null); setErr(null)
    try {
      const r = await sendMyApprovalTest()
      if (r.ok) setMsg(`Sent ${r.sent} test card${r.sent === 1 ? '' : 's'} to your Telegram — open it and tap the buttons.`)
      else setErr(r.error ?? 'Could not send the test.')
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not send the test.') } finally { setBusy(null) }
  }

  async function testTeammate() {
    if (!teammate) { setErr('Pick a teammate first.'); return }
    setBusy('teammate'); setMsg(null); setErr(null)
    try {
      const r = await sendApprovalTestToUser(teammate)
      const name = connectedUsers.find(u => u.id === teammate)?.name ?? 'them'
      if (r.ok) setMsg(`Test card sent to ${name} — ask them to open Telegram and tap the buttons.`)
      else setErr(r.error ?? 'Could not send the test.')
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not send the test.') } finally { setBusy(null) }
  }

  return (
    <section className="rounded-2xl border border-sky-200 bg-white overflow-hidden">
      <h2 className="px-4 py-2.5 text-sm font-bold text-gray-900 border-b border-sky-100 bg-sky-50/60 flex items-center gap-2"><Send className="h-4 w-4 text-sky-600" /> Approve budgets from Telegram</h2>
      <div className="divide-y divide-gray-100">
        <SwitchRow
          on={v.telegram_approvals} busy={busy === 'telegram_approvals'}
          onFlip={() => flip('telegram_approvals', 'cc_telegram_approvals', 'Telegram approvals')}
          label="Approve / Return buttons on the Telegram card"
          hint="Same checks as the app — a second doorway, not a second rule. Off = Telegram is notify-only."
        />
        {v.telegram_approvals && (
          <>
            <SwitchRow
              on={v.tg_trustee_digest} busy={busy === 'tg_trustee_digest'}
              onFlip={() => flip('tg_trustee_digest', 'cc_tg_trustee_digest', 'Trustee release digest')}
              label="Trustee release digest"
              hint="One daily summary for the Trustee instead of a card per budget. Others still get individual cards."
            />
            <div className="px-4 py-3 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Button type="button" variant="outline" size="sm" onClick={testMe} disabled={busy === 'test'}>
                  {busy === 'test' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Send me a test card
                </Button>
                <span className="text-[11px] text-gray-500">A safe dry-run to your own Telegram — the buttons change nothing.</span>
              </div>
              {connectedUsers.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <select value={teammate} onChange={e => setTeammate(e.target.value)} className="text-xs border border-gray-300 rounded px-2 py-1.5 bg-white text-gray-800 min-w-[11rem] h-9">
                    <option value="">Send a test card to a connected teammate…</option>
                    {connectedUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                  <Button type="button" variant="outline" size="sm" onClick={testTeammate} disabled={busy === 'teammate' || !teammate}>
                    {busy === 'teammate' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Send
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
      {(msg || err) && (
        <p className={`px-4 py-2 text-[12px] border-t border-gray-100 ${err ? 'text-rose-700' : 'text-emerald-700'}`}>{err ?? msg}</p>
      )}
      <p className="px-4 py-2 text-[11px] text-gray-500 border-t border-gray-100">Only people who have connected their own Telegram (My notifications) can approve there, and only when it is their turn in the chain.</p>
    </section>
  )
}
