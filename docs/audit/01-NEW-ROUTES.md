# Routes new on `revamp-trial` (none removed from live)

`main…revamp-trial` = 0 / 63 commits. 168 pages vs 158, 72 API routes vs 71. Everything below is an addition; the parity question "what did live lose" has no rows.

| Route | Who can reach it | Data source | Mobile | Loading / empty states | Risk |
|---|---|---|---|---|---|
| `/admin/email` | `admin-settings` view (page.tsx:23); actions need `admin-settings` admin (actions.ts:39) | Supabase (`notification_*`) | 3 of 3 tsx responsive | no `loading.tsx`; 2 empty-copy strings | Low. Actions are POST → 403 on trial (see F-009) |
| `/masters` | `cost-control` view (page.tsx:13) | Supabase only — `vendors`, `wh_*`, `projects`, `profiles`, `est_wo_history` (lib/revamp/masters.ts). No `in4_*`, no live IN4 | 7 of 10 tsx responsive | no `loading.tsx`; 3 empty-copy strings | Low |
| `/masters/contacts` | `cost-control` view (:11) | as above | ✓ | none | Low |
| `/masters/items` | `cost-control` view (:12) | as above | ✓ | none | Low |
| `/masters/mapping` | `cost-control` view (:20) | as above | ✓ | none | Low |
| `/masters/projects` | `cost-control` view (:13) | as above | ✓ | none | Low |
| `/masters/stores` | `cost-control` view (:9) | as above | ✓ | none | Low |
| `/masters/trusts` | `cost-control` view (:13) | as above | ✓ | none | Low. `MasterTable.tsx:144` sticky header — verify it sits inside its own `overflow-auto` box (AGENTS.md trap) |
| `/project/[id]` (Budget vs Actual, 3 pills) | `cost-control` view at layout.tsx:33 and page.tsx:22; pill 0 renders the live IE page with its own reviewer logic | Pill 0: cc tables. Pill 1: `in4_work_orders`, `in4_indent_items`, `in4_wo_boq_items` **paged** (orders-tree.ts:160). Pill 2: `in4_work_orders`, `in4_wo_certificates` **NOT paged** (budget-actual-data.ts:69-70) | Pill 1 has table + card pair (OrdersView.tsx:212). **Pill 2 has desktop table only** (BudgetTab.tsx:112) | no `loading.tsx`, no Suspense anywhere in the segment | **P0 F-002** wrong Certified total on Raj Uphaar. P1 F-006 mobile, F-007 loading |
| `/project/[id]/[…rest]` (every other tab) | per-tab module slug at `[...rest]/page.tsx:56`; `reviewerOnly` tabs re-checked at :68; absorbed slugs redirect at :40-43 | per tab; Reports = Zoho snapshot via `reports-data.ts`; Approvals = `my_approval_inbox()` | mixed — Reports and Orders have card variants; Approvals is cards | none | P1 F-008 latent IE in unreachable `OverviewTab`; P1 F-009 Server Action 403 UX; P3 F-017 two tab lists |
| `GET /api/in4/work-order/[woId]/print` | `cost-control` view (route.ts:37) | **Live IN4** SELECTs (wo-print.ts:230-307), `Cache-Control: no-store` | HTML page; A4 print CSS | 400 / 502 / 503 pages, 503 names the missing `IN4_DB_*` var | Low. Needs `IN4_DB_HOST/NAME/USER/PASSWORD/PORT` on the Preview env (F-014) |

## Shared files the 63 commits changed (regression surface for every screen on the trial)

`components/NavBar.tsx` (+71/-), `components/nav/ProjectTree.tsx` (+57), `app/(app)/layout.tsx` (+15), `app/(app)/cost-control/projects/[id]/page.tsx` (+196), `app/(app)/cost-control/approvals/page.tsx` (471 lines moved into `lib/cost-control/approvals-inbox.ts` + `ApprovalCards.tsx`), `app/(app)/cost-control/projects/[id]/setup/page.tsx` (+125), `lib/supabase/client.ts` + `server.ts` (guard wrapper), `proxy.ts` (+33), `next.config.ts` (+8).

None of these shows a dead action or broken link by inspection. `NavBar.tsx:127` gates the revamp navigation on `IS_DEMO`, so on a non-preview build these files behave as on live.
