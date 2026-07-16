'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, ChevronRight, Mail } from 'lucide-react'
import type { CcSettings } from '@/lib/cost-control/settings'
import { sendTestNotificationEmail } from './actions'

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

export function CcSettingsForm({ initial, users = [] }: {
  initial: CcSettings
  users?: Array<{ id: string; name: string; role: string }>
}) {
  const router = useRouter()
  const [v, setV] = useState({ ...initial })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [testMsg, setTestMsg] = useState<string | null>(null)
  const [testErr, setTestErr] = useState<string | null>(null)

  async function sendTest() {
    setTesting(true); setTestMsg(null); setTestErr(null)
    const r = await sendTestNotificationEmail()
    setTesting(false)
    if (r.ok) setTestMsg(r.detail ?? 'Test email sent.')
    else setTestErr(r.error ?? 'Could not send the test email.')
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
      { key: 'cc_notify_approvals', value: String(v.notify_approvals) },
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
        </div>
      </details>

      <div className="space-y-2">
        <p className="text-[11px] uppercase tracking-wider font-semibold text-gray-500">Notifications</p>
        <Toggle
          label="Email approvers when a budget is waiting on them"
          hint="Emails the Project Head / Atm Head / Trustee the moment a sheet reaches their stage, plus a daily reminder of what's still pending. Off by default. (Also needs the email key — RESEND_API_KEY — configured; without it this quietly does nothing.)"
          checked={v.notify_approvals}
          onChange={x => setV({ ...v, notify_approvals: x })}
        />
        {/* End-to-end check — sends one email to the signed-in admin and reports
            exactly what Resend says (missing key, unverified domain, or success). */}
        <div className="rounded-md border border-gray-200 px-3 py-2.5 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-gray-700">Send a test email to yourself to check delivery.</span>
            <Button type="button" size="sm" variant="outline" onClick={sendTest} disabled={testing}>
              {testing ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Mail className="h-4 w-4 mr-1.5" />}
              Send test email
            </Button>
          </div>
          {testMsg && <p className="text-xs text-green-700">✓ {testMsg}</p>}
          {testErr && <p className="text-xs text-red-600">{testErr}</p>}
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
