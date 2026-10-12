'use server'

import { revalidatePath } from 'next/cache'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { requireBillsAccess } from '@/lib/bills-booking/access'
import { refreshWorkOrdersFromIn4 } from '@/lib/in4/refresh-orders'

/** Pull in anything IN4 has approved since the last look — now, not at six.
 *
 *  Aksha, 15 Sep 2026: "can u give CT DISC head refresh button and above them
 *  alsp refresh button to check if ant new Approved Abstract has been completed
 *  in in4 can also help."
 *
 *  Two sweeps, the same two the cron job runs, in the same order: RAISE any
 *  bill IN4 has approved an abstract for that CT Hub does not have, then
 *  ADVANCE any bill at the Site Head whose measurement IN4 has approved. It is
 *  deliberately the same SQL the scheduled job calls, not a second copy of the
 *  rule — a hand-refresh that decided things differently from the scheduled
 *  one would be worse than no button.
 *
 *  Service role because both functions are revoked from ordinary users: nobody
 *  is acting, IN4 is, and the events say so. The gate is `requireBillsAccess`,
 *  so only someone who can already see the section can press it. */
export async function checkIn4Now(): Promise<{
  ok: boolean; error?: string; raised?: number; moved?: number; checked?: number; note?: string; read?: number
}> {
  await requireBillsAccess()

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    return { ok: false, error: 'This server is missing SUPABASE_SERVICE_ROLE_KEY, so the check cannot run here.' }
  }

  const sb = createServiceClient(url, key, { auth: { persistSession: false } })

  // Read IN4 itself first (12 Oct 2026). Until now this button only re-checked
  // CT Hub's copy, which the scheduled sync refreshes twice a day — so "Check
  // IN4" could not see anything approved since the morning. Now the work
  // orders of every live bill are re-read from IN4, then the checks run.
  let read = 0
  {
    const { data: live } = await sb.from('bb_bills').select('order_no')
      .eq('order_type', 'WO').not('current_stage', 'in', '(paid,rejected)').eq('is_example', false)
    const nos = [...new Set((live ?? []).map(r => r.order_no as string | null).filter((v): v is string => !!v))].slice(0, 80)
    if (nos.length) {
      const { data: wos } = await sb.from('in4_work_orders').select('wo_id').in('display_no', nos)
      const ids = (wos ?? []).map(w => w.wo_id as number)
      try { read = (await refreshWorkOrdersFromIn4(sb, ids)).orders }
      catch (e) { return { ok: false, error: `IN4 could not be read: ${(e as Error).message}` } }
    }
  }

  const raised = await sb.rpc('bb_rpc_raise_from_in4')
  if (raised.error) return { ok: false, error: raised.error.message }
  const advanced = await sb.rpc('bb_rpc_advance_measured')
  if (advanced.error) return { ok: false, error: advanced.error.message }
  // And the IN4 side after the CT Head — certificate raised, approved, paid.
  const tracked = await sb.rpc('bb_rpc_track_in4')
  if (tracked.error) return { ok: false, error: tracked.error.message }
  // A bill changed after the Disc Head approved it, or cancelled in IN4 (11 Oct 2026).
  const changes = await sb.rpc('bb_rpc_check_changes')
  if (changes.error) return { ok: false, error: changes.error.message }

  const r = (raised.data ?? {}) as { raised?: number; note?: string }
  const a = (advanced.data ?? {}) as { checked?: number; moved?: number }
  revalidatePath('/bills-booking')
  revalidatePath('/approvals')
  return { ok: true, raised: r.raised ?? 0, moved: a.moved ?? 0, checked: a.checked ?? 0, note: r.note, read }
}
