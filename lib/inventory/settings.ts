// Inventory ("Warehouse") module settings from public.app_settings (key/value
// rows). Mirrors lib/cost-control/settings.ts. Cached per-request; missing keys
// fall back to the code defaults, so no DB seeding is needed.

import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'

/** How much management approval stands between an engineer's request and the
 *  storekeeper issuing the material:
 *   'off'    — the storekeeper issues in-stock material directly, no Atm Head
 *              gate (fastest). A shortfall still becomes a purchase.
 *   'always' — every request needs one Atm Head OK before it can be issued.
 *
 *  A future 'threshold' mode (approve only above a ₹ value) needs per-item
 *  rates, which the catalogue doesn't carry yet — so it isn't offered here. */
export type InvApprovalMode = 'off' | 'always'

export interface InvSettings {
  approval_mode: InvApprovalMode
  /** Let engineers/storekeepers propose new items (admin approves). */
  allow_item_requests: boolean
  /** Run the daily low-stock nudge to storekeepers. */
  low_stock_alerts: boolean
  /** Require the Purpose field when raising a request. */
  require_purpose: boolean
}

export const INV_SETTINGS_DEFAULTS: InvSettings = {
  approval_mode: 'always',
  allow_item_requests: true,
  low_stock_alerts: true,
  require_purpose: false,
}

/** Pure parser — exported so tests cover defaults/overrides without Supabase. */
export function parseInvSettings(map: Record<string, string | null | undefined>): InvSettings {
  const d = INV_SETTINGS_DEFAULTS
  const bool = (k: string, fallback: boolean): boolean => {
    const v = map[k]
    if (v == null || v === '') return fallback
    return v === 'true' || v === '1' || v === 'on'
  }
  const raw = (map['inv_approval_mode'] ?? '').trim()
  const approval_mode: InvApprovalMode = raw === 'off' || raw === 'always' ? raw : d.approval_mode
  return {
    approval_mode,
    allow_item_requests: bool('inv_allow_item_requests', d.allow_item_requests),
    low_stock_alerts:    bool('inv_low_stock_alerts', d.low_stock_alerts),
    require_purpose:     bool('inv_require_purpose', d.require_purpose),
  }
}

export const getInvSettings = cache(async (): Promise<InvSettings> => {
  const supabase = await createClient()
  const { data } = await supabase
    .from('app_settings')
    .select('key, value')
    .like('key', 'inv_%')
  const map: Record<string, string> = {}
  for (const row of data ?? []) map[row.key as string] = row.value as string
  return parseInvSettings(map)
})
