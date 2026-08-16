/** The two checks every warehouse write runs, in one place so the gate, the
 *  count, and the correction screens cannot drift apart on who may do what. */

import { createClient } from '@/lib/supabase/server'
import { getMyPermissions, can } from '@/lib/auth'
import { getSettings } from './data'
import { periodLockBlocker, isOn } from './settings'

/** The permissions-matrix gate. RLS checks the same thing, but a policy that
 *  filters a row out of an UPDATE returns 200 with zero rows and no error — so
 *  every action checks here first and gives a sentence a human can act on. */
export async function gate(action: 'view' | 'edit' | 'admin' = 'edit'): Promise<string | null> {
  const perms = await getMyPermissions()
  if (!can(perms, 'warehouse', action)) {
    return action === 'admin'
      ? 'Only an admin or Atm Head can do this — ask them to approve it.'
      : action === 'view'
      ? 'You do not have access to the warehouse.'
      : 'You do not have permission to record warehouse entries.'
  }
  return null
}

/** The two rules from Settings that refuse a write.
 *
 *  `entryDate` is the business date on the entry; `locationId` is the store it
 *  affects. Returns the sentence to show, or null to go ahead. */
export async function settingsBlocker(
  entryDate: string,
  locationId: string | null,
): Promise<string | null> {
  const values = await getSettings()

  const locked = periodLockBlocker(values, entryDate)
  if (locked) return locked

  // A count freezes its store: the sheet's book quantities were frozen when the
  // count started, so anything moving in between shows up as a difference that
  // is nobody's fault.
  if (locationId && isOn(values, 'wh_freeze_during_count')) {
    const sb = await createClient()
    const { data } = await sb
      .from('wh_counts')
      .select('count_no')
      .eq('location_id', locationId)
      .eq('status', 'counting')
      .limit(1)
    if (data && data.length > 0) {
      return `${data[0].count_no} is being counted in this store right now, so nothing can move in or out of it `
        + 'until that count is submitted. Finish or discard the count first.'
    }
  }
  return null
}
