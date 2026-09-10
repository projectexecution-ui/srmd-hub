// The Accounts tab is for a NAMED list of people, on top of the reviewer rule.
//
// Aksha, 10 Sep 2026: "make the Accounts Section visible only to Atm Akshay and
// Chirag and Admin — and no one else should be able to see it." Roles cannot
// draw that line (four people hold `head`), so the list is by person:
// app_settings.cc_accounts_users, edited on Cost Control → Settings → "Who can
// open Accounts". Admins and the Portal Owner always may. An empty list means
// admins only — the safe default until the two names are ticked.
//
// Applied in two places, like every other workspace gate: the ribbon
// (layout.tsx) hides the tab, and the tab's page ([...rest]/page.tsx) refuses
// the URL — so nothing "goes through URL".

import { getMyProfile, isPortalOwner } from '@/lib/auth'
import { getCcSettings } from '@/lib/cost-control/settings'

export interface AccountsReader { id: string; role: string | null; portalOwner: boolean }

/** Pure: admins and the Portal Owner always; everyone else only if listed. */
export function accountsAllowed(me: AccountsReader, allowed: readonly string[]): boolean {
  if (me.role === 'admin' || me.portalOwner) return true
  return allowed.includes(me.id)
}

export async function canOpenAccounts(): Promise<boolean> {
  const [profile, owner, settings] = await Promise.all([getMyProfile(), isPortalOwner(), getCcSettings()])
  if (!profile) return false
  return accountsAllowed({ id: profile.id, role: profile.role ?? null, portalOwner: owner }, settings.accounts_users)
}
