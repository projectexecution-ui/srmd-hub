'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2 } from 'lucide-react'
import type { CcSettings } from '@/lib/cost-control/settings'

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

export function CcSettingsForm({ initial }: { initial: CcSettings }) {
  const router = useRouter()
  const [v, setV] = useState({ ...initial })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

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
      { key: 'cc_label_ph_checked',  value: v.label_ph_checked.trim() },
      { key: 'cc_label_atm_checked', value: v.label_atm_checked.trim() },
      { key: 'cc_label_approved',    value: v.label_approved.trim() },
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
        <p className="text-[11px] uppercase tracking-wider font-semibold text-gray-500">Features</p>
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
          label="AI review tools"
          hint="The AI checker, bifurcation and Ask-AI panels approvers use to verify a working."
          checked={v.ai_tools}
          onChange={x => setV({ ...v, ai_tools: x })}
        />
        <Toggle
          label="Comments"
          hint="Let everyone on a working sheet write comments under it."
          checked={v.comments}
          onChange={x => setV({ ...v, comments: x })}
        />
        <Toggle
          label="Billing step (IN4 entry)"
          hint="After the Trustee approves, the Billing team marks each sheet as entered in IN4. Tracking only — no money moves."
          checked={v.billing_step}
          onChange={x => setV({ ...v, billing_step: x })}
        />
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
