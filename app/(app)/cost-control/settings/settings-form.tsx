'use client'
// Internal Estimate settings — four cards, every control saves the moment it
// changes (Aksha, 23 Sep 2026, decision S1).
//
// What it replaced: one long form of 20 controls in 8 groups, where three
// switches saved instantly and seventeen waited for a "Save settings" button
// at the very bottom ("which ones saved?"). Two people-lists here duplicated
// People › Powers (same setting keys), and the Telegram switches duplicated
// Messages. Those live in one place now (F5); each card says where.
//
// Writes go straight to app_settings (RLS: admin), the same rows
// lib/cost-control/settings.ts reads. Optimistic; a failed write reverts the
// control and says why.

import { useState, useTransition, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Input } from '@/components/ui/input'
import { Check, Loader2, ArrowRight } from 'lucide-react'
import type { CcSettings } from '@/lib/cost-control/settings'

type BoolKey = 'show_deadlines' | 'show_erp_columns' | 'show_per_sft' | 'comments' | 'ai_tools' | 'excel_microsoft'
  | 'billing_step' | 'ie_review' | 'bph_sync' | 'cumulative_versions' | 'eng_projects' | 'eng_erp'
type TextKey = 'label_ph_checked' | 'label_atm_checked' | 'label_approved'

/** Setting → app_settings key. One table, so a rename here cannot drift from the reader. */
const KEY: Record<BoolKey | TextKey | 'eng_estimates', string> = {
  show_deadlines: 'cc_show_deadlines', show_erp_columns: 'cc_show_erp_columns', show_per_sft: 'cc_show_per_sft',
  comments: 'cc_comments', ai_tools: 'cc_ai_tools', excel_microsoft: 'cc_excel_microsoft',
  billing_step: 'cc_billing_step', ie_review: 'cc_ie_review', bph_sync: 'cc_bph_sync', cumulative_versions: 'cc_cumulative_versions',
  eng_projects: 'cc_eng_projects', eng_erp: 'cc_eng_erp', eng_estimates: 'cc_eng_estimates',
  label_ph_checked: 'cc_label_ph_checked', label_atm_checked: 'cc_label_atm_checked', label_approved: 'cc_label_approved',
}

interface SwitchDef { key: BoolKey; label: string; hint: string; more?: string }

const SHOW: SwitchDef[] = [
  { key: 'show_deadlines', label: 'Deadlines', hint: 'Deadline dates on sheets and project rows.' },
  { key: 'show_erp_columns', label: 'Budget (ERP) · WO / PO · Paid', hint: 'The IN4 figures on the Internal Estimate.' },
  { key: 'show_per_sft', label: '₹ per sft', hint: 'The small rate line under every money figure.' },
  { key: 'comments', label: 'Comments', hint: 'Comments under each working sheet.' },
  { key: 'ai_tools', label: 'AI review tools', hint: 'The checker, bifurcation and Ask-AI panels for approvers.' },
  { key: 'excel_microsoft', label: 'Excel preview via Microsoft', hint: 'Pixel-perfect, but sends the file to Microsoft.', more: 'Off keeps the preview inside the app. On renders through Office Online, which receives and may cache the file.' },
]
const PROCESS: SwitchDef[] = [
  { key: 'billing_step', label: 'Billing step (IN4 entry)', hint: 'After the Trustee approves, Billing marks each sheet as entered in IN4.', more: 'Tracking only — no money moves. Off hides the queue, the chips and the banner note.' },
  { key: 'ie_review', label: 'Trustee accepts or rejects each estimate', hint: 'Off: the uploaded estimate is simply the baseline.', more: 'On: Trustee / Admin must ✓ or ✗ each sub-skill’s Internal Estimate, on the desktop row and the phone card.' },
  { key: 'bph_sync', label: 'BPH auto-sync', hint: 'IN4’s budget report fills Budget (ERP), WO and Paid.', more: 'Off hides Sync from BPH, the dashboard chip and the Map / Import doors, and no automatic pull runs. Figures already pulled stay.' },
  { key: 'cumulative_versions', label: 'Cumulative BOQ across versions', hint: 'The standard template, cumulative view, in-app revisions and sub-skill ledger.', more: 'Off keeps today’s flow exactly. Flip on to trial, off to revert — no code change either way. Existing approved sheets are untouched.' },
]
const ENGINEER: SwitchDef[] = [
  { key: 'eng_projects', label: 'Engineers can open a project page', hint: 'The safe view: categories, sub-skills, Awaiting approval.', more: 'Off: they are told project pages are closed and sent to their working sheets.' },
  { key: 'eng_erp', label: 'Engineers see Budget (ERP) and WO / PO', hint: 'The money columns on their project view.', more: 'Off: structure and Awaiting approval only. The Internal Estimate, Paid and % used are always hidden from engineers, whatever you pick.' },
]

const LABELS: Array<[TextKey, string]> = [
  ['label_ph_checked', 'Project Head’s checked-amount field'],
  ['label_atm_checked', 'Atm Head’s checked-amount field'],
  ['label_approved', 'Trustee’s approved-amount field'],
]

export function CcSettingsForm({ initial }: { initial: CcSettings }) {
  const router = useRouter()
  const [v, setV] = useState({ ...initial })
  const [saving, setSaving] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [, start] = useTransition()

  async function write(key: string, value: string, label: string): Promise<boolean> {
    setSaving(key); setError(null); setSaved(null)
    const supabase = createClient()
    const { error } = await supabase.from('app_settings').upsert({ key, value }, { onConflict: 'key' })
    setSaving(null)
    if (error) { setError(`${label}: could not save — ${error.message}`); return false }
    setSaved(label)
    start(() => router.refresh())
    return true
  }

  async function flip(def: SwitchDef) {
    const next = !v[def.key]
    setV(p => ({ ...p, [def.key]: next }))
    const ok = await write(KEY[def.key], String(next), `${def.label} ${next ? 'on' : 'off'}`)
    if (!ok) setV(p => ({ ...p, [def.key]: !next }))
  }

  async function setScope(next: CcSettings['eng_estimates']) {
    const prev = v.eng_estimates
    setV(p => ({ ...p, eng_estimates: next }))
    const ok = await write(KEY.eng_estimates, next, 'Which sheets engineers see')
    if (!ok) setV(p => ({ ...p, eng_estimates: prev }))
  }

  async function setLabel(key: TextKey, raw: string) {
    const next = raw.trim().slice(0, 60)
    if (!next || next === initial[key]) return
    await write(KEY[key], next, 'Field name')
  }

  const rows = (defs: SwitchDef[]) => defs.map(d => (
    <SwitchRow key={d.key} label={d.label} hint={d.hint} more={d.more} on={v[d.key]} busy={saving === KEY[d.key]} onFlip={() => flip(d)} />
  ))

  return (
    <div className="space-y-4 max-w-2xl">
      {/* One status line for the whole page: what was just saved, or what failed. */}
      <div className="min-h-[22px] text-[12.5px]" aria-live="polite">
        {saving && <span className="inline-flex items-center gap-1 text-gray-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</span>}
        {!saving && saved && <span className="inline-flex items-center gap-1 text-emerald-700"><Check className="h-3.5 w-3.5" /> Saved · {saved}</span>}
        {!saving && error && <span className="text-rose-700">{error}</span>}
        {!saving && !saved && !error && <span className="text-gray-400">Every switch saves the moment you tap it.</span>}
      </div>

      <SettingsCard title="Show">{rows(SHOW)}</SettingsCard>

      <SettingsCard title="Process">{rows(PROCESS)}</SettingsCard>

      <SettingsCard
        title="Engineers"
        foot="They raise sheets only by uploading their working Excel — typed sheets and thumbrule stay management-only."
      >
        <div className="px-4 py-2.5">
          <label htmlFor="eng_estimates" className="block text-sm font-semibold text-gray-900">Which working sheets an engineer sees</label>
          <select
            id="eng_estimates"
            value={v.eng_estimates}
            onChange={e => setScope(e.target.value as CcSettings['eng_estimates'])}
            disabled={saving === KEY.eng_estimates}
            className="mt-1.5 w-full h-10 rounded-md border border-gray-300 bg-white px-2 text-sm"
          >
            <option value="all">Every sheet in Cost Control</option>
            <option value="projects">Only sheets in projects they work on</option>
            <option value="own">Only sheets they raised themselves</option>
          </select>
          <p className="mt-1 text-xs text-gray-500">“Projects they work on” = a project where they hold a sub-skill assignment or have raised a sheet.</p>
        </div>
        {rows(ENGINEER)}
      </SettingsCard>

      <SettingsCard title="Names" foot="Saved when you leave the box. Up to 60 characters.">
        {LABELS.map(([key, label]) => (
          <div key={key} className="px-4 py-2.5">
            <label htmlFor={key} className="block text-sm font-semibold text-gray-900">{label}</label>
            <Input
              id={key}
              defaultValue={initial[key]}
              maxLength={60}
              onBlur={e => setLabel(key, e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
              className="mt-1.5"
            />
          </div>
        ))}
      </SettingsCard>

      {/* Moved, not lost — one home each (F5). */}
      <section className="rounded-2xl border border-dashed border-gray-300 px-4 py-3 text-[13px] text-gray-600 space-y-1.5">
        <p className="text-[11px] uppercase tracking-wider font-semibold text-gray-500">Moved to their own home</p>
        <p><Link href="/admin/people?tab=powers" className="text-indigo-700 hover:underline font-medium">People › Powers</Link> — who may archive working sheets, who may open a project’s Accounts tab.</p>
        <p><Link href="/admin/messages?tab=alerts" className="text-indigo-700 hover:underline font-medium">Messages › Instant alerts</Link> — approve budgets from Telegram, the Trustee release digest, test cards.</p>
      </section>
    </div>
  )
}

function SettingsCard({ title, children, foot }: { title: string; children: ReactNode; foot?: string }) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
      <h2 className="px-4 py-2.5 text-[11px] uppercase tracking-wider font-semibold text-gray-500 border-b border-gray-100 bg-gray-50/60">{title}</h2>
      <div className="divide-y divide-gray-100">{children}</div>
      {foot && <div className="px-4 py-2.5 border-t border-gray-100 text-[12px] text-gray-500">{foot}</div>}
    </section>
  )
}

/** One switch, 44 px tall, with the one-line hint and the long "why" behind More. */
export function SwitchRow({ label, hint, more, on, busy, onFlip }: {
  label: string; hint: string; more?: string; on: boolean; busy: boolean; onFlip: () => void
}) {
  return (
    <div className="px-4 py-2.5">
      <button
        type="button"
        onClick={onFlip}
        disabled={busy}
        aria-pressed={on}
        className="flex w-full items-start justify-between gap-4 text-left min-h-[44px]"
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-gray-900">{label}</span>
          <span className="block text-xs text-gray-500 mt-0.5">{hint}</span>
        </span>
        <span className={`relative mt-1 inline-flex h-5 w-9 flex-shrink-0 rounded-full transition-colors ${on ? 'bg-blue-600' : 'bg-gray-300'} ${busy ? 'opacity-60' : ''}`} aria-hidden>
          <span className="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform" style={{ transform: on ? 'translateX(16px)' : 'translateX(0)' }} />
        </span>
      </button>
      {more && (
        <details className="mt-1">
          <summary className="cursor-pointer text-[11px] text-indigo-700 select-none list-none inline-flex items-center gap-1">More <ArrowRight className="h-3 w-3" /></summary>
          <p className="mt-1 text-[12px] text-gray-600">{more}</p>
        </details>
      )}
    </div>
  )
}
