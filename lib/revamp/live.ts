// THE revamp switch for the live CT Hub.
//
// Aksha, 10 Sep 2026: "I would like to make Live one as revamp … I don't want
// anything to go through URL." Until now the revamped pane, the project links,
// the Admin home and the dashboard's work strip showed only on the trial
// deployment (IS_DEMO). REVAMP_ON makes them show on live too.
//
// Two ways back, both keeping every screen gated by the permission matrix:
//   · "CT Hub V1" — the Admin toggle (app_settings.cthub_shell = 'v1'), for
//     internal use: everyone sees the previous CT Hub on their next page load,
//     no deploy. lib/revamp/shell-switch.ts reads it; revampFromSetting decides.
//   · "simon go back" — Aksha's code word: revert the merge on main and
//     redeploy the pre-revamp CT Hub (docs/audit/11-GO-LIVE-RUNBOOK.md).
//
// The write-guard, the banner and the cron blocks stay on IS_DEMO: they are
// about the trial being read-only, not about which navigation people see.
//
// Pure — no React, no Supabase — so the client NavBar and ProjectTree may
// import it and so it is unit-testable.

import { isDemoNow } from '@/lib/demo-mode'

/** The code-level master. false = the old sidebar everywhere, whatever the toggle says. */
export const REVAMP_ON = true

/** app_settings key for the Admin toggle: 'v2' (revamp, default when absent) or 'v1' (previous CT Hub). */
export const SHELL_KEY = 'cthub_shell'
export type ShellMode = 'v1' | 'v2'

/** The one decision: the trial always shows the revamp; live follows the master and then the toggle. */
export function revampFromSetting(setting: string | null | undefined, demo: boolean = isDemoNow()): boolean {
  if (demo) return true
  if (!REVAMP_ON) return false
  return setting !== 'v1'
}

/** Sync fallback for code that has no setting in hand (tests, defaults). Same answer as before the toggle existed. */
export function isRevampNow(): boolean {
  return REVAMP_ON || isDemoNow()
}
