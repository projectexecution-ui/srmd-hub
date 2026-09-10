# Clean-up list — what the revamped CT Hub no longer needs (10 Sep 2026)

Aksha: "help me clean up the unwanted data which is stale from CT Hub as I am going to use the revamped version — all extra stuff I need to remove — list down."

Inventory taken from the live database (`pg_stat_user_tables`, `role_permissions`, `approval_rules`, `module_visibility`, `app_settings`, `storage.buckets`) and the repo. Database is 193 MB of the 500 MB free-plan allowance. Nothing here has been deleted; every row is a proposal with a verdict: **Safe** (nothing reads it), **Ask** (real data, superseded), **Keep**.

## A. Database tables of old modules

| Module (switch) | Tables | Rows | Verdict | Note |
|---|---|---|---|---|
| Indents / POs / GRNs / Invoices / Payments / Uploads (all OFF) | indents, indent_lines, indent_status_snapshots, purchase_orders, po_lines, grns, grn_lines, invoices, invoice_lines, payments, uploads | 0 each | **Safe** | The first-generation upload modules. Empty. |
| Vendors (OFF) | vendors | 90 | **Ask** | Superseded by IN4 parties in Masters → Contacts. Hand-typed list from May. |
| Comparison (OFF) | cmp_comparisons, cmp_items, cmp_quotes, cmp_vendors | 0 | **Safe** | |
| Blueprint demo (OFF) | blueprint_demo_requests, blueprint_demo_request_status_log | 30 / 59 | **Safe** | Demo data only. Also 6 approval_rules rows. |
| Command Centre / ecc (OFF) | ecc_accounts, ecc_items, ecc_runs | 1 / 29 / 2 | **Ask** | Phase 2 was pending your Google-access decision. Drop if not continuing. |
| Daily Site Report (OFF) | dsr_reports, dsr_tracking, dsr_attachments + bucket `site-reports` | 1 / 1 / 0 | **Safe** | One test report. |
| Established Rates (OFF) | est_categories, est_disciplines, est_rates, est_subcategories, est_upload_log, est_wo_history | 69 / 21 / 374 / 554 / 1 / 93 | **Ask** | 374 curated rates. Masters → Rates now reads IN4 live. Export to Excel first if you want a copy. |
| Inventory — old (ON, superseded by Warehouse V2) | inv_items 514, inv_stock 472, inv_stock_movements 478, inv_requests 10, inv_request_items 13, inv_request_status_log 19, inv_stock_checks 3, inv_stock_check_items 9, inv_returns 1, inv_warehouses 5, inv_engineer_projects 18, inv_project_setup 17, inv_gate_passes 0, inv_notifications 0 + bucket `inv-gate-passes` + `item-images` + 10 approval_rules + app_settings `inv_approval_mode` + module_labels row | ~1,560 | **Ask** | V1 stock was the Warehouse's opening balance (already copied). Keep 30 days after you confirm Warehouse figures, then drop. |
| Bills Booking (ON, 2 records) | bb_bills 2, bb_bill_docs 3, bb_bill_events 13, bb_desk_members 1 + bucket `bills-booking` | 19 | **Ask** | Replaced by the Bills lane. |
| Schedule (ON, 2 projects) | sched_items 112, sched_progress 148, sched_promises 8, sched_date_changes 7, sched_drawings 0, sched_drawing_revisions 0 + app_settings `sched_*` | 275 | **Keep** | The Schedule tab is on the roadmap; NGH A and Admin Block data will seed it. |
| JMR (ON, in the workspace) | jmr_* | 21 entries | **Keep** | JMR tab. |
| Warehouse V2 (ON, in the workspace) | wh_* | wh_items 2,989, wh_po 1,348 … | **Keep** | Material tab. |
| Attendance | none (never built) | — | **Safe** | Only 9 role_permissions rows and a MODULES entry. |

## B. Backups and history (size)

| Table | Rows | Size | Verdict |
|---|---|---|---|
| procurement_tracker_state_history | 157 snapshots | **81 MB** | **Ask** — keep the last 30, delete the rest; add a retention rule to the sync |
| budget_hub_state_history | 234 snapshots | 28 MB | **Ask** — same |
| contractor_report_state_history | 112 | 6.8 MB | **Ask** — same |
| supplier_report_state_history | 79 | 3 MB | **Ask** — same |
| budget_hub_state_backup_20260815, budget_hub_state_history_backup_20260815, procurement_tracker_state_backup_20260811 | one-off copies | 1.1 MB | **Safe** — August one-offs, superseded by the history tables |

## C. Configuration rows

| Where | What | Verdict |
|---|---|---|
| role_permissions | Rows for slugs no screen checks any more: attendance 9, bills-booking 6, blueprint-demo 5, comparison 10, daily-site-report 5, ecc 10, established-rates 9, grns 8, indents 9, inventory 11, invoices 8, payments 8, pos 9, projects 9, uploads 8, vendors 8 — **~130 rows** | **Safe** once the matching module is dropped (do together) |
| role_permissions | `approvals` (My Approvals power), `jmr-admin`, `budget-vs-actual`, `schedule`, `warehouse`, `jmr`, `bills-pipeline`, `stuck-bills`, `contractor-report`, `supplier-report`, `procurement-tracker`, `cost-control`, `budget-vs-actual-v2`, `admin-*` | **Keep** — the revamp's powers, or still read |
| approval_rules | blueprint-demo 6, indents 2 (old module; IN4 approvals stay in IN4), inventory 10 | **Safe** |
| module_visibility | 18 switch rows | **Keep** until the code for those modules is removed, then drop with it |
| module_labels | inventory → "Warehouse", budget-vs-actual, cost-control → "Internal Estimate", jmr | **Ask** — `cost-control` label "Internal Estimate" is stale; the revamp calls it Projects |
| app_settings | `inv_approval_mode`, `sidebar_groups` (old sidebar grouping, unused by the five-lane pane) | **Safe** |
| app_settings | `procurement_notify_*` (chase digest, still used), `sched_*`, `wh_*`, `jmr_*`, `bills_*`, `cc_*`, `in4_*`, `cthub_*`, `telegram_*`, `zoho_bp_refresh_token` (Bills pipeline) | **Keep** |
| notification_rules | Off-rows for daily_site_report_digest, inv_site_stock_reminder | **Safe** with their modules |
| Storage buckets | `site-reports`, `inv-gate-passes`, `item-images`, `bills-booking` | **Ask** — check contents, then drop with their module |

## D. Code (repo) — routes and registry

| Route(s) | Files | Verdict | Note |
|---|---|---|---|
| indents, pos, grns, invoices, vendors, uploads, comparisons, blueprint-demo, command-center, daily-site-report, established-rates, projects (old) | ~46 | **Safe** | Module OFF or dead. Remove with their MODULES entries and cron jobs (`daily-site-report`). |
| inventory | 38 | **Ask** | With the old inventory data. Cron jobs `inventory-low-stock`, `inventory-daily-report`. |
| bills-booking | 13 | **Ask** | With its data. |
| budget (BPH upload page) | 3 | **Ask** | The IN4 budget feed replaced the upload; the page is the manual fallback and holds the sub-project mapping link. Keep until the feed has run clean for a month. |
| contractor-report, supplier-report (pages) | 6 | **Ask** | Pages only — their `lib/` loaders feed the Reports tab and must stay. |
| procurement-tracker (upload view) | 8 | **Keep** | Chase notes and the daily digest still read the upload. |
| budget-vs-actual-v2 pages (print, weekly, SC presentation) | — | **Keep** | The Trustee's weekly report and Telegram captions render from them. |
| stuck-bills | 1 | **Keep** | Inside Bills. |
| schedule, jmr, warehouse pages | — | **Keep** | Parked / workspace tabs. |
| lib/modules.ts MODULES | 31 entries | Trim to what remains, in the same commit as each route removal |
| lib/cron/schedule.ts | jobs for removed modules | Remove with the module |

## Suggested order

1. **Round 1 (safe, one commit + one SQL script):** empty old-module tables (A row 1, 3, 6, attendance), the three August backup tables, blueprint-demo data + rules, indents' 2 approval_rules, `inv_approval_mode` / `sidebar_groups` settings, the dead routes and MODULES entries and their role_permissions rows.
2. **Round 2 (your call per item):** vendors, established rates (export first), ecc, module_labels "Internal Estimate" → "Projects".
3. **Round 3 (after 30 days on the revamp):** old inventory, bills booking, the BPH upload page and the two report pages; history retention on the four state tables.

Every database step is a migration file applied through the normal path, backed by a `pg_dump` of the affected tables first, and listed in CHANGELOG.md.
