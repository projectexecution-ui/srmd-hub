import { requirePermission } from '@/lib/auth'

/** The one gate for every Bills Approval screen.
 *
 *  Admin only, for now, by Aksha's decision on 13 Sep 2026 — the whole section
 *  is hidden from anyone else, in the left pane and inside each project page.
 *  That is stricter than the permissions matrix would be on its own: even a
 *  role granted `view` on bills-booking is turned away here.
 *
 *  It is deliberately one function rather than a literal repeated across five
 *  pages, because loosening it is a single edit when the desks go live. The
 *  design has Site Head, Disc Head, CT Head, Atm and Billing each seeing their
 *  own queue and nothing else; when that arrives, this becomes a per-desk check
 *  and every page picks it up at once.
 *
 *  The write guard is separate on purpose: reading the section and being able
 *  to move a bill through it are different questions, and they will stop having
 *  the same answer the moment desk users exist. */
export async function requireBillsAccess(): Promise<void> {
  await requirePermission('bills-booking', 'admin')
}

/** For anything that changes a bill. Same answer as `requireBillsAccess` today;
 *  kept apart so the two can diverge without hunting through pages. */
export async function requireBillsWrite(): Promise<void> {
  await requirePermission('bills-booking', 'admin')
}
