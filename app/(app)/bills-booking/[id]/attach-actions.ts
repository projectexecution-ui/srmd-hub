'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireBillsAccess } from '@/lib/bills-booking/access'

/** Attach the WO / PO IN4 has now raised to a bill entered with none (Aksha,
 *  13 Oct 2026). The database checks who may, and that the order is IN4's. */
export async function attachOrder(billId: string, orderNo: string): Promise<{ ok: boolean; error?: string }> {
  await requireBillsAccess()
  const supabase = await createClient()
  const { error } = await supabase.rpc('bb_rpc_attach_order', { p_bill: billId, p_order_no: orderNo, p_reason: null })
  if (error) return { ok: false, error: error.code === 'DEMO_READ_ONLY' ? 'This is the trial site — nothing is saved here.' : error.message }
  revalidatePath(`/bills-booking/${billId}`)
  revalidatePath('/bills-booking')
  return { ok: true }
}
