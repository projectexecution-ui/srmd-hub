'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, Mail } from 'lucide-react'
import type { JmrSettings } from '@/lib/types'

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

export function SettingsForm({ initial }: { initial: JmrSettings }) {
  const router = useRouter()
  const [v, setV] = useState({
    gst_rate_pct: initial.gst_rate_pct.toString(),
    weekly_report_day: initial.weekly_report_day,
    weekly_report_recipients: initial.weekly_report_recipients.join(', '),
  })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const recipientList = v.weekly_report_recipients.split(',').map(s => s.trim()).filter(Boolean)
  const reportOn = recipientList.length > 0
  const dayLabel = v.weekly_report_day.charAt(0).toUpperCase() + v.weekly_report_day.slice(1)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setMsg(null); setError(null)
    const supabase = createClient()
    const rows = [
      { key: 'jmr_gst_rate_pct',             value: v.gst_rate_pct },
      { key: 'jmr_weekly_report_day',        value: v.weekly_report_day },
      { key: 'jmr_weekly_report_recipients', value: JSON.stringify(recipientList) },
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
          value={v.gst_rate_pct}
          onChange={e => setV({ ...v, gst_rate_pct: e.target.value })}
          className="mt-1"
        />
        <p className="text-xs text-gray-500 mt-1">
          Added on top of logged cost for the GST-inclusive SPEND totals on the Dashboard &amp; Matrix.
        </p>
      </div>

      {/* Weekly report — recipients act as the on/off switch */}
      <div className="rounded-xl border border-gray-200 p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
              <Mail className="h-4 w-4 text-gray-500" /> Weekly report (auto-email)
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              A PDF of the week&apos;s logged spend, emailed automatically. Add recipients to switch it
              on — clear the box to switch it off.
            </p>
          </div>
          <span className={`flex-shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full ${reportOn ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
            {reportOn ? 'On' : 'Off'}
          </span>
        </div>

        <div className="max-w-[240px]">
          <Label>Send every</Label>
          <select
            value={v.weekly_report_day}
            onChange={e => setV({ ...v, weekly_report_day: e.target.value })}
            className="mt-1 flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
          >
            {DAYS.map(d => (
              <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>
            ))}
          </select>
        </div>

        <div>
          <Label>Recipients (comma-separated emails)</Label>
          <Input
            value={v.weekly_report_recipients}
            onChange={e => setV({ ...v, weekly_report_recipients: e.target.value })}
            placeholder="construction@srmd.org, pm@srmd.org"
            className="mt-1"
          />
          <p className="text-xs mt-1 text-gray-500">
            {reportOn
              ? `On — the report emails to ${recipientList.length} recipient${recipientList.length === 1 ? '' : 's'} every ${dayLabel} morning.`
              : 'Off — no recipients set, so no report is sent.'}
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
