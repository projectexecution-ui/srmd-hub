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
  /** Display label for the Project Head's checked amount. */
  label_ph_checked: string
  /** Display label for the Atm Head's checked amount. */
  label_atm_checked: string
  /** Display label for the Trustee's approved amount. */
  label_approved: string
}

export const CC_SETTINGS_DEFAULTS: CcSettings = {
  show_deadlines: false,
  show_erp_columns: true,
  show_per_sft: true,
  ai_tools: true,
  comments: true,
  billing_step: true,
  label_ph_checked: 'Project Head Checked Amt',
  label_atm_checked: 'Atm Head Checked Amt',
  label_approved: 'Approved Amount',
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
  const d = CC_SETTINGS_DEFAULTS
  return {
    show_deadlines:    parseBool('cc_show_deadlines', d.show_deadlines),
    show_erp_columns:  parseBool('cc_show_erp_columns', d.show_erp_columns),
    show_per_sft:      parseBool('cc_show_per_sft', d.show_per_sft),
    ai_tools:          parseBool('cc_ai_tools', d.ai_tools),
    comments:          parseBool('cc_comments', d.comments),
    billing_step:      parseBool('cc_billing_step', d.billing_step),
    label_ph_checked:  parseLabel('cc_label_ph_checked', d.label_ph_checked),
    label_atm_checked: parseLabel('cc_label_atm_checked', d.label_atm_checked),
    label_approved:    parseLabel('cc_label_approved', d.label_approved),
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
