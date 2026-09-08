# Backlog — ordered for execution

Each batch fits one Sonnet/Opus session under Prompt B. Items marked **[confirm]** trigger the confirmation rule; list them at the start of the batch and wait for Aksha's yes per item. Branch `revamp-trial`; never `main`. Tick with `[x]` and set the finding's Status in `02-FINDINGS.md` to FIXED.

## Batch 1 — stop the trial site writing (P0)

- [ ] **F-001 [confirm: touches the guard]** In `lib/demo-mode.ts`, intercept `rpc` in `guardSupabaseClient`: allow a named read list (`my_permissions`, `effective_user_role`, `can_approve`, `my_approval_inbox`, `shell_for`, `cc_ie_lock_state`, `cc_transfer_inbox`, `cc_recent_transfers`, `cc_project_transfers`, `cc_can_i_raise_transfer`, `email_delivery_health`, `list_storage_objects`, `inv_rpc_custody_projects`, `inv_rpc_custody_prefill`, `blueprint_demo_sla_inbox`, `bb_stage_members`); every other name resolves to `demoBlockedResult('rpc:<name>')`. Flip `lib/demo-mode.test.ts:132` to assert a writer is blocked and a reader passes. Verify: on the trial, open any Cost Control approval and click Approve → the blocked message, and `cc_approvals` unchanged (SQL). Then load the dashboard → it still renders (permissions RPCs pass).
- [ ] **F-003** `app/api/zoho/bp-callback/route.ts`: first line of `GET`, `if (IS_DEMO) return NextResponse.json({ ok:false, error: DEMO_BLOCKED_MESSAGE }, { status: 403 })`. Verify: `GET /api/zoho/bp-callback?code=x` on the trial → 403.
- [ ] **F-005** Same `IS_DEMO` refusal at the top of `cronBackup` in `app/api/cost-control/backup/route.ts:108` and of `GET` in `app/api/cost-control/in4-followup/route.ts`. Then create `lib/supabase/service.ts` exporting `createServiceClient()` that wraps `@supabase/supabase-js` with `guardSupabaseClient`, and switch the twelve raw call sites listed in F-005 to it. Verify: `git grep "createClient as createServiceClient"` returns only `lib/supabase/service.ts`.
- [ ] Append to `docs/audit/CHANGELOG.md`. Run `npx vitest run` and `npx next build`; push to `revamp-trial`.

## Batch 2 — wrong money (P0)

- [ ] **F-002** `lib/revamp/budget-actual-data.ts:68-71`: replace both reads with the `fetchAll` pager (copy from `lib/revamp/orders-tree.ts:160-175` or export it from a shared module). Add a unit test feeding 1,500 certificate rows and asserting the sum includes all of them. Verify: open Raj Uphaar → Budget → CT wise; Certified total should rise, and match `select sum(certified_amt) from in4_wo_certificates c join in4_subprojects s on s.id=c.subproject_id where s.project_id=8`.
- [ ] **F-013** Same pager on `lib/revamp/tab-data.ts:381`.
- [ ] Changelog, tests, build, push.

## Batch 3 — database policies (P0 + judgement) — every item **[confirm: database change]**

- [ ] **F-004** Migration: `alter policy sched_promises_select_merged_public on public.sched_promises using ((select auth.uid()) is not null or sched_can_write());` (or `to authenticated`). Verify: with the anon key and no session, `select count(*) from sched_promises` → 0 rows or permission error.
- [ ] **F-012** Only after Aksha answers Q2: tighten the five writable-by-anyone policies (`procurement_chase_notes`, `procurement_dropped_lines`, `blueprint_demo_requests`, `blueprint_demo_request_status_log`, `recycle_bin`) to the module's role check. Leave SELECT-true tables unless Aksha names one.
- [ ] Changelog; migration applied via the normal path (GitHub Action on merge — so this batch may wait until the revamp is ever merged, or be applied by Aksha directly in the SQL editor).

## Batch 4 — the new workspace works on every phone and says why when blocked (P1)

- [ ] **F-009** First, verify in a browser on the trial: open `/project/<id>/sc-budgets`, change a value, Save. If the result is a crash or a generic error rather than the blocked-message, apply the `BillsRefresh.tsx:55-64` pattern (an `IS_DEMO` branch that shows the message and a link to the live hub) to the Save buttons behind `sc-budgets-actions.ts`, `setup/people-actions.ts`, `admin/email/actions.ts`.
- [ ] **F-006** `BudgetTab.tsx` CT-wise view: add an `md:hidden` card list mirroring `OrdersView.tsx:212-230`; hide the table below `md`. Verify at 375 px: no horizontal page scroll.
- [ ] **F-007** Add `app/(app)/project/[id]/loading.tsx` and `app/(app)/masters/loading.tsx` (header + three pulse rows). Verify: throttle the network, open a project → skeleton appears.
- [ ] **F-008 / F-016** Delete `app/(app)/project/[id]/OverviewTab.tsx` and its import at `[...rest]/page.tsx:8,70`, and remove `internalEstimate` from `lib/revamp/project-cockpit.ts` if no other caller needs it — or, if Aksha wants Overview back one day, gate the figure on `checkIsCcReviewer()` inside the component. **[confirm: deletes a component file]**
- [ ] Changelog, tests, build, push.

## Batch 5 — hygiene (P2/P3)

- [ ] **F-010** Route the nine hand-built rupee strings through `formatINR` (a small `perSft(amount, sft)` helper in `lib/utils`).
- [ ] **F-011** `lib/revamp/tabs.ts:194` → `import { IS_DEMO } from '@/lib/demo-mode'`.
- [ ] **F-017** Add `lib/revamp/tabs.test.ts` asserting that for every slug present in both `PROJECT_TABS` and `WORKSPACE_TABS`, `permissionSlug` and `reviewerOnly` agree.
- [ ] **F-015** Type the budget state in `lib/budget-v2-load.ts`; remove the six `console.log` in `lib/ai/index.ts` or gate on `NODE_ENV !== 'production'`; resolve the two TODOs at `app/api/cron/bills-pipeline/route.ts:209-210`.
- [ ] **F-014** No code: add `IN4_DB_HOST/NAME/USER/PASSWORD/PORT` to the Vercel **Preview** environment checklist in `docs/audit/AUDIT-PROMPT-PACK.md` §6.
- [ ] Changelog, tests, build, push.

---

## QUESTIONS for Aksha

1. **Q1 — `sched_promises` open to anonymous readers (F-004).** Is there any reason promise dates should be public? If not, Batch 3 fixes it.
2. **Q2 — 59 permissive policies (F-012).** Any signed-in account can read `payments`, `invoices`, `profiles` and write `procurement_chase_notes` / `procurement_dropped_lines` regardless of role. Deliberate (the app hides them by module) or worth tightening? Name the tables that must be tightened.
3. **Q3 — Excel upload vs IN4 sync.** `lib/in4/sync.ts:8-10`: in shadow mode the upload is the source; in live mode the sync writes as the upload would and "the upload button stays as a fallback". If someone uploads the weekly workbook and the sync also runs, which should win? Today the later one does.
4. **Q4 — Zoho callback severity (F-003).** Hard-coded live callback URL means Zoho itself can never hit the preview. Accept the P0-by-rule as P1?
5. **Q5 — `in4-followup` GET.** I did not read its auth gate or the body of `cc_in4_followup_digests`. Is that endpoint meant to be callable by a signed-in user, or cron-only?
6. **Q6 — Server Action 403 on the trial (F-009).** Needs a browser: does Save on `/project/<id>/sc-budgets` show the blocked message or a crash? One click on the trial answers it.
7. **Q7 — Overview tab.** It is parked and unreachable but still holds the Internal Estimate. Delete it, or keep it gated for later?
