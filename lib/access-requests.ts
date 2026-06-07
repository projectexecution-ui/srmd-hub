// Self-service access requests — the single predicate that decides whether a
// profile is a "pending request" awaiting an admin's approve/deny.
//
// Flow: anyone with the public link can sign in with Google. handle_new_user()
// creates their profile as is_active=false (unless they're allowlisted or the
// admin_email). Such a fresh, non-allowlisted, non-anonymous sign-in with no
// access_state marker is a PENDING request. Once an admin acts, access_state
// becomes 'approved' (and is_active flips true) or 'denied'.
//
// Used by both the admin queue (UsersClient) and the badge count (admin home),
// so the definition stays in exactly one place.

export interface PendingCandidate {
  email: string
  is_active: boolean
  access_state?: string | null
}

/** True when `p` is a self-service sign-in still waiting on an admin decision. */
export function isPendingAccessRequest(
  p: PendingCandidate,
  allowedEmails: Set<string>,
  adminEmail?: string | null,
): boolean {
  if (p.is_active) return false           // already in
  if (p.access_state != null) return false // already approved / denied
  const email = (p.email ?? '').toLowerCase().trim()
  if (!email) return false
  if (email.startsWith('anon-')) return false  // quick-signin throwaway accounts
  if (allowedEmails.has(email)) return false   // intentional allowlist entry (admin-deactivated, not a request)
  if (adminEmail && email === adminEmail.toLowerCase().trim()) return false
  return true
}

/** Lower-cased Set of allowlisted emails, for passing to isPendingAccessRequest. */
export function allowedEmailSet(allowed: { email: string }[]): Set<string> {
  return new Set(allowed.map(a => (a.email ?? '').toLowerCase().trim()))
}
