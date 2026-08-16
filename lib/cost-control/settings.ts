// Cost Control module settings from public.app_settings (key/value rows).
// Cached per-request so multiple callers share one round trip. Missing keys
// fall back to the code defaults, so no DB seeding is needed.

import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'

export interface CcSettings {
  /** Show deadline chips/columns/inputs across Cost Control. */
  show_deadlines: boolean
  /** Show the Budget (ERP) / WO-PO / Paid columns + KPIs (from Budget vs Actual). */
  show_erp_columns: boolean
  /** Show the ₹/sft companion under money figures. */
  show_per_sft: boolean
  /** Show the AI review tools (check / bifurcation / Ask AI) to approvers. */
  ai_tools: boolean
  /** Show the comments panel on working sheets. */
  comments: boolean
  /** Show the Billing team's IN4-entry step (queue, chips, banner note). */
  billing_step: boolean
  /** Render the source Excel preview through Microsoft Office Online
   *  (pixel-perfect, but the file is sent to Microsoft's servers). When
   *  off, the in-app viewer renders it inside the app. */
  excel_microsoft: boolean
  /** Display label for the Project Head's checked amount. */
  label_ph_checked: string
  /** Display label for the Atm Head's checked amount. */
  label_atm_checked: string
  /** Display label for the Trustee's approved amount. */
  label_approved: string

  // ── Engineer visibility (admin decides what non-management sees) ──
  /** How many Estimate (Working Sheet) rows an engineer sees:
   *  'own'      — only sheets they created (default, most locked)
   *  'projects' — every sheet in the projects they're assigned to
   *  'all'      — every Estimate across all projects */
  eng_estimates: 'own' | 'projects' | 'all'
  /** Let engineers open the project Internal Estimate page (the
   *  category/sub-skill rollup). Off = they're redirected to their sheets. */
  eng_projects: boolean
  /** Show engineers the Budget (ERP) / WO-PO / Paid figures. Off = engineers
   *  never see the ERP/spend numbers even if they can open the project page. */
  eng_erp: boolean
  /** User ids (besides admins) allowed to archive/restore working sheets.
   *  Admin grants these from the Settings page. */
  archive_users: string[]
  /** Show the per-sub-skill Trustee/Admin accept-reject icons on the
   *  Internal Estimate. Off (default) = the uploaded estimate is simply the
   *  baseline that engineer asks are compared against (no manual step). */
  ie_review: boolean
  /** EXPERIMENTAL master switch for the cumulative-versions system: standard
   *  BOQ template, cumulative approved-vs-ask strip/table, in-app revision
   *  editor, mandatory working evidence, sub-skill ledger, cumulative email
   *  line. Off (default) = today's behaviour, unchanged. One switch to trial
   *  the whole feature and revert instantly. */
  cumulative_versions: boolean
  /** BPH → Cost Control auto-sync. Off (default) = the "Sync from BPH" button,
   *  the dashboard sync chip and the map/import entry points are hidden AND no
   *  automatic pull runs (neither the twice-daily cron nor the on-upload
   *  auto-pull), so the IN4/BPH report never touches the CC budget figures.
   *  Turn on to re-enable the whole BPH sync feature. Existing pulled figures
   *  are left as-is either way. */
  bph_sync: boolean
  /** Let approvers act on a budget from Telegram (Approve / Return buttons on
   *  the approval card in their DM). Off (default) = Telegram is notify-only,
   *  every approval happens in the app. When on, the approve still runs through
   *  the exact same approval engine (can_approve + the RPCs); it's just a second
   *  doorway. Gated per-recipient by who has connected Telegram. */
  telegram_approvals: boolean
}

export const CC_SETTINGS_DEFAULTS: CcSettings = {
  show_deadlines: false,
  show_erp_columns: true,
  show_per_sft: true,
  ai_tools: true,
  comments: true,
  billing_step: true,
  excel_microsoft: false,
  label_ph_checked: 'Project Head Checked Amt',
  label_atm_checked: 'Atm Head Checked Amt',
  label_approved: 'Approved Amount',
  eng_estimates: 'own',
  eng_projects: false,
  eng_erp: false,
  archive_users: [],
  ie_review: false,
  cumulative_versions: false,
  bph_sync: false,
  telegram_approvals: false,
}

/** Pure parser — exported so tests cover defaults/overrides without Supabase. */
export function parseCcSettings(map: Record<string, string | null | undefined>): CcSettings {
  const parseBool = (k: string, fallback: boolean): boolean => {
    const v = map[k]
    if (v == null || v === '') return fallback
    return v === 'true' || v === '1' || v === 'on'
  }
  const parseLabel = (k: string, fallback: string): string => {
    const v = (map[k] ?? '').trim()
    return v.length > 0 ? v.slice(0, 60) : fallback
  }
  const parseEngScope = (k: string, fallback: CcSettings['eng_estimates']): CcSettings['eng_estimates'] => {
    const v = (map[k] ?? '').trim()
    return v === 'own' || v === 'projects' || v === 'all' ? v : fallback
  }
  const d = CC_SETTINGS_DEFAULTS
  return {
    show_deadlines:    parseBool('cc_show_deadlines', d.show_deadlines),
    show_erp_columns:  parseBool('cc_show_erp_columns', d.show_erp_columns),
    show_per_sft:      parseBool('cc_show_per_sft', d.show_per_sft),
    ai_tools:          parseBool('cc_ai_tools', d.ai_tools),
    comments:          parseBool('cc_comments', d.comments),
    billing_step:      parseBool('cc_billing_step', d.billing_step),
    excel_microsoft:   parseBool('cc_excel_microsoft', d.excel_microsoft),
    label_ph_checked:  parseLabel('cc_label_ph_checked', d.label_ph_checked),
    label_atm_checked: parseLabel('cc_label_atm_checked', d.label_atm_checked),
    label_approved:    parseLabel('cc_label_approved', d.label_approved),
    eng_estimates:     parseEngScope('cc_eng_estimates', d.eng_estimates),
    eng_projects:      parseBool('cc_eng_projects', d.eng_projects),
    eng_erp:           parseBool('cc_eng_erp', d.eng_erp),
    archive_users:     ((map['cc_archive_users'] ?? '').match(/[0-9a-f-]{36}/gi) ?? []),
    ie_review:         parseBool('cc_ie_review', d.ie_review),
    cumulative_versions: parseBool('cc_cumulative_versions', d.cumulative_versions),
    bph_sync:          parseBool('cc_bph_sync', d.bph_sync),
    telegram_approvals: parseBool('cc_telegram_approvals', d.telegram_approvals),
  }
}

export const getCcSettings = cache(async (): Promise<CcSettings> => {
  const supabase = await createClient()
  const { data } = await supabase
    .from('app_settings')
    .select('key, value')
    .like('key', 'cc_%')
  const map: Record<string, string> = {}
  for (const row of data ?? []) map[row.key as string] = row.value as string
  return parseCcSettings(map)
})
