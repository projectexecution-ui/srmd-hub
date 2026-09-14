'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireBillsWrite } from '@/lib/bills-booking/access'
import { loadPickList } from '@/lib/bills-booking/wo-picker'
import { loadBookingMaps } from '@/lib/bills-booking/desks'
import { resolveBooking } from '@/lib/bills-booking/booking'
import { EXAMPLE_PLANS, buildExamples } from '@/lib/bills-booking/examples'

/**
 * Seed the ten walkthrough bills, or take them all away again.
 *
 * Aksha, 14 Sep 2026: "make few 10 Live Examples - simple and complex in the
 * Admin page which i can check and review and then we decide to remove."
 *
 * They are built from REAL work orders read out of the IN4 mirror — the
 * contractor, the ordered value, what has already been billed, the trust — so
 * the arithmetic on screen behaves the way it will on a real bill. Ten
 * invented rows would look the part and teach nothing.
 *
 * Every row carries `is_example`, which is what the money totals exclude and
 * what the badge is drawn from. One flag, so a screen cannot show the badge
 * and count the money at the same time.
 */
export async function seedExamples(): Promise<{ ok: boolean; error?: string; made?: number; skipped?: number }> {
  await requireBillsWrite()
  const supabase = await createClient()

  const { count } = await supabase
    .from('bb_bills').select('id', { count: 'exact', head: true }).eq('is_example', true)
  if ((count ?? 0) > 0) {
    return { ok: false, error: `There are already ${count} example bills. Remove them first.` }
  }

  const [pick, maps] = await Promise.all([
    loadPickList(supabase).catch(() => ({ wos: [], projects: [] })),
    loadBookingMaps(supabase),
  ])

  // Work orders that still have room to bill against, so the figures land
  // inside a real order rather than beside it. Example 9 wants one on a
  // building CT Hub has no project for — the case that covers most of the
  // money — so that one is picked deliberately rather than taken in turn.
  const usable = pick.wos.filter(w => w.balance > 0 && w.contractor && w.subprojectId != null)
  const unmapped = usable.filter(w => !resolveBooking(w, maps).projectId)
  const mapped = usable.filter(w => resolveBooking(w, maps).projectId)

  const chosen = [...mapped.slice(0, 6), unmapped[0] ?? mapped[6], mapped[7] ?? mapped[6]]
    .filter((w): w is NonNullable<typeof w> => !!w)

  const rows = buildExamples(EXAMPLE_PLANS, chosen, wo => {
    const b = resolveBooking(wo, maps)
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
  await requireBillsWrite()
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('bb_rpc_clear_examples')
  if (error) return { ok: false, error: error.message }

  revalidatePath('/bills-booking')
  revalidatePath('/bills-booking/admin')
  revalidatePath('/approvals')
  return { ok: true, removed: Number((data as { removed?: number })?.removed ?? 0) }
}
