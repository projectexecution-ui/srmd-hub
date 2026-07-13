// Email Command Centre — pluggable inbox source.
//
// The triage engine (lib/ecc/triage.ts) doesn't care WHERE the emails come
// from. This adapter is the seam. Phase 1 ships `SeedSource` (no live Gmail).
// Phase 2 swaps in a real Gmail source once the access route is decided:
//   - GmailWorkspaceSource  — domain-wide delegation for @srmd.org staff
//                             (Workspace super-admin authorises once; no
//                              public Google verification needed).
//   - GmailOAuthSource      — per-user OAuth for personal @gmail.com
//                             (needs Google restricted-scope verification).
// Neither is built yet — only the seam + typed stubs are here, so turning on
// live email is a localized change, not a rewrite.

import type { RawEmail } from '@/lib/ecc/triage'

export interface EccAccount {
  id: string
  user_id: string
  email_address: string
  provider: string
  status: string
}

export interface EccSource {
  /** Human name for logs / the "source" column. */
  readonly name: string
  /** Pull raw emails from the last `windowDays` for one linked account. */
  fetchInbox(account: EccAccount, windowDays: number): Promise<RawEmail[]>
}

/**
 * Phase 1 source. Live Gmail is not wired yet, so a scheduled/live pull would
 * have nothing to read — items are seeded directly into ecc_items (see the
 * seed step in the migration/tooling). Returning [] here keeps a manual
 * "Refresh" a safe no-op until a real source is plugged in.
 */
export class SeedSource implements EccSource {
  readonly name = 'seed'
  async fetchInbox(): Promise<RawEmail[]> {
    return []
  }
}

// ── Phase 2 stubs (not wired) ───────────────────────────────────────────────

/** Domain-wide-delegated service account for @srmd.org Workspace inboxes. */
export class GmailWorkspaceSource implements EccSource {
  readonly name = 'gmail_workspace'
  async fetchInbox(): Promise<RawEmail[]> {
    throw new Error(
      'GmailWorkspaceSource not wired yet. Phase 2: register CT Hub as an internal Google Workspace app + service account with domain-wide delegation (gmail.readonly, gmail.modify), then implement this fetch.',
    )
  }
}

/** Per-user OAuth for personal @gmail.com inboxes. */
export class GmailOAuthSource implements EccSource {
  readonly name = 'gmail_oauth'
  async fetchInbox(): Promise<RawEmail[]> {
    throw new Error(
      'GmailOAuthSource not wired yet. Phase 2: per-user Google OAuth (needs restricted-scope verification), store refresh tokens, then implement this fetch.',
    )
  }
}

/** Resolve the source for an account. Phase 1 always returns SeedSource;
 *  Phase 2 will branch on account.provider / email domain. */
export function sourceForAccount(): EccSource {
  return new SeedSource()
}
