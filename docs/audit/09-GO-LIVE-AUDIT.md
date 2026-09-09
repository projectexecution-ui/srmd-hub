# Go-live audit — merging `revamp-trial` into `main`, 10 Sep 2026

Aksha: "If I want to make all revamp changes in live CT Hub — will there be any issues? Highlight them; ask me one by one; go slow, it's critical."

## The shape of the merge

| Fact | Value |
|---|---|
| Commits on `revamp-trial` not on `main` | 109 |
| Commits on `main` not on the branch | 4 (the Cost Control sign-off and returned-sheet fixes of 9 Sep) |
| Merge dry run | 0 conflicts; 5 files changed on both sides merge cleanly (approvals page, dashboard, returned-to-engineer, cron schedule + its test) |
| Database migrations added by the branch | **none** — no schema change, no seed |
| Files deleted | 12 — the old `/admin/masters` screens (their URLs redirect to `/masters`) |
| Tests / build on the branch | 1,586 tests green, `tsc` and `next build` clean |

## What changes for live users the moment it merges — with NO switch

These land on `main` and show for everyone, because they are not behind the trial flag:

1. **Cost Control landing** (`/cost-control`): titled "Projects" (was "Internal Estimate"), archived projects moved to the foot, "All Working Sheets" folded into Tools, a yellow "waiting on you" count on project rows, group projects (NGH, P2, VV) open a roll-up instead of a blank estimate.
2. **Admin** (`/admin`): reorganised by job into four areas (43 screens). `/admin/masters` is gone; its links go to `/masters`.
3. **Permissions matrix** (`/admin/permissions`): the revamp shape — tabs, pills and powers; the old module rows are no longer shown. Nothing in the database changes; with no `ws:` rows every role behaves exactly as today (tested). But an admin can no longer toggle an old module (Indents, POs, Invoices…) from this screen.
4. **Indent → PO Tracker** (`/procurement-tracker`): opens on the live IN4 view by default; the upload view (chase notes, the digest's source) is one click away under "Upload-based tracker". The purchase team's habit changes.
5. **Masters** (`/masters`): a new section reachable by URL by anyone with Cost Control view — that is **all 12 roles**, including `contractor` and `viewer`. It shows supplier rates, PO histories and contractor rates.
6. **The project workspace** (`/project/<id>`): reachable by URL. Not in the sidebar (see issue A).
7. **Dashboard**: the revamp's work strip and cards.
8. **Shell**: the error boundary, the header hardening, the permission scoping in `lib/auth.ts` (behaviour unchanged with no `ws:` rows).
9. **Cron**: `in4-approvals` starts running twice a day — Atm Heads get "waiting for your approval in IN4" notices for indents, POs and WOs at Verify, and GRN notices. No rule rows exist for the three `in4_*` event types, so the default applies: in-app and e-mail on, web push off.

## Issues, ranked

### A. Nobody will see the revamp — the pane is behind the trial flag
`buildRevampNav` runs only when `IS_DEMO` is true, and `IS_DEMO` is true only on a Vercel *preview*. On `main` every user keeps today's sidebar; the workspace exists but has no door. **Decision needed:** flip for everyone, or a pilot switch (a list of users or roles in `app_settings`, no schema change), or leave it URL-only.

### B. Who sees supplier money — contractors and viewers
Today's matrix gives `contractor` and `viewer` (30 of 41 accounts) Cost Control view, and `contractor` also holds Indent → PO Tracker view. In the revamp that means: Budget tab, Indents tab (with supplier POs, rates and the approver's last-rate table), WO / PO tab (contractor rates), Masters (everyone's rates). The old screens had the same permission rows but did not put this much money on one page. **Decision needed:** narrow before go-live — e.g. take Indent → PO Tracker view off `contractor`, gate Masters on a power other than Cost Control view, or set `ws:` denies for those tabs.

### C. `/procurement-tracker` changes under the purchase team's feet
Default view flips from the upload (with chase notes and the digest) to live IN4. Chase notes and the daily digest still read the upload. **Decision needed:** keep the upload as the default on live until the notes/digest move to the live rows, or accept the flip.

### D. Function time limits on the new IN4-backed pages
The workspace routes, the Item Master and the project layout (badge counts) run live IN4 queries of 1–7 s and declare no `maxDuration`. On the Hobby plan a function may be cut at the default limit. Add `export const maxDuration = 60` to the workspace layout/pages and Item Master before merging (harmless, no cost). Fixing now.

### E. IN4 reliability on production
Production already talks to IN4 (the mirror sync): 66 successful runs in 7 days, **9 failed**. The new pages read IN4 live on every load; when IN4 is away they say so and show what they can (tested paths), but the experience degrades. Nothing to decide; know it.

### F. The Atm Head notifications go live at once
The `in4-approvals` job runs from the dispatcher on `main` twice a day. All 42 live projects have an Atm Head set, 35 are linked to IN4. First run announces everything currently at Verify (1 indent, 1 WO, 1 PO trust-wide today) and sets the GRN watermark to "now". **Decision needed:** on from the start, or add `notification_rules` rows to keep the three `in4_*` events off until you say so.

### G. Old modules remain routable
The 14 modules switched off in `module_visibility` (Indents, POs, GRNs, Invoices…) are untouched. The 4 others still on (Command Centre? no — `ecc` is off; check `bills-booking`, `inventory`, `schedule`, `jmr`…) keep their old screens by URL. Nothing breaks; nothing is removed until you remove it. Only the permissions matrix stops listing them.

### H. Bring `main`'s 4 commits into the branch first
Merge `main` into `revamp-trial`, re-run tests and build, let the preview redeploy, and only then merge to `main`. Zero conflicts predicted, but the test file for the cron schedule changed on both sides.

## Things checked and found fine
- No schema, RLS or seed changes; nothing writes to IN4.
- The trial guard (write blocking) is preview-only; production is unaffected.
- The `ws:` permission rows do not exist yet, so the ribbon equals today's gating for every role shape.
- WO / PO and PO print/ledger routes exist and are permission-gated (Cost Control view).
- Old bookmarks: `/admin/masters/*` redirect; absorbed tab URLs redirect.
