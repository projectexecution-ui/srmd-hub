'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { requireBillsWrite } from '@/lib/bills-booking/access'
import { refreshWorkOrdersFromIn4 } from '@/lib/in4/refresh-orders'

/** "Refresh from IN4" on a bill — re-read this bill's work order from IN4 now
 *  (abstracts, certificates, approval trail, debit notes), then run the same
 *  bill checks the scheduled job runs: moved on, changed after approval,
 *  cancelled in IN4. Aksha, 12 Oct 2026. Read-only towards IN4. */
export async function refreshBillFromIn4(billId: string): Promise<
  { ok: true; summary: string; moved: boolean } | { ok: false; error: string }
> {
  await requireBillsWrite()
  if (!z.string().uuid().safeParse(billId).success) return { ok: false, error: 'Invalid bill' }

  // The caller's own client, so a bill they cannot see stays unseen.
  const supabase = await createClient()
  const { data: bill } = await supabase.from('bb_bills')
    .select('id, order_type, order_no, current_stage, in4_refreshed_at').eq('id', billId).maybeSingle()
  if (!bill) return { ok: false, error: 'That bill does not exist, or you cannot see it' }
  if (bill.order_type !== 'WO') {
    return { ok: false, error: 'Purchase-order bills refresh with the scheduled IN4 sync for now — only work-order bills can be re-read here.' }
  }
  const last = bill.in4_refreshed_at ? Date.parse(bill.in4_refreshed_at as string) : 0
  if (Date.now() - last < 30_000) return { ok: true, summary: 'Already read from IN4 a moment ago.', moved: false }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return { ok: false, error: 'This server cannot write the IN4 copy right now.' }
  const svc = createServiceClient(url, key, { auth: { persistSession: false } })

  const { data: wo } = await svc.from('in4_work_orders').select('wo_id').eq('display_no', (bill.order_no as string | null) ?? '').maybeSingle()
  if (!wo) return { ok: false, error: `CT Hub has no IN4 work order ${bill.order_no ?? ''} yet — the next IN4 sync brings new orders in.` }

  let r
  try {
    r = await refreshWorkOrdersFromIn4(svc, [wo.wo_id as number])
  } catch (e) {
    return { ok: false, error: `IN4 could not be read: ${(e as Error).message}` }
  }
  for (const fn of ['bb_rpc_autopick_abstract', 'bb_rpc_advance_measured', 'bb_rpc_follow_amendments', 'bb_rpc_track_in4', 'bb_rpc_check_changes']) {
    const { error } = await svc.rpc(fn)
    if (error) return { ok: false, error: `Read IN4, but the bill check failed: ${error.message}` }
  }
  await svc.from('bb_bills').update({ in4_refreshed_at: new Date().toISOString() }).eq('id', billId)
  const { data: after } = await svc.from('bb_bills').select('current_stage').eq('id', billId).maybeSingle()

  revalidatePath(`/bills-booking/${billId}`)
  revalidatePath('/bills-booking')
  const sec = (r.ms / 1000).toFixed(1)
  return {
    ok: true,
    moved: !!after && after.current_stage !== bill.current_stage,
    summary: `Read from IN4 in ${sec} s — ${r.abstractLines} abstract lines, ${r.certificates} certificates, ${r.debitNotes} debit notes.`,
  }
}
