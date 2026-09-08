# CT HUB revamp audit — summary

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
