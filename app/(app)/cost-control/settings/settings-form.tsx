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
      { key: 'cc_excel_microsoft',  value: String(v.excel_microsoft) },
      { key: 'cc_label_ph_checked',  value: v.label_ph_checked.trim() },
      { key: 'cc_label_atm_checked', value: v.label_atm_checked.trim() },
      { key: 'cc_label_approved',    value: v.label_approved.trim() },
      { key: 'cc_eng_estimates',    value: v.eng_estimates },
      { key: 'cc_eng_projects',     value: String(v.eng_projects) },
      { key: 'cc_eng_erp',          value: String(v.eng_erp) },
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
        <Toggle
          label="Excel preview via Microsoft Office Online"
          hint="Pixel-perfect Excel rendering — but each preview SENDS the file to Microsoft's servers (they may cache it). Off = the in-app viewer keeps everything inside your app."
          checked={v.excel_microsoft}
          onChange={x => setV({ ...v, excel_microsoft: x })}
        />
      </div>

      <div className="space-y-2">
        <p className="text-[11px] uppercase tracking-wider font-semibold text-gray-500">What engineers can see</p>
        <p className="text-xs text-gray-500">
          You decide how much of the estimate an engineer sees when they log in. Everything below is OFF/locked
          by default — engineers only see the sheets they upload until you open it up here.
        </p>
        <div className="rounded-md border border-gray-200 px-3 py-2.5">
          <span className="block text-sm font-semibold text-gray-900">Estimates an engineer can see</span>
          <span className="block text-xs text-gray-500 mt-0.5 mb-2">
            No ERP / Budget / Paid numbers are shown either way unless you turn on the toggle below.
          </span>
          <div className="flex flex-wrap gap-2">
            {([
              ['own', 'Only their own uploads'],
              ['projects', 'All estimates in their projects'],
              ['all', 'All estimates (every project)'],
            ] as const).map(([val, lbl]) => (
              <button
                key={val}
                type="button"
                onClick={() => setV({ ...v, eng_estimates: val })}
                className={`rounded-full px-3 py-1 text-xs font-semibold border ${
                  v.eng_estimates === val
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>
          {v.eng_estimates === 'projects' && (
            <p className="text-[11px] text-amber-700 mt-2">
              Needs engineers assigned to projects (in the project setup) — an engineer with no project sees nothing.
            </p>
          )}
        </div>
        <Toggle
          label="Let engineers open the Internal Estimate page"
          hint="The category / sub-skill rollup page. Off = engineers stay on their own working-sheets list."
          checked={v.eng_projects}
          onChange={x => setV({ ...v, eng_projects: x })}
        />
        <Toggle
          label="Show engineers the Budget (ERP) / WO / Paid figures"
          hint="The spend numbers from Budget vs Actual. Off = engineers never see ERP/spend even if they can open the project page."
          checked={v.eng_erp}
          onChange={x => setV({ ...v, eng_erp: x })}
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
