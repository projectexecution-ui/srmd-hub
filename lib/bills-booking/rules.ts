// The three bill rules Aksha can switch on and off (11 Oct 2026: "if there is
// some error in Bill and if the Bill changes how can we solve that … can u
// make it in settings"). Each is an app_settings key the database reads too —
// bb_rule_on() — so switching one off here stops it everywhere at once.
// Missing = on, the same in both places.

import type { SupabaseClient } from '@supabase/supabase-js'

export const BILL_RULES = [
  {
    group: 'When a bill changes',
    key: 'bb_rule_recheck_on_change',
    label: 'Changed after approval → back to the Disc Head',
    detail: 'If the abstract in IN4 or the bill amount changes after the CT Disc Head approved it, the bill goes back to the Disc Head, shown in red as old → new, so nobody passes a figure they never saw.',
  },
  {
    group: 'When a bill changes',
    key: 'bb_rule_in4_cancelled',
    label: 'Cancelled in IN4 → flag it and tell CT Billing',
    detail: 'If the certificate is cancelled in IN4, the bill says so instead of waiting for ever. Raised again under the same bill no, it is followed again by itself; under a new no, Billing types it on the same bill.',
  },
  {
    group: 'When a bill changes',
    key: 'bb_rule_billing_correct',
    label: 'Billing can correct its entry',
    detail: 'Who entered the bill (ERP entry or CT Billing desk) or an admin can fix the amount, bill no or bill date, with a reason. Every change is kept, old → new, who and when.',
  },
  // Aksha's picks on the IN4 bill process review, 13 Oct 2026 — each can be
  // switched off here and the bill goes back to how it worked before.
  {
    group: 'Following IN4',
    key: 'bb_rule_part_paid',
    label: 'Part-paid in IN4 → Paid, saying what is left',
    detail: 'When IN4 marks a certificate Partially Paid, the bill moves to Paid and says what is left: "₹24,465 left = 2% of the basic value — TDS, not recorded in IN4", or the amount still due.',
  },
  {
    group: 'Following IN4',
    key: 'bb_rule_in4_hold',
    label: 'Hold and send-backs in IN4 show on the bill',
    detail: 'Held in IN4: the bill says by whom and why, and CT Billing is told; it lifts by itself. Sent back (ReSubmit) in IN4: the bill returns to CT Billing with IN4’s reason and moves on once it is submitted again.',
  },
  {
    group: 'Following IN4',
    key: 'bb_rule_accounts_nudge',
    label: 'Tell CT Billing when Accounts has not processed in IN4',
    detail: 'Five days after the Atm Head approves, if Accounts has not processed the certificate in IN4, CT Billing is told once. When Accounts does process it, the bill records who and when.',
  },
  {
    group: 'Following IN4',
    key: 'bb_rule_follow_amendments',
    label: 'Follow WO / PO amendments',
    detail: 'When the order is amended and approved in IN4, the bill takes the new value by itself and keeps the trail (amendment no, date, who, reason). The "amendment needed" flag clears once the bill fits.',
  },
  {
    group: 'Following IN4',
    key: 'bb_rule_attach_order',
    label: 'Attach the WO / PO to a "No WO yet" bill',
    detail: 'Once IN4 raises the order, Billing (or an admin) picks it on the bill; the bill becomes a normal WO / PO bill and CT Hub follows it into IN4.',
  },
  {
    group: 'Following IN4',
    key: 'bb_rule_auto_abstract',
    label: 'Take IN4’s approved abstract by itself',
    detail: 'At the Site Head desk, when IN4 has an approved abstract on the work order with the same bill no, it is put on the bill by itself and the Site Head is told to send it on.',
  },
  {
    group: 'Following IN4',
    key: 'bb_rule_retention_release',
    label: 'Retention release bills',
    detail: 'A "Retention release" bill type: no measurement is asked for, and it follows IN4’s Retention certificate on that work order.',
  },
  {
    group: 'Following IN4',
    key: 'bb_rule_final_no_due',
    label: 'Full & Final needs the No-Due certificate',
    detail: 'The CT Disc Head cannot forward a Full & Final bill until the No-Due certificate is attached — IN4 sends it back without one.',
  },
  {
    group: 'Following IN4',
    key: 'bb_rule_mfp_remark',
    label: 'Show the MFP remark when the Atm Head approves',
    detail: 'The approval notice shows IN4’s certificate remark and whether the "MFP AS PER COP INSTRUCTION BY …" line is in it, so it is added before Accounts processes the bill.',
  },
] as const

export type BillRuleKey = (typeof BILL_RULES)[number]['key']

const on = (v: unknown) => String(v ?? 'true').replace(/["\s]/g, '').toLowerCase() !== 'false'

export async function loadBillRules(sb: SupabaseClient): Promise<Record<BillRuleKey, boolean>> {
  const { data } = await sb.from('app_settings').select('key, value').in('key', BILL_RULES.map(r => r.key))
  const got = new Map((data ?? []).map(r => [r.key as string, r.value]))
  return Object.fromEntries(BILL_RULES.map(r => [r.key, on(got.get(r.key))])) as Record<BillRuleKey, boolean>
}
