'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireBillsAccess } from '@/lib/bills-booking/access'

/** Save what CT Billing types on the Daily Bills Report for one bill: the
 *  courier / submission date, the remark, and the trust when the order does
 *  not say. The database decides who may (CT Billing for that bill, or a Bills
 *  admin) and says so in words when it refuses. */
export async function saveReportMark(
  billId: string,
  mark: { sentDate: string | null; remark: string | null; trust: string | null },
): Promise<{ ok: boolean; error?: string }> {
  await requireBillsAccess()
  const supabase = await createClient()
  const { error } = await supabase.rpc('bb_rpc_set_report_mark', {
    p_bill: billId, p_sent_date: mark.sentDate || null, p_remark: mark.remark || null, p_trust: mark.trust || null,
  })
  if (error) return { ok: false, error: error.code === 'DEMO_READ_ONLY' ? 'This is the trial site — nothing is saved here.' : error.message }
  revalidatePath('/bills-booking/daily-report')
  return { ok: true }
}
