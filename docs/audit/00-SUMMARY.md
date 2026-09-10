# CT HUB revamp audit — summary

## Re-audit after the overnight run — 9 Sep 2026, `revamp-trial` @ a4fd4f4

Read-only. Every fix was checked in the code, not taken from the changelog.

| | |
|---|---|
| Write-guard holds? | **Yes.** `rpc()` now passes only the 23 named read functions; every other RPC, and every `insert/update/upsert/delete`, resolves as a blocked result (no throw, no 500). 31 browser-side writers are covered (F-001 VERIFIED). |
| GET handlers that can write | All three refuse with 403 on the trial (F-003, F-005 VERIFIED). |
| 1,000-row cap | Both Budget-vs-Actual reads and the JMR read page through `fetchAll` (F-002, F-013 VERIFIED). |
| Loading states | `loading.tsx` on the project workspace and masters (F-007 VERIFIED). |
| IN4 read-only? | Still yes — the four new IN4 readers (PO print, PO ledger, PO payments, PO detail) are SELECT only. |
| Database | Unchanged. No migration on this branch. |
| Tests / build | 1,476 tests green; `next build` clean at every step. |

**Verdict now:** the trial site is safe to hand to reviewers **for reading**. Nothing on it can write to the live database through the app. What remains is not about the trial: F-004 and F-012 are RLS policies on the shared database (a change to live — waits for the main-branch round), and F-009 still needs one click in a browser to see how a Server Action 403 reads.

Status count: VERIFIED **7** (F-001, F-002, F-003, F-005, F-007, F-011, F-013) · OPEN **10** (F-004, F-006, F-008, F-009, F-010, F-012, F-014, F-015, F-016, F-017). Two of the ten are database changes; the rest are S/M code items in `03-BACKLOG.md`.

What the run added beyond the audit: a ledger under every WO (Step 3), the PO print in IN4's own format and a supplier ledger per PO (Step 4), and the Accounts tab (Step 5). Row by row in `CHANGELOG.md`.

---

## Original audit — 8 Sep 2026
Audited 8 Sep 2026 on `revamp-trial` (commit 1562b42). Read-only. Nothing was changed.

## Trial-site safety

| | |
|---|---|
| Database the trial reads | `hjwtjrjkmuhhbsbjsqhx` — the same one as live |
| Write-guard holds? | **No.** Two of three layers work; the third has a hole big enough to approve a budget through |
| GET handlers that can write | 3 outside the blocked `/api/cron/` family (Zoho callback, cost-control backup, IN4 follow-up), all service-role, all secret- or flow-gated |
| IN4 read-only? | Yes — every query is a SELECT and the login is read-only at the server |
| Mirror vs baseline | All 17 `in4_*` tables at or above the 6 Sep counts |
| Last sync | 8 Sep, 09:21 IST |

## Verdict

**The trial site is NOT safe to hand to staff today.** It is safe for you alone, as long as nobody clicks Approve, Move, Create bill, or Clear-all on it.

## Counts

P0 **4** · P1 **5** · P2 **4** · P3 **4** — 17 findings, 7 questions for you.

## The three things that worry me most

**1. A reviewer can approve a real budget from the trial site.**
The guard blocks form posts and blocks `.insert/.update/.delete`. It deliberately lets `rpc()` through because the permission system runs on it. But 31 buttons in the app call writing RPCs *straight from the browser to Supabase* — Approve, Approve tranche, Create bill, Move bill, Restore from recycle bin, Delete user, Clear notifications, all the warehouse stock operations. None of the three layers sees those calls. The code comment that says writers are "all reached through Server Actions or POST routes" is wrong. Fix is one allow-list in the guard; touches the guard, so it needs your yes.

**2. Budget vs Actual's "CT wise" pill shows the wrong Certified total for Raj Uphaar.**
It reads all certificates for the project in one go. Supabase silently stops at 1,000 rows. Raj Uphaar has 1,987. So roughly half its certified value is missing from that screen, and the % Used is wrong with it. The WO/PO tree next to it pages correctly; this one just didn't. Small fix, and it's money, so it goes first.

**3. One database table is readable without logging in.**
`sched_promises` (Schedule promise dates) has a policy written `true OR …` that applies to everyone including anonymous. Anyone with the public key can read every row. Not money, not personal — but a door open that should not be. One-line database change; needs your yes.

## Good news, briefly

Nothing was removed from live. No schema changes. IN4 read-only holds. The BOQ join is right (WO 623 item 6340 = 95.17%, exactly IN4's figure). Every new route is permission-gated, and the earlier Internal-Estimate leak is fixed — the one remaining copy of that figure sits on a screen that cannot be reached.

## What I did not reach

Opened 9 source files fully and read targeted excerpts of ~30 more via grep; well under the 60-file cap. Not audited: the four Zoho-fed report modules' internal logic (unchanged from live), the warehouse module, JMR, and whether a Server Action's 403 on the trial renders as a readable message or a crash — that needs a browser, not a file read (Q6).

Details: `02-FINDINGS.md`. What to fix in what order: `03-BACKLOG.md`. New screens one per row: `01-NEW-ROUTES.md`.
