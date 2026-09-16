'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireBillsAdmin } from '@/lib/bills-booking/access'
import { loadPickList } from '@/lib/bills-booking/wo-picker'
import { loadBookingMaps } from '@/lib/bills-booking/desks'
import { resolveBooking } from '@/lib/bills-booking/booking'
import { EXAMPLE_PLANS, buildExamples } from '@/lib/bills-booking/examples'

/**
 * Seed the twenty walkthrough bills, or take them all away again.
 *
 * Aksha, 15 Sep 2026: "remove old and todays test example and make a new set
 * of 10 Examples with this Logic / Also can u make similar for PO as well."
 * Ten contractor bills and ten vendor bills, each pinned to a real order AND
 * a real bill number, because the number is what ties the record to IN4's
 * abstract or goods receipt — see lib/bills-booking/examples.ts.
 *
 * They are built from REAL orders read out of the IN4 mirror — the
 * contractor, the ordered value, what has already been billed, the trust — so
 * the arithmetic on screen behaves the way it will on a real bill. Ten
 * invented rows would look the part and teach nothing.
 *
 * Every row carries `is_example`, which is what the money totals exclude and
 * what the badge is drawn from. One flag, so a screen cannot show the badge
 * and count the money at the same time.
 */
export async function seedExamples(): Promise<{ ok: boolean; error?: string; made?: number; skipped?: number }> {
  await requireBillsAdmin()
  const supabase = await createClient()

  const { count } = await supabase
    .from('bb_bills').select('id', { count: 'exact', head: true }).eq('is_example', true)
  if ((count ?? 0) > 0) {
    return { ok: false, error: `There are already ${count} example bills. Remove them first.` }
  }

  const [pick, maps] = await Promise.all([
    loadPickList(supabase).catch(() => ({ wos: [], pos: [], projects: [] })),
    loadBookingMaps(supabase),
  ])

  // Every example names its own order, contractor or vendor, so there is no
  // picking to do — just a lookup across both sides. An example whose order
  // has left the mirror is skipped by buildExamples rather than substituted:
  // a walkthrough on somebody else's measurement teaches the wrong thing.
  const orders = new Map([...pick.wos, ...pick.pos].map(o => [o.orderNo, o]))

  const rows = buildExamples(EXAMPLE_PLANS, orders, o => {
    const b = resolveBooking(o, maps)
    return { projectId: b.projectId, subprojectId: b.subprojectId, discipline: b.disciplineName ?? b.categoryIn4 }
  })
  let made = 0
  for (const r of rows) {
    const { error } = await supabase.rpc('bb_rpc_add_example', { p: r })
    // Stop at the first failure rather than leaving a half-seeded set that
    // looks like a flow with holes in it.
    if (error) return { ok: false, error: `${error.message} (made ${made} before stopping)` }
    made++
  }

  revalidatePath('/bills-booking')
  revalidatePath('/bills-booking/admin')
  revalidatePath('/approvals')
  return { ok: true, made, skipped: EXAMPLE_PLANS.length - made }
}

/** Remove every example bill, its history and its documents. One button,
 *  because "then we decide to remove" has to mean one click, not archaeology. */
export async function clearExamples(): Promise<{ ok: boolean; error?: string; removed?: number }> {
  await requireBillsAdmin()
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('bb_rpc_clear_examples')
  if (error) return { ok: false, error: error.message }

  revalidatePath('/bills-booking')
  revalidatePath('/bills-booking/admin')
  revalidatePath('/approvals')
  return { ok: true, removed: Number((data as { removed?: number })?.removed ?? 0) }
}
