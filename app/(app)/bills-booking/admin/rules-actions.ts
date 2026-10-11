'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireBillsAccess } from '@/lib/bills-booking/access'
import { BILL_RULES, type BillRuleKey } from '@/lib/bills-booking/rules'

/** Switch one bill rule on or off. Bills admins only; the database reads the
 *  same key (bb_rule_on), so it takes effect on the next check. */
export async function setBillRule(key: BillRuleKey, on: boolean): Promise<{ ok: boolean; error?: string }> {
  const me = await requireBillsAccess()
  if (!me.isAdmin) return { ok: false, error: 'Only a Bills admin can change these rules.' }
  if (!BILL_RULES.some(r => r.key === key)) return { ok: false, error: 'Unknown rule.' }
  const supabase = await createClient()
  const { error } = await supabase.from('app_settings').upsert({ key, value: on ? 'true' : 'false' }, { onConflict: 'key' })
  if (error) return { ok: false, error: error.code === 'DEMO_READ_ONLY' ? 'This is the trial site — nothing is saved here.' : error.message }
  revalidatePath('/bills-booking/admin')
  revalidatePath('/admin', 'layout')
  return { ok: true }
}
