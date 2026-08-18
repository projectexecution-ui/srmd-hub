'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, ChevronRight } from 'lucide-react'
import type { CcSettings } from '@/lib/cost-control/settings'
import { sendMyApprovalTest, sendApprovalTestToUser } from './approval-test-action'

function Toggle({
  checked, onChange, label, hint,
}: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-start justify-between gap-4 rounded-md border border-gray-200 px-3 py-2.5 text-left hover:bg-gray-50"
    >
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-gray-900">{label}</span>
        <span className="block text-xs text-gray-500 mt-0.5">{hint}</span>
      </span>
      <span
        className={`relative mt-1 inline-flex h-5 w-9 flex-shrink-0 rounded-full transition-colors ${checked ? 'bg-blue-600' : 'bg-gray-300'}`}
        aria-hidden
      >
        <span
          className="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform"
          style={{ transform: checked ? 'translateX(16px)' : 'translateX(0)' }}
        />
      </span>
    </button>
  )
}

export function CcSettingsForm({ initial, users = [], connectedUsers = [] }: {
  initial: CcSettings
  users?: Array<{ id: string; name: string; role: string }>
  connectedUsers?: Array<{ id: string; name: string; role: string }>
}) {
  const router = useRouter()
  const [v, setV] = useState({ ...initial })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [testMsg, setTestMsg] = useState<string | null>(null)
  const [teammate, setTeammate] = useState('')
  const [sendingTo, setSendingTo] = useState(false)
  const [teammateMsg, setTeammateMsg] = useState<string | null>(null)

  // Admin: send a safe test card to a specific connected teammate (rolling the
  // feature out to approvers one at a time).
  async function handleSendToTeammate() {
    if (!teammate) { setTeammateMsg('Pick a teammate first.'); return }
    setSendingTo(true); setTeammateMsg(null)
    try {
      const r = await sendApprovalTestToUser(teammate)
      const name = connectedUsers.find(u => u.id === teammate)?.name ?? 'them'
      setTeammateMsg(r.ok
        ? `Test card sent to ${name} — ask them to open Telegram and tap the buttons.`
        : (r.error ?? 'Could not send the test.'))
    } catch (e) {
      setTeammateMsg(e instanceof Error ? e.message : 'Could not send the test.')
    } finally {
      setSendingTo(false)
    }
  }

  // Dry-run: push my own pending approval cards to my Telegram as TEST cards
  // (buttons validate but change nothing) so I can see + tap before it's live.
  async function handleSendApprovalTest() {
    setTesting(true); setTestMsg(null)
    try {
      const r = await sendMyApprovalTest()
      setTestMsg(r.ok
        ? `Sent ${r.sent} test card${r.sent === 1 ? '' : 's'} to your Telegram — open it and tap the buttons.`
        : (r.error ?? 'Could not send the test.'))
    } catch (e) {
      setTestMsg(e instanceof Error ? e.message : 'Could not send the test.')
    } finally {
      setTesting(false)
    }
  }

  // The Experimental switch saves the moment it's clicked — no separate "Save
  // settings" step — because its whole promise is "flip it to trial, flip it
  // off to revert instantly." Optimistic; reverts on error.
  async function toggleCumulative(next: boolean) {
    setV(prev => ({ ...prev, cumulative_versions: next }))
    setMsg(null); setError(null)
    const supabase = createClient()
    const { error } = await supabase
      .from('app_settings')
      .upsert({ key: 'cc_cumulative_versions', value: String(next) }, { onConflict: 'key' })
    if (error) {
      setV(prev => ({ ...prev, cumulative_versions: !next }))  // revert
      setError(`Couldn't save the switch: ${error.message}`)
      return
    }
    setMsg(next ? 'Cumulative BOQ turned ON — saved.' : 'Cumulative BOQ turned OFF — saved.')
    router.refresh()
  }

  // Telegram approvals — saves the instant it's clicked (a gate you flip on to
  // trial, off to revert). Default OFF; Telegram stays notify-only until on.
  async function toggleTelegramApprovals(next: boolean) {
    setV(prev => ({ ...prev, telegram_approvals: next }))
    setMsg(null); setError(null)
    const supabase = createClient()
    const { error } = await supabase
      .from('app_settings')
      .upsert({ key: 'cc_telegram_approvals', value: String(next) }, { onConflict: 'key' })
    if (error) {
      setV(prev => ({ ...prev, telegram_approvals: !next }))  // revert
      setError(`Couldn't save the switch: ${error.message}`)
      return
    }
    setMsg(next ? 'Telegram approvals turned ON — saved.' : 'Telegram approvals turned OFF — saved.')
    router.refresh()
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setMsg(null); setError(null)
    const supabase = createClient()
    const rows = [
      { key: 'cc_show_deadlines',   value: String(v.show_deadlines) },
      { key: 'cc_show_erp_columns', value: String(v.show_erp_columns) },
      { key: 'cc_show_per_sft',     value: String(v.show_per_sft) },
      { key: 'cc_ai_tools',         value: String(v.ai_tools) },
      { key: 'cc_comments',         value: String(v.comments) },
      { key: 'cc_billing_step',     value: String(v.billing_step) },
      { key: 'cc_excel_microsoft',  value: String(v.excel_microsoft) },
      { key: 'cc_label_ph_checked',  value: v.label_ph_checked.trim() },
      { key: 'cc_label_atm_checked', value: v.label_atm_checked.trim() },
      { key: 'cc_label_approved',    value: v.label_approved.trim() },
      // Engineer visibility is fixed policy now (own + assigned sheets,
      // ERP visible, Internal Estimate/Paid hidden) — no keys saved for it.
      { key: 'cc_archive_users',    value: v.archive_users.join(',') },
      { key: 'cc_ie_review',        value: String(v.ie_review) },
      { key: 'cc_cumulative_versions', value: String(v.cumulative_versions) },
      { key: 'cc_bph_sync',         value: String(v.bph_sync) },
    ]
    const { error } = await supabase.from('app_settings').upsert(rows, { onConflict: 'key' })
    if (error) { setError(error.message); setSaving(false); return }
    setMsg('Settings saved')
    setSaving(false)
    router.refresh()
  }

  return (
    <form onSubmit={submit} className="space-y-5 max-w-xl">
      <div className="space-y-2">
        <p className="text-[11px] uppercase tracking-wider font-semibold text-gray-500">Everyday</p>
        <Toggle
          label="Deadlines"
          hint="Show deadline dates on working sheets and project rows. Off keeps the pages clean; the data is kept."
          checked={v.show_deadlines}
          onChange={x => setV({ ...v, show_deadlines: x })}
        />
        <Toggle
          label="Budget vs Actual columns"
          hint="Show Budget (ERP), WO/PO and Paid — the numbers pulled from your BPH report — on the Internal Estimate."
          checked={v.show_erp_columns}
          onChange={x => setV({ ...v, show_erp_columns: x })}
        />
        <Toggle
          label="₹ per sft"
          hint="Show the small ₹/sft line under every money figure."
          checked={v.show_per_sft}
          onChange={x => setV({ ...v, show_per_sft: x })}
        />
        <Toggle
          label="Comments"
          hint="Let everyone on a working sheet write comments under it."
          checked={v.comments}
          onChange={x => setV({ ...v, comments: x })}
        />
      </div>

      {/* Less-common switches, tucked away so the page isn't overwhelming. */}
      <details className="group rounded-lg border border-gray-200 bg-gray-50/40 px-3 py-2">
        <summary className="list-none cursor-pointer flex items-center gap-2 text-[11px] uppercase tracking-wider font-semibold text-gray-500 select-none">
          <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
          Advanced
          <span className="ml-1 font-normal normal-case tracking-normal text-gray-400">AI, billing step, Trustee review, Excel preview</span>
        </summary>
        <div className="space-y-2 mt-3">
          <Toggle
            label="AI review tools"
            hint="The AI checker, bifurcation and Ask-AI panels approvers use to verify a working."
            checked={v.ai_tools}
            onChange={x => setV({ ...v, ai_tools: x })}
          />
          <Toggle
            label="Billing step (IN4 entry)"
            hint="After the Trustee approves, the Billing team marks each sheet as entered in IN4. Tracking only — no money moves."
            checked={v.billing_step}
            onChange={x => setV({ ...v, billing_step: x })}
          />
          <Toggle
            label="Trustee accept/reject on each Internal Estimate"
            hint="Off (default) — the uploaded Internal Estimate is the baseline that engineer asks are checked against. On — Trustee/Admin must ✓/✗ each sub-skill's estimate."
            checked={v.ie_review}
            onChange={x => setV({ ...v, ie_review: x })}
          />
          <Toggle
            label="Excel preview via Microsoft Office Online"
            hint="Pixel-perfect Excel rendering — but each preview SENDS the file to Microsoft's servers (they may cache it). Off = the in-app viewer keeps everything inside your app."
            checked={v.excel_microsoft}
            onChange={x => setV({ ...v, excel_microsoft: x })}
          />
          <Toggle
            label="BPH auto-sync (IN4 report → ERP figures)"
            hint="Off (default) — the 'Sync from BPH' button, the dashboard sync chip and the Map/Import entry points are hidden, and NO automatic pull runs (neither the twice-daily job nor the on-upload pull), so the IN4/BPH report never touches your Budget (ERP) figures. Turn on when you trust the report to auto-fill Budget/WO/Paid. Figures already pulled are left as-is."
            checked={v.bph_sync}
            onChange={x => setV({ ...v, bph_sync: x })}
          />
        </div>
      </details>

      <div className="space-y-2">
        <p className="text-[11px] uppercase tracking-wider font-semibold text-amber-600">Experimental</p>
        <div className="rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-3 space-y-2">
          <Toggle
            label="Cumulative BOQ across versions (new)"
            hint="Turns on the whole new way of working: a standard BOQ template every discipline downloads, a cumulative view on each revision (already approved qty/rate vs this ask, with rate changes flagged and new items grouped below), in-app revisions (no re-uploading Excel), mandatory working evidence, and a sub-skill ledger. OFF (default) keeps today's flow exactly as it is. Saves the instant you click — flip it on to trial, flip it off to revert. No code change either way."
            checked={v.cumulative_versions}
            onChange={toggleCumulative}
          />
          {v.cumulative_versions ? (
            <p className="text-[11px] text-amber-700 px-1">
              On — new working sheets get the standard template + cumulative tracking. Existing approved sheets are untouched; their next revision will use the new in-app editor.
            </p>
          ) : (
            <p className="text-[11px] text-gray-500 px-1">
              Off — the app behaves exactly as it does today. Saved automatically the moment you flip this switch (no need for the Save button below).
            </p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-[11px] uppercase tracking-wider font-semibold text-gray-500">Notifications</p>
        <div className="rounded-md border border-gray-200 bg-gray-50/60 px-3 py-2.5 text-xs text-gray-600">
          Approvers are emailed (via Gmail) the moment a budget reaches their stage — this is built in.
          Turn approval emails on/off for the whole team on the{' '}
          <a href="/settings/notifications" className="text-blue-600 hover:underline font-medium">Notifications</a> page.
        </div>
        <div className="rounded-lg border border-sky-200 bg-sky-50/50 px-3 py-3 space-y-2">
          <Toggle
            label="Approve budgets from Telegram"
            hint="When on, an approver who has connected Telegram gets Approve / Return buttons on the budget card in their DM — the approval still runs through the exact same checks as the app, it's just a second doorway. OFF (default) = Telegram is notify-only; every approval happens in the app."
            checked={v.telegram_approvals}
            onChange={toggleTelegramApprovals}
          />
          <p className="text-[11px] px-1 text-sky-800">
            Only people who have connected their own Telegram (Settings → Notifications) can approve there, and only when it&apos;s their turn in the chain. Saves the instant you flip it.
          </p>
          {v.telegram_approvals && (
            <div className="pt-1 border-t border-sky-200/70 space-y-1.5">
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={handleSendApprovalTest} disabled={testing}>
                  {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  Send me a test card
                </Button>
                <span className="text-[11px] text-sky-700">Safe dry-run to your own Telegram — the buttons change nothing.</span>
              </div>
              {testMsg && <p className="text-[11px] px-1 text-sky-900">{testMsg}</p>}

              {connectedUsers.length > 0 && (
                <div className="pt-2 mt-1 border-t border-sky-200/70 space-y-1.5">
                  <p className="text-[11px] font-semibold text-sky-900">Send a test card to a teammate (e.g. an Atm Head)</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <select
                      value={teammate}
                      onChange={e => setTeammate(e.target.value)}
                      className="text-xs border border-sky-200 rounded px-2 py-1.5 bg-white text-gray-800 min-w-[11rem]"
                    >
                      <option value="">Choose a connected teammate…</option>
                      {connectedUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                    <Button type="button" variant="outline" size="sm" onClick={handleSendToTeammate} disabled={sendingTo || !teammate}>
                      {sendingTo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                      Send
                    </Button>
                  </div>
                  {teammateMsg && <p className="text-[11px] px-1 text-sky-900">{teammateMsg}</p>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-[11px] uppercase tracking-wider font-semibold text-gray-500">What engineers can see</p>
        <div className="rounded-md border border-gray-200 bg-gray-50/60 px-3 py-2.5 text-xs text-gray-600 space-y-1">
          <p className="font-semibold text-gray-800">Fixed rules — no toggles needed:</p>
          <p>• An engineer sees only the working sheets <b>they created</b> or in sub-skills <b>assigned to them</b> (from the Internal Estimate page).</p>
          <p>• They see each project&apos;s <b>Budget (ERP)</b> and <b>WO/PO</b> — never the <b>Internal Estimate</b>, <b>Paid</b>, or <b>% Used</b>.</p>
          <p>• They raise sheets only by <b>uploading their working Excel</b> (typed sheets and thumbrule are management-only).</p>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-[11px] uppercase tracking-wider font-semibold text-gray-500">Who can archive Working Sheets</p>
        <p className="text-xs text-gray-500">
          Admins can always archive/restore. Tick anyone else you want to give that power to.
          Permanent delete stays admin-only, and only from the Archived list.
        </p>
        <div className="rounded-md border border-gray-200 divide-y divide-gray-100 max-h-56 overflow-y-auto">
          {users.filter(u => u.role !== 'admin').map(u => {
            const on = v.archive_users.includes(u.id)
            return (
              <button
                key={u.id}
                type="button"
                onClick={() => setV({
                  ...v,
                  archive_users: on
                    ? v.archive_users.filter(x => x !== u.id)
                    : [...v.archive_users, u.id],
                })}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-gray-50"
              >
                <span className="min-w-0">
                  <span className="block text-sm text-gray-900">{u.name}</span>
                  <span className="block text-[11px] text-gray-500">{u.role}</span>
                </span>
                <span className={`inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border ${on ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-300 bg-white'}`}>
                  {on && <span className="text-[10px] leading-none">✓</span>}
                </span>
              </button>
            )
          })}
          {users.filter(u => u.role !== 'admin').length === 0 && (
            <p className="px-3 py-2 text-xs text-gray-400">No other active users.</p>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-[11px] uppercase tracking-wider font-semibold text-gray-500">Field names (rename anytime)</p>
        <div>
          <Label>Project Head&apos;s checked-amount field</Label>
          <Input value={v.label_ph_checked} maxLength={60} onChange={e => setV({ ...v, label_ph_checked: e.target.value })} className="mt-1" />
        </div>
        <div>
          <Label>Atm Head&apos;s checked-amount field</Label>
          <Input value={v.label_atm_checked} maxLength={60} onChange={e => setV({ ...v, label_atm_checked: e.target.value })} className="mt-1" />
        </div>
        <div>
          <Label>Trustee&apos;s approved-amount field</Label>
          <Input value={v.label_approved} maxLength={60} onChange={e => setV({ ...v, label_approved: e.target.value })} className="mt-1" />
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {msg && <p className="text-sm text-green-600">{msg}</p>}
      <div>
        <Button type="submit" disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
          Save settings
        </Button>
      </div>
    </form>
  )
}
