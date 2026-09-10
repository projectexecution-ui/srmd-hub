# Who sees what in the revamp — role by role, 10 Sep 2026

Aksha: "I would like to make Live one as revamp — wait for my confirmation. I don't want anything to go through URL. What about Engineers … Parimal … Project Head … Atm Head … Trustee … Management … who all can see what all sections. Detailed analysis — I don't want any hurdle once I make it Live."

**Updated 10 Sep 2026, afternoon** — after the go-live code fixes G1–G4 and the other window's Name-layer commits (see §5).

Everything below is read from the LIVE database (`role_permissions`, `user_module_roles`, `cc_project_approvers`, `approval_rules`, `app_settings`) and the branch's code. No `ws:` tab rows exist yet, so every tab inherits its power exactly as listed.

## 1. The people (41 accounts)

| Role (label in the matrix) | Who | Effective Cost Control role |
|---|---|---|
| admin | Aksha (2 accounts) | admin |
| founder ("Trustee") | Chirag Shah | founder |
| head ("ATM HEAD") | Akshay Atmarpit, Amit Gala, Atmarpit Hiten, Atmarpit Yash | head |
| backoffice ("ct head") | Mayank Adhvaryoo | **project_head** (per-module override) |
| uploader | Parimal | **coordinator** (per-module override) |
| engineer ("site eng") | Akshay Parekh, Ambrishkumar Mistry | engineer |
| contractor ("CT OFC") | Billing Head Construction SRMD, Milan Patel | contractor |
| viewer | 31 accounts — 28 named "Anonymous", plus Ronnie (Ambrishkumar's second account), Atmarpit Yash's second account, "Sr. Civil Engineer Construction SRMD" | viewer |

Roles with rows in the matrix but **no user**: site_staff, store_manager, billing, security, hop, backoffice_backup. Ignored below.

**"Management" in code = a Cost Control reviewer**: admin, or `coordinator`, or a role that appears on an active `cc_working_sheet` approval rule — `project_head`, `head`, `founder`. So management = Aksha, Chirag, the 4 Atm Heads, Mayank, Parimal. The Internal Estimate, Approvals, Accounts and Setup follow this line. **SC Budget** is narrower: `budget-vs-actual-v2` view = admin, head, founder only (Mayank and Parimal are out, as Aksha ruled on 3 Sep).

## 2. The revamp's shape, and what each part is gated on

Left pane (`buildRevampNav`): Dashboard (all) · Projects (`cost-control` view) · Bills (`bills-pipeline` view) · Masters (`cost-control` view) · Admin (admin, portal owner, or any `admin-*` view). Below, collapsed: "Now inside a project" (old screens by their own slugs) and "Not in the revamp" (parked modules by their slugs).

Workspace tabs and their power:

| Tab | Power | Extra gate |
|---|---|---|
| Budget (By category · By order) | cost-control | By category shows the Internal Estimate to reviewers only; non-reviewers get the engineer-safe table (no IE, no Paid, no % Used), honouring `cc_eng_projects` / `cc_eng_erp` (both ON today, `cc_eng_estimates` = all) |
| Approvals · Setup | cost-control | reviewer only |
| Accounts | cost-control | reviewer AND on the named list `cc_accounts_users` (Cost Control → Settings → "Who can open Accounts"); admins always. Aksha, 10 Sep: Atm Akshay, Chirag and Admin only — **G4** |
| SC Budget | budget-vs-actual-v2 | Internal Estimate column marked CONF |
| Indents · WO / PO | procurement-tracker | — |
| Material | warehouse | — |
| JMR | jmr | — |
| Reports | contractor-report | Master Excel reviewer only; Bills section needs bills-pipeline |
| Discussions | cost-control | — |
| QC · Schedule · Drawings · Stakeholders · Consultants | cost-control | unbuilt, greyed |
| Masters lane (all 13 pages) | cost-control view | editing links = admin only |

## 3. Role by role

### Engineer — Akshay Parekh, Ambrishkumar Mistry
Pane: Dashboard, **Projects**, **Masters**. No Bills, no Admin. Collapsed: Indent → PO, Budget vs Actual (old), Warehouse, JMR, Comparisons, Established Rates (both switched off portal-wide, so hidden).
Projects lane: lands on the engineer home (own sheets only). Opening a project → the workspace.
Tabs: Budget (engineer-safe view; **the By order pill shows the WO / PO tree with each contractor's and supplier's rates** — By CT was removed on 9 Sep), Indents (incl. the Waiting-approval table with last rates), WO / PO (incl. pending yellow rows with rate deltas), Material (edit: move stock), JMR (edit: log a day), Discussions, five greyed tabs. **Hidden**: Approvals, SC Budget, Accounts, Reports, Setup.
Can do: raise and edit working sheets (cost-control edit), log JMR, move stock, comment.
Cannot: see the Internal Estimate or Paid anywhere (verified path: BudgetTab → live page → EngineerProjectView), approve anything, open Reports.

### Parimal — uploader, coordinator on Cost Control
Reviewer (visibility only; deliberately on no approval rule, so no approve button anywhere).
Pane: Dashboard, Projects, **Bills** (uploader edit), Masters. No Admin.
Tabs: Budget with the **Internal Estimate**, Approvals (all pending; no act buttons), **Setup** (coordinator has cost-control admin: create projects, disciplines, approvers, BPH sync), Indents, WO / PO (uploader edit), Material (edit), JMR (view), Reports (contractor + supplier + Bills), Discussions. **Hidden**: SC Budget.
Masters: view only (link-pinning is admin only).

### Project Head — Mayank Adhvaryoo (backoffice, project_head on Cost Control)
Reviewer. First signature on every working sheet (stage 1 of 3); Project Head on 22 projects.
Pane: Dashboard, Projects, Masters, **Admin** (backoffice holds admin-users / admin-permissions / admin-settings view + edit — he can change the permission matrix today, and therefore the tab and pill switches tomorrow). No Bills lane (no bills-pipeline row), but has stuck-bills.
Tabs: Budget with Internal Estimate, Approvals ("Waiting on me" = stage 1), Setup (cost-control edit, not admin), Indents, WO / PO (backoffice edit), Material (edit), JMR (edit), Reports (contractor + supplier; no Bills section), Discussions. **Hidden**: SC Budget (as ruled).

### Atm Head — Akshay Atmarpit, Amit Gala, Atmarpit Hiten, Atmarpit Yash (head)
Reviewer. Stage 2 signature; Atm Head on all 42 projects; the person the IN4 "at Verify" badge and notifications are aimed at.
Pane: Dashboard, Projects, **Bills** (view), Masters. No Admin.
Tabs: Budget with Internal Estimate, Approvals, **SC Budget**, Setup, Material (admin); **Accounts only for Akshay Atmarpit** once ticked on Settings (G4), JMR (edit; approves via the matrix), Reports (contractor + supplier + Bills), Discussions.
**HIDDEN: Indents and WO / PO.** The `head` row on `procurement-tracker` is `can_view = false`. So the Atm Head cannot open the two tabs built for the approver: the Waiting-approval table, the last-rate check, the yellow pending rows, the ribbon badge that says "waiting for the Atm Head", and the link inside the new IN4 notification e-mail all land on a tab the Atm Head is refused. **This is the one real blocker.** Fix: one toggle — head → Procurement → View (and Edit if they should see the approver table's controls; nothing writes to IN4 either way). No schema change.

### Trustee — Chirag Shah (founder)
Reviewer. Stage 3 signature (releases money); Trustee on 22 projects; the only role that may set the Internal Estimate.
Pane: Dashboard, Projects, Masters, **Admin** (founder holds admin-users / admin-permissions / admin-settings view + edit — same as Mayank). No Bills lane (no bills-pipeline row).
Tabs: Budget with Internal Estimate, Approvals, **SC Budget**, **Accounts** (once ticked on Settings, G4), **Setup with full admin** (founder has cost-control admin), Indents, WO / PO (founder edit), Material (view), Reports (contractor + supplier; no Bills section), Discussions. **Hidden: JMR** (founder `jmr` view = false; today's rule, unchanged).

### Viewer — 31 accounts, 28 of them "Anonymous"
Pane: Dashboard, Projects, Masters. Collapsed: Indent → PO, Budget vs Actual (old), Contractor Report, Supplier Report, Warehouse, JMR, Inventory (old).
Tabs: Budget (engineer-safe; By order / By CT pills with rates), Indents, WO / PO, Material (view), JMR (view), **Reports (contractor + supplier billing)**, Discussions. Hidden: Approvals, SC Budget, Accounts, Setup.
Every one of those powers is already granted to `viewer` today — the same money is reachable now through Contractor Report, Supplier Report and Indent → PO. What changes is that the revamp puts it on one page per project and adds Masters (every supplier's and contractor's last rate). Who the 28 Anonymous accounts are is worth knowing before that.

### CT OFC — Billing Head Construction SRMD, Milan Patel (contractor)
Pane: Dashboard, Projects, Masters. Collapsed: Indent → PO, Budget vs Actual (old), Stuck Bills, JMR.
Tabs: Budget (engineer-safe), Indents, WO / PO (contractor edit), **JMR with admin** (the matrix gives `contractor` jmr admin), Discussions. Hidden: Material, Reports, Approvals, SC Budget, Accounts.
Can do: **raise and edit working sheets** (contractor holds cost-control edit today), edit the tracker, act in JMR admin screens. Existing grants, not revamp changes — listed because the label "CT OFC" and "raise budgets" may not be what you intend.

## 4. Hurdles, ranked — what must change before "live = revamp"

| # | Hurdle | Kind | Fix |
|---|---|---|---|
| H1 | **Atm Head cannot open Indents / WO / PO** (`head` has no procurement-tracker view) — kills the approver features and the notification links | permission data | Toggle head → Procurement → View in the matrix (Aksha, live, 10 seconds) — or I seed the one row on your go |
| H2 | ~~Nothing revamped is visible on live~~ **DONE — G1** (`lib/revamp/live.ts`, `REVAMP_ON = true`): pane, project links, old-URL redirect, Admin home, work strip all follow it; the write-guard, banner and cron blocks stay preview-only | code | Revert = set the constant to false |
| H3 | **Engineers and viewers see contractor and supplier rates** — Budget's By order / By CT pills, WO / PO tab, Masters. Engineers hold no contractor-report today, yet the WO / PO tree shows per-contractor WO values and Masters shows every last rate | decision | Options: (a) accept; (b) `ws:` rows: engineer/viewer/contractor → Budget · By order and By CT off, WO / PO off, and gate Masters on something other than cost-control view; (c) narrow `viewer` and `contractor` on procurement-tracker |
| H4 | ~~Discussions shows comments on Internal Estimate sheets~~ **DONE — G2**: [IB] sheets are dropped for non-reviewers | code | — |
| H5 | Trustee and Mayank can edit the permission matrix (admin-permissions edit) — with tabs and pills now in it, they could open SC Budget or Approvals to anyone | existing, now heavier | Take admin-permissions edit off `founder` and `backoffice` unless you want them to hold it |
| H6 | 28 "Anonymous" viewer accounts (allowlist sign-ins that never set a name) reach Projects, Masters, Reports | existing | Review the list on /admin/users before go-live; a viewer with cost-control view sees every project |
| H7 | Indent → PO tracker default flips to live IN4; chase notes and the digest still read the upload | behaviour | Accept, or keep upload default until notes move to live rows |
| H8 | IN4 Atm Head notifications start at once (3 documents at Verify today); no rules rows yet, so in-app + e-mail on | behaviour | Accept, or add `notification_rules` off-rows first |
| H9 | Merge order: bring `main`'s 4 commits into the branch, rebuild, retest, preview, then merge | process | I do this on your go |

## 5. What else landed on the branch today (the other window) — and what it changes in this audit

| Commit | What | Effect on go-live |
|---|---|---|
| fccd0a6 Name layer, Phase 1 | `projects.short_name` is the display name (chip on the ribbon header, Projects landing, group roll-up, band); the old Alias chip no longer rewrites `projects.code`; categories read "Civil" not "03 Civil"; Trustee reports use CT Hub names. **Migration applied to the live DB** (additive column). | The "no schema change" line in 09-GO-LIVE-AUDIT.md is no longer true: one additive column on `projects`, already live. Nothing on `main` reads it, so live is unaffected until the merge. |
| 6545a9a Name layer, Phase 3 | Rename a category, tab or pill — everywhere, per module, or per project. Pencils on the WO/PO tree, Indents board, tracker and the ribbon ("Rename tabs"). Who may name: admin, Portal Owner, anyone in `app_settings.cthub_namers` (Parimal seeded). Storage `cthub_names`, written only via the SECURITY DEFINER RPC `set_cthub_name`. **Migration applied to the live DB** (new table + RPC). | Second additive migration already live. Parimal can rename what everyone sees — intended. No Phase 2 commit exists on the branch. |
| e3abbc9 Budget tab | The "By CT" pill removed. | One fewer place contractor totals show to engineers (H3 shrinks to By order + WO / PO + Masters). |
| 2e1858c · 981f3be · 0b5bac3 · dcec444 · ce670d5 (9 Sep) | Group projects open to a roll-up; Projects landing retitled; rate check button per order on the WO/PO tree, read over GET | Already in the audit. |

Checked and fine: Internal Estimate never renders for a non-reviewer on Budget (leaf and group), Reports' Master Excel is reviewer only, SC Budget hidden for Parimal and Mayank, Accounts / Approvals / Setup reviewer only, Bills section inside Reports needs its own power, Masters editing is admin only, no schema change anywhere, nothing writes to IN4, every old URL still resolves (redirects for absorbed tabs and `/admin/masters`).
