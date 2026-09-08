# Findings — `revamp-trial` @ 1562b42, audited 8 Sep 2026

Re-audited 9 Sep 2026 on `revamp-trial` @ a4fd4f4 after the overnight run (Steps 1–5). Read-only; the seven fixed findings were checked line by line and marked VERIFIED with the evidence under each. Nothing else changed status.

Severity: P0 wrong money / data written from the trial / exposed data · P1 a new or changed screen that does not work or excludes phones · P2 usability/performance · P3 backlog.
Status values: OPEN → FIXED (Prompt B) → VERIFIED / NOT-FIXED / REGRESSED (Prompt C).

---

### F-001 | P0 | Trial-site guard | `lib/demo-mode.ts:65-67`, `:58-64` | Status: VERIFIED
**Verified.** Re-audit 9 Sep (a4fd4f4): `lib/demo-mode.ts:152-160` intercepts `rpc` — `READ_RPCS.has(name)` passes, everything else returns `blockedBuilder('rpc:…')`; `lib/demo-mode.test.ts` blocks 7 named writers (`record_approval_event`, `bb_rpc_create_bill`, `recycle_restore` …) and lets the read list through, live untouched.
**What is wrong.** The guard blocks `insert/update/upsert/delete` and lets `rpc()` through (L65-67), on the stated assumption (L58-64) that every writing RPC is reached only via Server Actions or POST routes, which `proxy.ts` refuses. That assumption is false: 31 client components call writing RPCs directly from the browser to supabase.co, which `proxy.ts` never sees. Confirmed writers among them: `record_approval_event` (2 write statements, `supabase/migrations/20260528_approval_events.sql:53`) at `components/approvals/ApprovalActionDialog.tsx:177`, `components/cost-control/ApproveTrancheButton.tsx:189`, `app/(app)/blueprint-demo/requests/[id]/action-client.tsx:93`; `inv_rpc_backoffice_approve` (3 writes, `20260904_wave1_hygiene.sql:39`) at `ApprovalActionDialog.tsx:24`; plus `bb_rpc_create_bill` (`bills-booking/new/BillForm.tsx:47`), `bb_rpc_move` (`bills-booking/[id]/MoveActions.tsx:32`), `act_on_delete_request` (`admin/delete-requests/DeleteRequestsList.tsx:55`), `delete_user_account` (`admin/users/UsersClient.tsx:219`), `recycle_restore` (`admin/recycle-bin/RecycleBinList.tsx:32`), `admin_add_role` / `admin_deactivate_role` (`admin/permissions/PermissionsMatrix.tsx:114,132`), `notifications_clear_all` (`components/NotificationProvider.tsx:136`), and 15 `inv_rpc_*` stock operations. `lib/demo-mode.test.ts:132` asserts "ALLOWS rpc()", so the tests encode the hole.
**Why it matters.** A reviewer who opens the trial site's Cost Control approvals and clicks Approve records a real approval in the live database. The trial site's whole premise is that it cannot do that.
**Suggested fix.** In `guardQueryBuilder`/`guardSupabaseClient`, intercept `rpc` and allow only a named read list (`my_permissions`, `effective_user_role`, `can_approve`, `my_approval_inbox`, `shell_for`, `cc_ie_lock_state`, `cc_transfer_inbox`, `cc_recent_transfers`, `cc_project_transfers`, `cc_can_i_raise_transfer`, `email_delivery_health`, `list_storage_objects`, `inv_rpc_custody_*`, `blueprint_demo_sla_inbox`, `bb_stage_members`); everything else resolves to `demoBlockedResult`. Flip the test at :132. Touches the guard → confirmation rule.
**Effort:** M

### F-002 | P0 | Budget vs Actual, CT-wise pill | `lib/revamp/budget-actual-data.ts:69-70` | Status: VERIFIED
**Verified.** Re-audit 9 Sep: `lib/revamp/budget-actual-data.ts:73,75` read both tables through `fetchAll`; import at `:10`.
**What is wrong.** `in4_wo_certificates` and `in4_work_orders` are read with `.in('subproject_id', ids)` and no `.range()`. PostgREST returns at most 1,000 rows and reports no error. Raj Uphaar has 1,987 certificates across its sub-projects (SQL, 8 Sep); Certified for that project is therefore summed from roughly half its rows, and `pctUsed` (L97) is wrong with it. Work orders max 608 per project today — safe, but on the same path.
**Why it matters.** A Trustee reading "Certified" and "% Used" on the biggest project sees an understated figure with no warning.
**Suggested fix.** Read both tables through the `fetchAll` pager already in `lib/revamp/orders-tree.ts:160-175`. Add a test with >1,000 mocked rows.
**Effort:** S

### F-003 | P0 by rule (recommend P1 after judgement — Q4) | Zoho | `app/api/zoho/bp-callback/route.ts:48-59` | Status: VERIFIED
**Verified.** Re-audit 9 Sep: `app/api/zoho/bp-callback/route.ts:16` — `if (IS_DEMO) return … 403` is the first statement of `GET`.
**What is wrong.** A GET handler builds a service-role client (L48-51) and `upsert`s `zoho_bp_refresh_token` into `app_settings` (L59). Service-role clients bypass the guard (only `lib/supabase/*` are wrapped), and GET passes `proxy.ts`. Mitigation already present: `CALLBACK` is hard-coded to `https://ct-hub.vercel.app` (L8), so Zoho will never redirect to the preview; only a hand-built URL with a fresh code would reach it.
**Why it matters.** It is the one GET on the trial that writes a credential into the live database.
**Suggested fix.** `if (IS_DEMO) return 403` at the top of the handler (same for every service-role GET, see F-005).
**Effort:** S

### F-004 | P0 | RLS | policy `sched_promises_select_merged_public` on `public.sched_promises` (db-inventory.txt §3) | Status: OPEN
**What is wrong.** Role `{public}`, `USING (true OR sched_can_write())`. `public` includes `anon`; the expression is `true` for everyone. All rows readable with the public anon key, no login.
**Why it matters.** Exposed data, per this audit's own scale. Content is Schedule promise dates — not money, not personal — but the table is open.
**Suggested fix.** Change the role to `authenticated`, or the qual to `(select auth.uid()) is not null OR sched_can_write()`. Database change → confirmation rule.
**Effort:** S

### F-005 | P1 | Trial-site guard | `app/api/cost-control/backup/route.ts:108-158`; `app/api/cost-control/in4-followup/route.ts:18-24` | Status: VERIFIED
**Verified.** Re-audit 9 Sep: `app/api/cost-control/backup/route.ts:112` and `app/api/cost-control/in4-followup/route.ts:16` both refuse with 403 when `IS_DEMO`.
**What is wrong.** Service-role GET paths outside `/api/cron/` (which `proxy.ts:20` blocks). `cronBackup` uploads a workbook to storage and `upsert`s `cc_last_backup` (L147-152), gated only by `CRON_SECRET` (L111). `in4-followup` calls `cc_in4_followup_digests` with the service key (L24); I did not confirm its auth gate or whether that function writes (Q5). Twelve modules build raw service-role clients (`lib/in4/feeds.ts:68`, `sync.ts:45`, `shell.ts:48`, `cost-control/ie-notify.ts:39`, `mentions/notify.ts:29`, `telegram/cc-approval-dispatch.ts:22`, `warehouse/notify.ts:28`, `budget-v2-cached.ts:31`, `procurement/tracker-cache.ts:33`, `report-state-cache.ts:31`, plus the two routes) and none pass through `guardSupabaseClient`.
**Why it matters.** Layer 2 covers only the two cookie-based clients; every service-role write is unguarded and relies on layer 1 alone.
**Suggested fix.** One `serviceClient()` factory in `lib/supabase/service.ts` that applies the guard, and the twelve call sites import it; or refuse `IS_DEMO` at the top of each service-role GET.
**Effort:** M

### F-006 | P1 | Mobile | `app/(app)/project/[id]/BudgetTab.tsx:112-114` | Status: OPEN
**What is wrong.** The CT-wise table renders once, in an `overflow-auto max-h-[70vh]` box, with no `md:hidden` card variant. Pill 1 next to it has both (`OrdersView.tsx:212`).
**Why it matters.** Site staff on phones scroll a seven-column table sideways. AGENTS.md: every screen ships both renderings.
**Suggested fix.** Add the card list under `md:hidden`, mirroring `OrdersView.tsx:212-230`.
**Effort:** M

### F-007 | P1 | Loading states | `app/(app)/project/[id]/` and `app/(app)/masters/` (no `loading.tsx`, no `Suspense` in `layout.tsx`, `page.tsx`, `[...rest]/page.tsx`) | Status: VERIFIED
**Verified.** Re-audit 9 Sep: `app/(app)/project/[id]/loading.tsx` and `app/(app)/masters/loading.tsx` exist (header strip + ribbon + three pulse rows, heights matched). No `Suspense` around individual tabs — accepted: the route-level skeleton covers the frozen-screen case.
**What is wrong.** Every tab renders nothing until its data arrives. The WO/PO tree pages through 4,102 BOQ rows on Raj Uphaar; the print route waits on live IN4.
**Why it matters.** On a phone connection the workspace looks frozen for several seconds with no signal.
**Suggested fix.** `loading.tsx` in `project/[id]/` and `masters/` with the header skeleton; wrap heavy tabs in `Suspense`.
**Effort:** S

### F-008 | P1 | Confidentiality (latent) | `app/(app)/project/[id]/OverviewTab.tsx:20`; `lib/revamp/project-cockpit.ts:98-125` | Status: OPEN
**What is wrong.** `OverviewTab` renders `money.internalEstimate` with no reviewer check, and `loadCockpit` computes it for every caller. It is unreachable today only because `overview` is absorbed into Budget (`lib/revamp/workspace.ts:128`) and redirected at `[...rest]/page.tsx:40-43`, and parked (`tabs.ts:182`). One edit to `ABSORBED` re-exposes the Internal Estimate to all eight roles — the exact leak fixed on this branch on 7 Sep.
**Why it matters.** Internal Estimate is management-confidential; the protection here is a redirect, not a gate.
**Suggested fix.** Either delete `OverviewTab.tsx` or gate the figure on `checkIsCcReviewer()` inside it, so the file is safe regardless of routing.
**Effort:** S

### F-009 | P1 (pending browser check — Q6) | Trial UX | `proxy.ts:27-35`; `app/(app)/project/[id]/sc-budgets-actions.ts`; `cost-control/projects/[id]/setup/people-actions.ts`; `admin/email/actions.ts` | Status: OPEN
**What is wrong.** Server Actions on the trial get a JSON 403 from the proxy. `proxy.ts:28-30` says this "surfaces in the app's existing error handling". Next's action transport expects an RSC response; a JSON 403 typically throws a generic "unexpected response" client error. `BillsRefresh.tsx:55-64` avoids this by branching on `IS_DEMO` and showing a message with a link to live — the other new actions do not.
**Why it matters.** "No silent blockers": a user who clicks Save on the trial should read why nothing happened, not see a crash.
**Suggested fix.** Verify in a browser first. If it crashes, apply the `BillsRefresh` pattern (IS_DEMO branch with the live-hub link) to each new action's button.
**Effort:** S per action

### F-010 | P2 | Formatting | `lib/cost-control/approvals-inbox.ts:238`; `lib/revamp/orders-tree.ts:432`; `lib/revamp/sc-budgets.ts:288,292`; `app/(app)/project/[id]/BudgetTab.tsx:61`, `OverviewTab.tsx:73`, `ReportsTab.tsx:165`, `layout.tsx:123`; `app/(app)/cost-control/projects/[id]/page.tsx:759` | Status: OPEN
**What is wrong.** Rupee strings built by hand with `toLocaleString('en-IN')` instead of `formatINR`. Grouping is correct; paise handling and future changes to the house format are not.
**Why it matters.** Standing rule: one formatter for money, so a change lands everywhere.
**Suggested fix.** Route each through `formatINR` (or a `perSft()` helper that calls it).
**Effort:** S

### F-011 | P2 | Trial flag | `lib/revamp/tabs.ts:194` | Status: VERIFIED
**Verified.** Re-audit 9 Sep: `lib/revamp/tabs.ts:1` imports `isDemoNow` from `@/lib/demo-mode`; `:197` uses it. Same source as the guard.
**What is wrong.** Re-derives the demo condition (`NEXT_PUBLIC_DEMO_MODE === '1' || VERCEL_ENV === 'preview'`) instead of importing `IS_DEMO`. The nav gate (`NavBar.tsx:127`) and the link target can drift.
**Suggested fix.** `import { IS_DEMO }`.
**Effort:** S

### F-012 | P2 (judge — Q2) | RLS breadth | db-inventory.txt §3 | Status: OPEN
**What is wrong.** 59 policies are permissive to every logged-in user: 49 SELECT (incl. `payments`, `invoices`, `invoice_lines`, `profiles`, `procurement_tracker_state`) and 10 non-SELECT (`procurement_chase_notes`, `procurement_dropped_lines`, `blueprint_demo_requests` I/U/D, `blueprint_demo_request_status_log` I, `recycle_bin` I). Access is enforced in code via `requirePermission`, not in the database.
**Why it matters.** Any signed-in account with the anon key can read payments and write procurement notes regardless of role. Deliberate for some; decide which.
**Suggested fix.** For the five writable tables, add a role/module check to the policy. For the SELECT list, confirm intent per table.
**Effort:** M

### F-013 | P3 | Paging (latent) | `lib/revamp/tab-data.ts:381-384` | Status: VERIFIED
**Verified.** Re-audit 9 Sep: `lib/revamp/tab-data.ts:394` reads `jmr_daily_entries` through `fetchAll`; import at `:15`.
**What is wrong.** `jmr_daily_entries` read per project without `.range()`. 21 rows today; the same 1,000-row cliff as F-002 when it grows.
**Suggested fix.** Same `fetchAll`.
**Effort:** S

### F-014 | P3 | Env drift | `lib/in4/db.ts` (`IN4_DB_HOST`, `IN4_DB_NAME`, `IN4_DB_USER`, `IN4_DB_PASSWORD`, `IN4_DB_PORT`, `IN4_DEFAULTS`) | Status: OPEN
**What is wrong.** The trial needs these on Vercel's **Preview** environment, and a deployment built before they were added keeps failing. The print route's 503 already explains this.
**Suggested fix.** None in code; note in the Vercel settings checklist.
**Effort:** S

### F-015 | P3 | Hygiene | `lib/budget-v2-load.ts:44,62,68,91`; `lib/sidebar-groups.ts:31-37`; `lib/ai/index.ts:178-374` (6× `console.log`); `app/api/cron/bills-pipeline/route.ts:209-210` (TODOs) | Status: OPEN
**What is wrong.** `any` on domain data in the budget loader; token logging in production; two shipped TODOs.
**Suggested fix.** Type the budget state; drop or gate the logs; turn the TODOs into backlog items or delete.
**Effort:** S

### F-016 | P3 | Dead code | `app/(app)/project/[id]/OverviewTab.tsx`; `lib/revamp/tabs.ts:182` `PARKED_TABS` | Status: OPEN
**What is wrong.** Unreachable component kept alongside the redirect that makes it unreachable (see F-008).
**Suggested fix.** Delete with F-008, or keep and gate.
**Effort:** S

### F-017 | P3 | Structure | `lib/revamp/tabs.ts` (`PROJECT_TABS`, gates the route at `[...rest]/page.tsx:46,56,68`) vs `lib/revamp/workspace.ts` (`WORKSPACE_TABS`, drives the ribbon at `layout.tsx:65`) | Status: OPEN
**What is wrong.** Two parallel tab lists; access flags must be set in both. Drift already happened once on this branch (`reviewerOnly` on approvals).
**Suggested fix.** Derive one from the other, or a test asserting every slug's `permissionSlug`/`reviewerOnly` match.
**Effort:** M

---

## Confirmed correct (no finding)

- Same Supabase project on both branches and locally (`supabase-target.txt`).
- No migrations on revamp absent from main (`migrations-diff.txt`).
- IN4 connection read-only: all 31 `in4Query` sites open with `SELECT` (`in4-queries.txt`); the `.insert/.update/.delete` in `lib/in4/feeds.ts` and `sync.ts` are Supabase mirror writes, as expected.
- BOQ join on `ITEM_ID` (`lib/in4/boq.ts:6-9,28-35`): WO 623 item 6340 = 57,775.06 / 60,707.15 = **95.17 %**; a `BOQ_ID` join returns null (SQL, 8 Sep).
- Printed WO gross value from `WO_GROSS_VALUE` (`wo-print.ts:244,320`); rows cut out first, re-inserted last (`:82-99,139`).
- Every new route carries a `requirePermission` (see 01-NEW-ROUTES.md).
- Demo flag can never be on in production: `VERCEL_ENV === 'preview'` or explicit `NEXT_PUBLIC_DEMO_MODE=1` (`demo-mode.ts:27-28`; tests :65,70,90,95).
- Mirror fresh and at/above baseline; PO/GRN still nested only — so any screen that lists POs (`IndentViews.tsx`, procurement tracker) cannot show a PO raised outside an indent.
