// The three bill rules Aksha can switch on and off (11 Oct 2026: "if there is
// some error in Bill and if the Bill changes how can we solve that … can u
// make it in settings"). Each is an app_settings key the database reads too —
// bb_rule_on() — so switching one off here stops it everywhere at once.
// Missing = on, the same in both places.

import type { SupabaseClient } from '@supabase/supabase-js'

export const BILL_RULES = [
  {
    key: 'bb_rule_recheck_on_change',
    label: 'Changed after approval → back to the Disc Head',
    detail: 'If the abstract in IN4 or the bill amount changes after the CT Disc Head approved it, the bill goes back to the Disc Head, shown in red as old → new, so nobody passes a figure they never saw.',
  },
  {
    key: 'bb_rule_in4_cancelled',
    label: 'Cancelled in IN4 → flag it and tell CT Billing',
    detail: 'If the certificate is cancelled in IN4, the bill says so instead of waiting for ever. Raised again under the same bill no, it is followed again by itself; under a new no, Billing types it on the same bill.',
  },
  {
    key: 'bb_rule_billing_correct',
    label: 'Billing can correct its entry',
    detail: 'Who entered the bill (ERP entry or CT Billing desk) or an admin can fix the amount, bill no or bill date, with a reason. Every change is kept, old → new, who and when.',
  },
] as const

export type BillRuleKey = (typeof BILL_RULES)[number]['key']

const on = (v: unknown) => String(v ?? 'true').replace(/["\s]/g, '').toLowerCase() !== 'false'

export async function loadBillRules(sb: SupabaseClient): Promise<Record<BillRuleKey, boolean>> {
  const { data } = await sb.from('app_settings').select('key, value').in('key', BILL_RULES.map(r => r.key))
  const got = new Map((data ?? []).map(r => [r.key as string, r.value]))
  return Object.fromEntries(BILL_RULES.map(r => [r.key, on(got.get(r.key))])) as Record<BillRuleKey, boolean>
}
