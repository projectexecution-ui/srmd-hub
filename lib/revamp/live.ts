// THE revamp switch for the live CT Hub.
//
// Aksha, 10 Sep 2026: "I would like to make Live one as revamp … I don't want
// anything to go through URL." Until now the revamped pane, the project links,
// the Admin home and the dashboard's work strip showed only on the trial
// deployment (IS_DEMO). This constant makes them show on live too.
//
// To put the old sidebar back: set REVAMP_ON to false and deploy. One line, no
// data touched — every screen underneath stays gated by the permission matrix
// exactly as before, and the trial deployment keeps showing the revamp either way.
//
// The write-guard, the banner and the cron blocks stay on IS_DEMO: they are
// about the trial being read-only, not about which navigation people see.

import { isDemoNow } from '@/lib/demo-mode'

export const REVAMP_ON = true

/** Evaluated when called, so a test that flips the environment sees the change. */
export function isRevampNow(): boolean {
  return REVAMP_ON || isDemoNow()
}

/** The revamp is what people see — on live (REVAMP_ON) and on every trial deployment. */
export const IS_REVAMP = isRevampNow()
