'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2 } from 'lucide-react'
import type { JmrSettings } from '@/lib/types'

export function SettingsForm({ initial }: { initial: JmrSettings }) {
  const router = useRouter()
  const [v, setV] = useState({
    gst_rate_pct: initial.gst_rate_pct.toString(),
    variance_tolerance_pct: initial.variance_tolerance_pct.toString(),
    variance_tolerance_min_hours: initial.variance_tolerance_min_hours.toString(),
    entry_edit_window_hours: initial.entry_edit_window_hours.toString(),
    weekly_report_day: initial.weekly_report_day,
    weekly_report_hour_ist: initial.weekly_report_hour_ist.toString(),
    weekly_report_recipients: initial.weekly_report_recipients.join(', '),
  })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setMsg(null); setError(null)
    const supabase = createClient()
    const recipients = v.weekly_report_recipients.split(',').map(s => s.trim()).filter(Boolean)
    const rows = [
      { key: 'jmr_gst_rate_pct',                value: v.gst_rate_pct },
      { key: 'jmr_variance_tolerance_pct',      value: v.variance_tolerance_pct },
      { key: 'jmr_variance_tolerance_min_hours',value: v.variance_tolerance_min_hours },
      { key: 'jmr_entry_edit_window_hours',     value: v.entry_edit_window_hours },
      { key: 'jmr_weekly_report_day',           value: v.weekly_report_day },
      { key: 'jmr_weekly_report_hour_ist',      value: v.weekly_report_hour_ist },
      { key: 'jmr_weekly_report_recipients',    value: JSON.stringify(recipients) },
    ]
    const { error } = await supabase.from('app_settings').upsert(rows, { onConflict: 'key' })
    if (error) { setError(error.message); setSaving(false); return }
    setMsg('Settings saved')
    setSaving(false)
    router.refresh()
  }

  return (
    <form onSubmit={submit} className="space-y-4 max-w-xl">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>GST rate %</Label>
          <Input type="number" step="0.01" min="0" value={v.gst_rate_pct} onChange={e => setV({ ...v, gst_rate_pct: e.target.value })} className="mt-1" />
        </div>
        <div>
          <Label>Entry edit window (hours)</Label>
          <Input type="number" min="0" value={v.entry_edit_window_hours} onChange={e => setV({ ...v, entry_edit_window_hours: e.target.value })} className="mt-1" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Variance tolerance %</Label>
          <Input type="number" step="0.1" min="0" value={v.variance_tolerance_pct} onChange={e => setV({ ...v, variance_tolerance_pct: e.target.value })} className="mt-1" />
        </div>
        <div>
          <Label>Variance min hours</Label>
          <Input type="number" step="0.1" min="0" value={v.variance_tolerance_min_hours} onChange={e => setV({ ...v, variance_tolerance_min_hours: e.target.value })} className="mt-1" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Weekly report — day</Label>
          <select
            value={v.weekly_report_day}
            onChange={e => setV({ ...v, weekly_report_day: e.target.value })}
            className="mt-1 flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
          >
            <option value="monday">Monday</option>
            <option value="tuesday">Tuesday</option>
            <option value="wednesday">Wednesday</option>
            <option value="thursday">Thursday</option>
            <option value="friday">Friday</option>
            <option value="saturday">Saturday</option>
            <option value="sunday">Sunday</option>
          </select>
        </div>
        <div>
          <Label>Weekly report — hour (IST, 0–23)</Label>
          <Input type="number" min="0" max="23" value={v.weekly_report_hour_ist} onChange={e => setV({ ...v, weekly_report_hour_ist: e.target.value })} className="mt-1" />
        </div>
      </div>
      <div>
        <Label>Weekly report recipients (comma-separated emails)</Label>
        <Input
          value={v.weekly_report_recipients}
          onChange={e => setV({ ...v, weekly_report_recipients: e.target.value })}
          placeholder="construction@srmd.org, pm@srmd.org"
          className="mt-1"
        />
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
