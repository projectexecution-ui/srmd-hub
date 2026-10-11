'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requireBillsWrite } from '@/lib/bills-booking/access'

/** Billing corrects its own entry — amount, bill no, bill date — with a reason.
 *  Every rule (who, when, the switch, re-checking a figure the Disc Head had
 *  already approved) lives in bb_rpc_correct_bill. Aksha, 11 Oct 2026. */
export async function correctBill(input: {
  billId: string
  claimed: number | null
  billNo: string | null
  billDate: string | null
  reason: string
}): Promise<{ ok: true; sentBack: boolean } | { ok: false; error: string }> {
  await requireBillsWrite()
  const parsed = z.object({
    billId: z.string().uuid(),
    claimed: z.number().finite().positive('Enter the bill amount').nullable(),
    billNo: z.string().trim().max(80).nullable(),
    billDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    reason: z.string().trim().min(1, 'Say why it is being corrected').max(500),
  }).safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  const v = parsed.data

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('bb_rpc_correct_bill', {
    p_bill: v.billId, p_claimed: v.claimed, p_bill_no: v.billNo || null, p_bill_date: v.billDate, p_reason: v.reason,
  })
  if (error) return { ok: false, error: error.message.replace(/^ERROR:\s*/i, '') }
  revalidatePath(`/bills-booking/${v.billId}`)
  revalidatePath('/bills-booking')
  return { ok: true, sentBack: Boolean((data as { sent_back?: boolean } | null)?.sent_back) }
}
