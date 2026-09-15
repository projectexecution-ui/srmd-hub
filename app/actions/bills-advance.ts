'use server'

import { revalidatePath } from 'next/cache'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { requireBillsAccess } from '@/lib/bills-booking/access'

/** Pull in anything IN4 has approved since the last look.
 *
 *  Aksha, 15 Sep 2026: "can u give CT DISC head refresh button and above them
 *  alsp refresh button to check if ant new Approved Abstract has been completed
 *  in in4 can also help."
 *
 *  It does. The mirror refreshes twice a day and the sweep rides on it, so a
 *  Site Head who gets his abstract approved at eleven would otherwise leave the
 *  Disc Head waiting until the evening for a bill that is ready now. This is
 *  the same sweep, on demand.
 *
 *  It is deliberately the SAME function the cron job calls, not a second copy
 *  of the rule — a hand-refresh that decided things differently from the
 *  scheduled one would be worse than no button.
 *
 *  Service role because `bb_rpc_advance_measured` is revoked from ordinary
 *  users: nobody is acting, IN4 is, and the event it writes says so. The gate
 *  is `requireBillsAccess` above it, so only someone who can already see the
 *  section can press it. */
export async function checkIn4Now(): Promise<{ ok: boolean; error?: string; moved?: number; checked?: number }> {
  await requireBillsAccess()

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    return { ok: false, error: 'This server is missing SUPABASE_SERVICE_ROLE_KEY, so the check cannot run here.' }
  }

  const sb = createServiceClient(url, key, { auth: { persistSession: false } })
  const { data, error } = await sb.rpc('bb_rpc_advance_measured')
  if (error) return { ok: false, error: error.message }

  const r = (data ?? {}) as { checked?: number; moved?: number }
  revalidatePath('/bills-booking')
  revalidatePath('/approvals')
  return { ok: true, moved: r.moved ?? 0, checked: r.checked ?? 0 }
}
