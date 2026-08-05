'use client'
// The approval dial. One choice, saved the instant it's clicked (like the Cost
// Control experimental switch) — no separate Save step. Aksha changes it
// himself whenever he wants; it takes effect for everyone on the next page load.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Loader2, Check, Zap, ShieldCheck } from 'lucide-react'
import type { InvSettings, InvApprovalMode } from '@/lib/inventory/settings'

const MODES: Array<{
  value: InvApprovalMode
  label: string
  hint: string
  icon: React.ComponentType<{ className?: string }>
}> = [
  {
    value: 'off',
    label: 'Storekeeper issues directly',
    hint: 'Fastest. When material is in stock, the storekeeper hands it over on the spot — no management approval. (A shortfall still becomes a purchase.) You still see everything through live stock and reports.',
    icon: Zap,
  },
  {
    value: 'always',
    label: 'One Atm Head approval first',
    hint: "Every request needs the project's Atm Head to OK it before the storekeeper can issue. More control — and still fast, because everyone is notified the moment it reaches them.",
    icon: ShieldCheck,
  },
]

type ToggleKey = 'allow_item_requests' | 'low_stock_alerts' | 'require_purpose' | 'daily_report'
const TOGGLES: Array<{ key: ToggleKey; settingKey: string; label: string; hint: string }> = [
  { key: 'allow_item_requests', settingKey: 'inv_allow_item_requests', label: 'Let staff request new items',
    hint: 'Engineers/storekeepers can propose an item that isn’t in the catalogue; an admin approves it before it can be used.' },
  { key: 'low_stock_alerts', settingKey: 'inv_low_stock_alerts', label: 'Daily low-stock alerts',
    hint: 'Each morning, nudge every store’s keeper about items that have dropped to their reorder level.' },
  { key: 'require_purpose', settingKey: 'inv_require_purpose', label: 'Require a purpose on every request',
    hint: 'Engineers must say what the material is for before they can send a request.' },
  { key: 'daily_report', settingKey: 'inv_daily_report', label: 'Email daily movement report to management',
    hint: 'Every morning, admins (plus any extra emails below) get yesterday’s Entry, Exit and Transfer summary.' },
]

function Toggle({ checked, onChange, label, hint, busy }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string; busy: boolean }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} disabled={busy}
      className="flex w-full items-start justify-between gap-4 rounded-lg border border-gray-200 px-3 py-3 text-left hover:bg-gray-50 disabled:opacity-60">
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-gray-900">{label}</span>
        <span className="block text-xs text-gray-500 mt-0.5">{hint}</span>
      </span>
      <span className={`relative mt-1 inline-flex h-5 w-9 flex-shrink-0 rounded-full transition-colors ${checked ? 'bg-green-600' : 'bg-gray-300'}`} aria-hidden>
        <span className="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform" style={{ transform: checked ? 'translateX(16px)' : 'translateX(0)' }} />
      </span>
    </button>
  )
}

export function InvSettingsForm({ initial }: { initial: InvSettings }) {
  const router = useRouter()
  const [mode, setMode] = useState<InvApprovalMode>(initial.approval_mode)
  const [toggles, setToggles] = useState({
    allow_item_requests: initial.allow_item_requests,
    low_stock_alerts: initial.low_stock_alerts,
    require_purpose: initial.require_purpose,
    daily_report: initial.daily_report,
  })
  const [emails, setEmails] = useState(initial.daily_report_emails.join(', '))
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function saveEmails() {
    setSaving(true); setMsg(null); setError(null)
    const clean = emails.split(/[,;\s]+/).map(s => s.trim()).filter(s => s.includes('@')).join(', ')
    const { error } = await createClient().from('app_settings').upsert({ key: 'inv_daily_report_emails', value: clean }, { onConflict: 'key' })
    setSaving(false)
    if (error) { setError(`Couldn't save: ${error.message}`); return }
    setEmails(clean); setMsg('Saved recipients.'); router.refresh()
  }

  async function sendTest() {
    setTesting(true); setMsg(null); setError(null)
    try {
      const res = await fetch('/api/cron/inventory-daily-report', { method: 'POST' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || j.ok === false) { setError(j.error || j.reason || `Couldn't send (status ${res.status}).`); return }
      setMsg(j.sent ? 'Test report emailed to you.' : (j.reason || 'Nothing moved yesterday — nothing to send.'))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setTesting(false)
    }
  }

  async function saveToggle(key: ToggleKey, settingKey: string, next: boolean) {
    const prev = toggles[key]
    setToggles(t => ({ ...t, [key]: next })); setSaving(true); setMsg(null); setError(null)
    const supabase = createClient()
    const { error } = await supabase.from('app_settings').upsert({ key: settingKey, value: String(next) }, { onConflict: 'key' })
    setSaving(false)
    if (error) { setToggles(t => ({ ...t, [key]: prev })); setError(`Couldn't save: ${error.message}`); return }
    setMsg('Saved.'); router.refresh()
  }

  async function save(next: InvApprovalMode) {
    if (next === mode) return
    const prev = mode
    setMode(next); setSaving(true); setMsg(null); setError(null)
    const supabase = createClient()
    const { error } = await supabase
      .from('app_settings')
      .upsert({ key: 'inv_approval_mode', value: next }, { onConflict: 'key' })
    setSaving(false)
    if (error) {
      setMode(prev) // revert
      setError(`Couldn't save: ${error.message}`)
      return
    }
    setMsg(next === 'off'
      ? 'Saved — the storekeeper now issues in-stock material directly.'
      : 'Saved — every request now needs one Atm Head approval before issue.')
    router.refresh()
  }

  return (
    <div className="space-y-4 max-w-xl">
      <div>
        <p className="text-[11px] uppercase tracking-wider font-semibold text-gray-500 mb-1">Approval before a storekeeper issues material</p>
        <p className="text-xs text-gray-500 mb-3">Pick one. It saves the moment you click and applies to everyone.</p>
        <div className="space-y-2">
          {MODES.map(m => {
            const on = mode === m.value
            return (
              <button
                key={m.value}
                type="button"
                onClick={() => save(m.value)}
                disabled={saving}
                className={`flex w-full items-start justify-between gap-3 rounded-lg border px-3 py-3 text-left transition-colors disabled:opacity-60 ${on ? 'border-green-500 bg-green-50/60 ring-1 ring-green-500' : 'border-gray-200 hover:bg-gray-50'}`}
              >
                <span className="flex items-start gap-3 min-w-0">
                  <span className={`inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${on ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    <m.icon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-gray-900">{m.label}</span>
                    <span className="block text-xs text-gray-500 mt-0.5">{m.hint}</span>
                  </span>
                </span>
                <span className={`mt-1 inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border ${on ? 'bg-green-600 border-green-600 text-white' : 'border-gray-300'}`}>
                  {on && <Check className="h-3.5 w-3.5" />}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="rounded-md border border-gray-200 bg-gray-50/60 px-3 py-2.5 text-xs text-gray-600">
        Coming later: <b>approve only above a ₹ value</b> (small asks flow free, big ones need a nod). That needs prices on your items first — ask me to add item rates when you want it.
      </div>

      <div>
        <p className="text-[11px] uppercase tracking-wider font-semibold text-gray-500 mb-2">Options</p>
        <div className="space-y-2">
          {TOGGLES.map(t => (
            <Toggle key={t.key} label={t.label} hint={t.hint} busy={saving}
              checked={toggles[t.key]} onChange={v => saveToggle(t.key, t.settingKey, v)} />
          ))}
        </div>
        {toggles.daily_report && (
          <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50/60 px-3 py-3 space-y-2">
            <label className="block text-xs font-semibold text-gray-700">Extra report recipients (optional)</label>
            <p className="text-xs text-gray-500">All admins get it automatically. Add other emails, comma-separated.</p>
            <div className="flex flex-col sm:flex-row gap-2">
              <input value={emails} onChange={e => setEmails(e.target.value)} onBlur={saveEmails}
                placeholder="owner@example.com, manager@example.com"
                className="flex-1 h-9 rounded-lg border border-gray-300 bg-white px-3 text-sm" />
              <button type="button" onClick={sendTest} disabled={testing}
                className="inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-lg border border-gray-300 bg-white text-sm hover:bg-gray-50 disabled:opacity-60 whitespace-nowrap">
                {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Send me a test
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="min-h-[1.25rem]">
        {saving && <p className="text-sm text-gray-500 flex items-center gap-1.5"><Loader2 className="h-4 w-4 animate-spin" /> Saving…</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
        {msg && !saving && <p className="text-sm text-green-600">{msg}</p>}
      </div>
    </div>
  )
}
