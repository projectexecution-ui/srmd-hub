'use client'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, Mail, X, Search } from 'lucide-react'
import type { JmrSettings } from '@/lib/types'

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

export interface RecipientUser {
  email: string
  name: string
  role: string
}

export function SettingsForm({ initial, users }: { initial: JmrSettings; users: RecipientUser[] }) {
  const router = useRouter()
  const [gst, setGst] = useState(initial.gst_rate_pct.toString())
  const [day, setDay] = useState(initial.weekly_report_day)
  // Selected recipients as a set of email addresses (chosen from `users`).
  const [selected, setSelected] = useState<Set<string>>(new Set(initial.weekly_report_recipients))
  const [q, setQ] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const usersByEmail = useMemo(() => new Map(users.map(u => [u.email, u])), [users])
  const recipients = useMemo(() => Array.from(selected), [selected])
  const reportOn = recipients.length > 0
  const dayLabel = day.charAt(0).toUpperCase() + day.slice(1)

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase()
    if (!n) return users
    return users.filter(u =>
      u.name.toLowerCase().includes(n) || u.email.toLowerCase().includes(n) || u.role.toLowerCase().includes(n),
    )
  }, [users, q])

  function toggle(email: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(email)) next.delete(email); else next.add(email)
      return next
    })
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setMsg(null); setError(null)
    const supabase = createClient()
    const rows = [
      { key: 'jmr_gst_rate_pct',             value: gst },
      { key: 'jmr_weekly_report_day',        value: day },
      { key: 'jmr_weekly_report_recipients', value: JSON.stringify(recipients) },
    ]
    const { error } = await supabase.from('app_settings').upsert(rows, { onConflict: 'key' })
    if (error) { setError(error.message); setSaving(false); return }
    setMsg('Settings saved')
    setSaving(false)
    router.refresh()
  }

  return (
    <form onSubmit={submit} className="space-y-5 max-w-xl">
      {/* GST — the one setting that shapes every SPEND number */}
      <div className="max-w-[240px]">
        <Label>GST rate %</Label>
        <Input
          type="number" step="0.01" min="0"
          value={gst}
          onChange={e => setGst(e.target.value)}
          className="mt-1"
        />
        <p className="text-xs text-gray-500 mt-1">
          Added on top of logged cost for the GST-inclusive SPEND totals on the Dashboard &amp; Matrix.
        </p>
      </div>

      {/* Weekly report — recipients (picked from the user list) are the switch */}
      <div className="rounded-xl border border-gray-200 p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
              <Mail className="h-4 w-4 text-gray-500" /> Weekly report (auto-email)
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              A PDF of the week&apos;s logged spend, emailed automatically. Pick who gets it from your
              team — select nobody to keep it off.
            </p>
          </div>
          <span className={`flex-shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full ${reportOn ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
            {reportOn ? 'On' : 'Off'}
          </span>
        </div>

        <div className="max-w-[240px]">
          <Label>Send every</Label>
          <select
            value={day}
            onChange={e => setDay(e.target.value)}
            className="mt-1 flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
          >
            {DAYS.map(d => (
              <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>
            ))}
          </select>
        </div>

        <div>
          <Label>Recipients — choose from your team</Label>

          {/* Selected chips */}
          {recipients.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {recipients.map(email => {
                const u = usersByEmail.get(email)
                return (
                  <span key={email} className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 ring-1 ring-blue-100 rounded-full pl-2.5 pr-1 py-0.5 text-xs">
                    {u?.name ?? email}
                    <button
                      type="button"
                      onClick={() => toggle(email)}
                      className="hover:bg-blue-100 rounded-full p-0.5"
                      aria-label={`Remove ${u?.name ?? email}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                )
              })}
            </div>
          )}

          {/* Search + checklist of users */}
          <div className="relative mt-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Search a name, email or role…"
              className="w-full rounded-lg border border-gray-300 bg-white pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>
          <div className="mt-1.5 max-h-56 overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-100">
            {filtered.length === 0 ? (
              <p className="px-3 py-3 text-xs text-gray-400">No users match “{q}”.</p>
            ) : (
              filtered.map(u => (
                <label key={u.email} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={selected.has(u.email)}
                    onChange={() => toggle(u.email)}
                    className="h-4 w-4 flex-shrink-0"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm text-gray-900 truncate">{u.name}</span>
                    <span className="block text-[11px] text-gray-500 truncate">
                      {u.email}{u.role ? ` · ${u.role}` : ''}
                    </span>
                  </span>
                </label>
              ))
            )}
          </div>

          <p className="text-xs mt-1.5 text-gray-500">
            {reportOn
              ? `On — the report emails to ${recipients.length} recipient${recipients.length === 1 ? '' : 's'} every ${dayLabel} morning.`
              : 'Off — nobody selected, so no report is sent.'}
          </p>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {msg && <p className="text-sm text-green-600">{msg}</p>}
      <div>
        <Button type="submit" disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Save settings
        </Button>
      </div>
    </form>
  )
}
