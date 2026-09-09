# Permissions — the revamp's matrix, 10 Sep 2026

Aksha: "Make the Permission Matrix as per the revamp. Remove all old modules we are not using in the revamp views. Give the flexibility of every sub pill of the sections of the new view along with the main sections. Use the Admin hat, 30+ scenarios."

## What was built (Step 20)

- **Rows are the project workspace first.** Every tab of the ribbon (16 with Setup) and, under each, every pill (45). Each has a switch of its own per role. Stored in `role_permissions` under `ws:<tab>` and `ws:<tab>:<pill>` — the table the matrix already writes; `module_slug` is free text and `my_permissions()` / `my_shell()` return every row for the role, so **no database change**.
- **Inheritance, so day one is exactly today.** A tab with no row of its own inherits its module (Budget ← Cost Control, Indents ← Indent → PO Tracker, Material ← Warehouse …), which is how the ribbon gated before. A pill with no row inherits its tab. A dashed cell in the matrix means "inherited"; one click gives it a switch of its own; ↺ takes it back.
- **View · Edit · Admin · Delete on every tab and pill** (Step 22, Aksha) — inheriting a tab from its power and a pill from its tab until set. When a tab renders, the screens inside see what the tab and pill grant (`scopedPerms` swaps the tab's power in the request's permission map), so Edit off on Budget hides Budget's raise / act controls while Discussions keeps them. A server action is its own request and still checks the power: the tab's Edit hides the control, the power guards the write.
- **Powers** — the 13 permission slugs the revamp's screens check, named in the revamp's words (Projects, Procurement, Material In-Out, JMR, SC Budget, Reports; Bills, My Approvals, Admin). Nothing from the old module list is imported (Step 21, Aksha: "I don't want other modules in Permissions"). The old screens keep whatever rows they have; they are managed nowhere in the revamp and go when the old screens go.
- Gating honours the switches everywhere a tab or pill is reached: the ribbon (`layout.tsx`), the pill row (`Ribbon.tsx`), the tab routes (`[...rest]/page.tsx`, the Budget index `page.tsx`). A pill switched off lands on the first pill that is on; a tab switched off is not in the ribbon and its URL redirects to the dashboard. Setup's gear honours `ws:setup` on top of the reviewer flag.
- Pure model in `lib/revamp/permissions.ts`, 19 tests, including "the V2 ribbon equals the old ribbon for every role shape when no ws rows exist".

## Thirty-four scenarios, admin's hat on

| # | Scenario | What happens | Verdict |
|---|---|---|---|
| 1 | Nothing set yet — first deploy | Every tab and pill inherits; every role sees exactly what it saw yesterday. Tested for five role shapes × reviewer/non-reviewer. | ✅ by design |
| 2 | Hide the SC Budget tab from Project Heads | Click the dashed cell on *SC Budget · PROJECT HEAD* → eye-off. Tab leaves their ribbon; `/project/<id>/sc-budgets` redirects them to the dashboard. | ✅ |
| 3 | Let Engineers see SC Budget without giving them the power | Click View on the tab row → the tab appears and, because the render is scoped to the tab's flags, the report opens. Its own data writes (none on SC Budget) would still check the power. | ✅ |
| 4 | Hide only *BOQ upload* under WO / PO for Site Staff | Expand WO / PO, click the pill's cell → eye-off. The other three pills stay; `?view=3` lands on *All orders*. | ✅ |
| 5 | Hide *By CT* under Budget for everyone but Trustees | 15 clicks, or leave Trustee inherited and click the rest. (No column-wide toggle yet — see 33.) | ✅ works, ⚠️ clicks |
| 6 | Turn a tab off, then its pills | Pills of a closed tab are closed whatever their own row says; the matrix shows them dashed-grey. | ✅ tested |
| 7 | Turn a pill on for a role whose tab is off | Nothing opens until the tab is on; the cell shows eye-off (inherited from the tab) even with an allow row — the cell tooltip says why. | ✅ tested; ⚠️ the allow row stays and applies once the tab opens |
| 8 | Admin role | Locked full, purple, as before. | ✅ |
| 9 | Portal-wide module switch (module_visibility) off for Warehouse | Material tab hidden for every role regardless of ws rows — the matrix never widens what a switch has closed. | ✅ tested |
| 10 | Reviewer-only tabs (Approvals, Accounts, Setup) | Still need the Cost Control reviewer flag; a ws allow does not bypass it. Rows are badged "reviewers". | ✅ tested |
| 11 | Unbuilt tabs (QC, Schedule, Drawings, Stakeholders, Consultants) | Badged "coming soon"; inherit cost-control as the ribbon always did; can be hidden per role if the roadmap should not show. | ✅ |
| 12 | A role added tomorrow | Gets no rows → inherits everything from its modules, exactly like the old matrix. | ✅ |
| 13 | Rename a role / describe it / deactivate | Unchanged from before (portal owner). | ✅ |
| 14 | Search "BOQ upload" | Shows the pill with its tab (and the power whose hint names the tab). | ✅ tested |
| 15 | 74 rows is a lot | Pills are collapsed under their tab by default; "Show every pill" / "Tabs only" buttons. | ✅ |
| 16 | The N/M count in a role's header | Counts powers only — a tab that inherits is not a permission of its own. Tooltip says "powers this role holds". | ✅ |
| 17 | The trial site | Writes are blocked on the read-only preview: a click shows IN4/Supabase's refusal in the red banner and the cell flips back. Real on `main`. | ⚠️ expected; nothing to fix |
| 18 | Cached shell | Tab and pill writes call `bumpShell()` so the ribbon changes on the next page load, not next login. | ✅ |
| 19 | Per-user override / block (Advanced on /admin/users) | Blocks are per module slug; a blocked module hides the tabs that inherit from it. An explicit `ws:` allow would still show the tab, and the screen inside would refuse. | ⚠️ documented; per-user tab blocks are a later step |
| 20 | Deep link to a hidden pill (`?view=2`) | Redirects to the first allowed pill of the tab. | ✅ tested (landingSub) |
| 21 | Deep link to a hidden tab | Redirects to the dashboard — the same place `requirePermission` sends people today. | ✅ |
| 22 | Every pill of a tab hidden but the tab on | The tab route redirects to the dashboard (nothing to show); the ribbon still lists the tab. | ⚠️ edge — hide the tab instead; the matrix could warn (later) |
| 23 | Old URLs (wo-view, payments, decisions, overview) | Still redirect to their new tab and pill first, then the switches apply. | ✅ |
| 24 | Contractor accounts and the Reports tab | Unchanged: Reports inherits contractor-report, which contractors do not hold. | ✅ |
| 25 | Masters lane | Gated on cost-control view (every Masters page); unchanged. | ✅ |
| 26 | Audit trail | Every ws row goes through the same `role_permissions` audit trigger (who, when). | ✅ |
| 27 | Delete rules on a tab or pill | Cycle none → direct → needs approval on the row; inherited from the power / tab until set. The delete flows themselves read the power's rule today (they run as server actions), so a tab's delete rule is recorded and shown, not yet enforced by the flow. | ⚠️ stated |
| 28 | Renaming a pill in code | Its slug is derived from the label (`ws:budget:by-order`); a rename orphans the row. Tests pin every slug so a rename fails the build until the row key is considered. | ⚠️ known; slugs listed in `allWsSlugs()` |
| 29 | Two pills with the same name on one tab | Would collide; the test proves every slug unique today. | ✅ tested |
| 30 | Mobile | Same table, horizontal scroll inside its own container; ≥ 24 px cells, 44 px is not met on the cell buttons (unchanged from the old matrix). | ⚠️ inherited debt |
| 31 | Who may open this screen | `admin-permissions` Admin, as before. | ✅ |
| 32 | Which powers exist | `POWERS` in `lib/revamp/permissions.ts` — every slug a workspace tab gates on plus the portal lanes and Admin, each with a revamp name. A test fails if a tab's slug is missing from it. Old modules are not listed anywhere. | ✅ single list |
| 33 | Column-wide or row-wide actions ("hide this pill for all", "give this role every tab") | Not built — each cell is one click. | Later |
| 34 | Copy one role's switches to another | Not built. | Later |

**Net:** 24 ✅ · 7 ⚠️ documented · 3 later.
