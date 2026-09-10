# CT HUB revamp — UX walk-through, 42 scenarios

Reviewed 8 Sep 2026 against the code on `revamp-trial` (commit 1562b42) and the design reference `docs/app-preview.html`. **Nothing has been changed.** Every suggestion below is a proposal for Aksha to accept, reject, or reshape; items marked **[confirm]** touch access, business rules or the trial guard and need an explicit yes even after this list is approved.

How to read a row: *who* is doing it, on *what device*, *what they want*, *what happens today* (with the file that decides it), *where it hurts*, *what I'd change*, and a size (S = under an hour, M = a session, L = more than one).

Personas, from the role model in `lib/modules.ts` and AGENTS.md:
- **Aksha** — PM and owner; laptop in the office, phone on site; opens 5–10 projects a day.
- **Atm Head** — approver; phone mostly; wants "what's waiting on me" and one tap to act.
- **Engineer** — raises budget requests and working sheets; must never see the Internal Estimate.
- **Parimal** (coordinator) and **Mayank** (backoffice) — reviewers with partial access; not SC Budget.
- **Trustee / management** — reads SC Budget and Reports monthly; never edits.
- **Storekeeper** — Material tab and warehouse; phone.
- **Contractor account** — two exist; sees only what its module permissions allow.

---

## A. Getting in and moving around

### 1. First landing after login — Aksha, laptop
**Today.** Dashboard with tiles; on the trial a `WorkStrip` (material requests, delete requests, comments this week, and three "last updated" stamps) sits above them (`dashboard/WorkStrip.tsx`). Approvals waiting on me appear as amber pills in the sidebar project tree.
**Friction.** The strip counts things that are mostly not Aksha's to act on (storekeeper's requests, admin's deletions), while the thing she acts on most — budget approvals — is only in the sidebar. Two "what's waiting" surfaces disagree in shape.
**Change.** One strip: *Waiting on you* (approvals · transfers · returned sheets · material · deletions), each a count with a link, ordered by count, hidden when zero. Move the three "last updated" stamps into a single grey line at the bottom. **S–M**

### 2. Finding one of 33 projects — Aksha, phone
**Today.** Sidebar tree, group → project, each branch remembers open/closed (`components/nav/ProjectTree.tsx`). No search.
**Friction.** On a phone the tree is a long scroll; the group has to be opened first; names like "NGH A" vs "New Guest House" vs "NGH Infra" need the user to know the hierarchy.
**Change.** A filter box at the top of the Projects lane (type two letters, tree collapses to matches). Recent-projects row (last 3 opened) above the tree on mobile. **S**

### 3. Switching project but keeping the tab — Aksha, laptop
**Today.** Sidebar links go to `/project/<id>` (Budget) via `projectHref()`; the tab you were on is lost.
**Change.** Sidebar link keeps the current tab slug when you're already inside a workspace (`/project/<new>/wo-po` if you were on WO/PO). Also a ⌘/Ctrl-K style "jump to project" is the laptop-native way. **S**

### 4. The ribbon on a 13-inch laptop — anyone
**Today.** Below 1180 px the labels and group names hide and only icons remain (`Ribbon.tsx:25-33`, measured). 15 tabs + Setup gear.
**Friction.** Fifteen icons with no text is a memory test; the only hint is the hover `title`. Six of the fifteen are "coming soon" (`built=false`: Accounts, QC, Schedule, Drawings, Stakeholders, Consultants) and take the same space as built ones.
**Change.** (a) Below 1180 keep labels and let the ribbon scroll horizontally with a faded edge, rather than dropping to icons — text beats icons for a 15-item set. (b) Collapse the six unbuilt tabs into one "More (6 coming)" item at the end, or hide them behind a Portal-Owner switch until built. Declutter-by-default is Aksha's standing rule. **M** **[confirm — changes what tabs people see]**

### 5. Ribbon on a phone — Atm Head
**Today.** Scrolls in its own container (`Ribbon.tsx:61`), which is right, but nothing shows there is more to the right, and the active tab may be off-screen on load.
**Change.** Scroll the active tab into view on mount; a right-edge fade; sticky ribbon inside the workspace scroll box so it doesn't leave when the table scrolls. **S**

### 6. Coming back to the dashboard — anyone
**Today.** Header has an "All projects" icon (`layout.tsx:78`) and the sidebar.
**Friction.** The icon-only control is easy to miss; there is no breadcrumb showing *Group › Project › Tab*.
**Change.** A one-line breadcrumb above the project name on desktop; on mobile a "‹ Projects" text link. **S**

### 7. Following a link from an approval email or Telegram card — Atm Head, phone
**Today.** `ABSORBED` redirects old tab URLs (`workspace.ts:124-129`) — good. A link to a specific budget line lands on the Budget tab with the tree collapsed unless `initialCollapsed`/`allCatIds` are passed (`project-tree.tsx:27-29`).
**Change.** Every deep link carries the category id and the tree opens *only* that category and scrolls to the line, with a 2-second highlight. Confirm the approval card links do this; if not, that's the fix. **S–M**

### 8. Old habits — someone types the live URL `/cost-control/projects/<id>`
**Today.** On the trial that page still renders (with `in_cockpit` suppressed chrome only when embedded). Two UIs for the same project: the old page and the new workspace.
**Change.** On the trial, the old project page should show a slim bar: "This project has a workspace now → open it". Keep the old page reachable (no silent blocker) but point forward. **S**

---

## B. Reading the money

### 9. Opening a project — Engineer
**Today.** Lands on Budget, pill 0 = the live Internal Estimate page rendered inside the tab (`BudgetTab.tsx`), which carries its own engineer-safe view. Good — this is what fixed the leak.
**Friction.** The engineer-safe view still says "Internal Estimate" in places the engineer can't see the figure for; the tab is called *Budget* but the pill is the IE page's own layout, so the visual language changes between pills.
**Change.** For engineers, rename the pill's heading to "Budget (your working sheets)" and hide columns that will always be blank for them. Make the three pills share one table style (same header row, same ₹ column widths). **M**

### 10. Switching the three pills — Aksha
**Today.** `?view=0|1|2` in the URL — refresh-safe and shareable. Good.
**Friction.** Pill names are long ("Category / sub-category wise", "Category — WO/PO wise", "CT wise"); on a phone they wrap.
**Change.** Short labels with the long name as the page heading: **By category · By order · By CT**. **S**

### 11. CT-wise total on a big project — Trustee
**Today.** Wrong on Raj Uphaar (audit F-002, un-paged read). Also desktop-only table (F-006).
**Change.** Already in the fix backlog. UX addition: when a total is built from more than one read, show a small "n sub-projects · n certificates" line under the total so a truncated read is visible to a human. **S**

### 12. Big numbers — everyone
**Today.** Full rupees with Indian grouping (₹7,33,11,552). The SC Budget report already has a ₹ / lakh toggle (`sc-budgets.ts:163-164`).
**Friction.** On the Budget and WO/PO tables a row of nine-digit figures is hard to scan on a phone.
**Change.** One global display preference (₹ full / ₹ L / ₹ Cr) remembered per user, applied to every money column in the workspace; full figure on hover/tap. Never changes the stored number. **M**

### 13. "n/a" vs "—" vs 0 — anyone
**Today.** The no-derived-figures rule prints `n/a` or `—` when IN4 holds nothing (`OrdersView.tsx:29` uses `—`; other places `n/a`).
**Change.** One symbol app-wide, with a legend line under each table: "— = IN4 holds no value". A real zero prints as ₹0. **S**

### 14. Which project am I in? — Aksha with parent/sub-projects
**Today.** Header shows "Part of <parent>", trust name, sub-project count, sft (`layout.tsx:112-126`). Good.
**Friction.** For a group project, the Budget rows are sub-projects and for a child they are categories — the same tab changes meaning by where you are, with no cue.
**Change.** A one-line caption under the pills: "Showing 4 sub-projects" or "Showing 12 categories". **S**

### 15. Colour meaning of % Used — anyone
**Today.** Green < 80, amber 80–95, red 95–100, rose > 100 (`OverviewTab.tsx:27-32`, same scheme elsewhere).
**Change.** Add a tiny legend once per page (four dots with thresholds) and keep the thresholds in one constant so all tabs agree. Colour-blind check: pair red/rose with a ▲ marker. **S**

---

## C. Approvals

### 16. "What's waiting on me this morning?" — Atm Head, phone
**Today.** Amber pills on the sidebar rows and lane header, badge on the Approvals ribbon icon, both fed by `my_approval_inbox()` so they agree (`approval-counts.ts`). Good.
**Friction.** On a phone the sidebar is behind a hamburger, so the first screen shows nothing amber.
**Change.** The dashboard's first card on mobile is *Waiting on you: 7 · tap to see by project*. **S**

### 17. Approving from inside a project vs from the dashboard — Atm Head
**Today.** Project → Approvals shows that project only; Dashboard → `/cost-control/approvals` shows all (`ApprovalsTab.tsx`, `approvals-inbox.ts`). Correct per Aksha's decision.
**Friction.** After approving the last card in a project the tab shows an empty state but no "next project with items" link.
**Change.** Empty state: "Nothing waiting here. 3 other projects have items → next: NGH A (2)". **S**

### 18. Approval card on a phone — Atm Head
**Today.** `ApprovalProjectCard` carries ₹/sft, Budget · WO · Paid, vs-last-revision, stage chain, actions. Rich, and long.
**Friction.** Approve/Return buttons are at the bottom of a tall card; the user scrolls past three cards' worth of figures to act on one.
**Change.** Collapsed card by default (line name, amount, who raised, days waiting, Approve/Return); tap the header to expand the figures. Sticky action row on the card. Declutter rule. **M**

### 19. Returned to engineer — Engineer, phone
**Today.** Sub-tab 2 lists returned sheets via `ReturnedToEngineer` (`ApprovalsTab.tsx:141-155`).
**Friction.** The reviewer's compulsory comment (the *why*) is the most important line and is not the first thing shown.
**Change.** Comment first, in quotes, then the sheet name; one tap to open the sheet at the flagged row. **S**

### 20. Budget transfers — Parimal
**Today.** Sub-tab 3 filters `cc_transfer_inbox()` to the project (`ApprovalsTab.tsx:162-179`).
**Change.** Show *from* → *to* category as two chips with the amount between, not a sentence. Show the balance after transfer on both sides. **S**

### 21. Acting on the trial site — anyone
**Today.** Approve is a browser-side RPC and currently *succeeds* on the trial (audit F-001). Once fixed it will return the blocked result.
**Change.** When blocked, the button itself should turn into the message ("Trial site — nothing is saved. Approve on the live hub →") in place, as `BillsRefresh.tsx:55-64` already does. Apply the same pattern to every action button in the workspace. **S per button**

### 22. Bulk approve Thumbrule sheets — Atm Head
**Today.** A link to `/cost-control/approvals/thumbrule` from the Approvals tab (`ApprovalsTab.tsx:88`) leaves the workspace.
**Change.** Open it as the Approvals tab's fourth pill, filtered to the project, so nobody leaves the project to finish a project task. **M**

---

## D. Work orders and purchase orders

### 23. Finding a work order by number or contractor — Aksha
**Today.** WO/PO tree: category → sub-category → order → items, with expand/collapse-all and hide-empty in the toolbar (`project-tree.tsx:15-16`, `OrdersView.tsx:91`). No search.
**Friction.** Raj Uphaar has 608 orders; finding "WO 623" or "all of Shree Builders" means expanding and scanning.
**Change.** A search box in the toolbar that matches order number, contractor, and item description; matches expand their own branch, everything else collapses. **M**

### 24. Printing a work order — Aksha, laptop
**Today.** Print link on WO rows → new tab, IN4's own template, a screen-only pre-flight strip listing what IN4 lacks, Print button, hint to turn Background graphics on and Headers off (`wo-print.ts`, `route.ts`).
**Friction.** Two browser settings the user has to remember each time; the pre-flight strip is text.
**Change.** (a) Turn the pre-flight into a checklist with ✓/✗ icons and make "no terms" red — a contract with no terms should look alarming. (b) A "Download PDF" that uses the browser's print-to-PDF via `window.print()` is all we can do without a server renderer; say so in the hint. (c) Remember "I've set my print options" in localStorage so the hint shrinks to one line after the first time. **S**

### 25. Trying to print a purchase order — Aksha
**Today.** PO rows have no Print link; nothing tells the user why.
**Change.** A greyed "Print — PO template not built yet" with the reason on hover, rather than silence (no silent blockers). **S**

### 26. A 423-line order — anyone
**Today.** All items render; the order row collapses/expands.
**Change.** Above 50 items show the first 25 with "Show all 423"; keep the sub-total visible above the list. **S**

### 27. Draft POs — Aksha
**Today.** Draft indent lines are summed into a text string "(₹38,577 draft) " built with `toLocaleString` (`orders-tree.ts:432`).
**Change.** Show drafts as their own dashed row with a proper ₹ column, not a parenthetical in the name. **S**

### 28. Ordered vs certified vs paid on a line — Aksha
**Today.** The tree shows ordered (and paid where IN4 holds it). `lib/in4/boq.ts` already computes certified per item with the bill list.
**Change.** Add a "Certified" column and an expandable bill list under each item (that's the enhancement suggested earlier, now with the data path proven correct at 95.17 %). **M**

---

## E. Reports and the Trustee view

### 29. Monthly Trustee pack — Trustee
**Today.** SC Budget tab, gated on `budget-vs-actual-v2` (admin + head), with column/mix pickers and ₹/lakh formatting (`sc-budgets.ts`). Reports tab shows Zoho contractor/supplier snapshot with "From Zoho, N days ago" and a Refresh (blocked on trial).
**Friction.** Two tabs for one monthly conversation; the Trustee has to know which.
**Change.** A "Trustee view" preset on SC Budget that fixes the columns and adds a print stylesheet (A4 landscape, one project per page). **M**

### 30. Stale Zoho data — Aksha
**Today.** Amber "N days ago" when stale (`BillsRefresh.tsx:50-52`). Good.
**Change.** Say what stale *means*: "Bills after 1 Sep are not in these totals". **S**

### 31. Exporting from the workspace — Aksha
**Today.** Master Excel moved to Reports as "Download Full Budget Excel (up to date)" per the cleanup; WO/PO tree has no export.
**Change.** Every table in the workspace gets the same two icons top-right: Excel · Print. One component, one behaviour. **M**

---

## F. Setup, masters and linking

### 32. Project not linked to IN4 — Aksha
**Today.** Empty state "Not linked to an IN4 sub-project yet" (`OrdersView.tsx`, `BudgetTab`).
**Friction.** Says what, not what to do.
**Change.** "…yet. Link it in Setup → IN4 mapping" as a button, shown only to reviewers (who can set up); others see "Ask Aksha to link it". **S**

### 33. Where is Setup? — Parimal
**Today.** Not one of the fifteen; a gear beside the sync stamp, reviewer-only (`workspace.ts:135-142`, `layout.tsx:153`).
**Friction.** A gear with no label is the classic hidden control.
**Change.** Gear + the word "Setup" on desktop; on mobile put Setup as the last item of the ribbon for reviewers. **S**

### 34. Masters landing — Aksha
**Today.** `/masters` lists vendors, items, stores, projects, trusts, contacts, mapping with counts (`masters/page.tsx`).
**Friction.** It reads as a data dump; the reason to go there (fix a mapping, check a vendor) isn't stated.
**Change.** Each master card carries one task verb: "Map an IN4 project", "Check a vendor's GST", plus a "needs attention" count (e.g. trusts without GSTIN: 1). **S**

### 35. The trust with no GSTIN — Aksha
**Today.** Every SRASSK work order prints with a blank GST line; the print page's pre-flight says so per order.
**Change.** Surface it once at the source: on `/masters/trusts`, an amber row-level flag "No GSTIN in IN4 — affects 1,017 printed orders", with the IN4 screen to fix it named. **S**

---

## G. Cross-cutting

### 36. Waiting for a tab to load — anyone on a phone
**Today.** No `loading.tsx`, no Suspense in the workspace (audit F-007). The WO/PO tree on Raj Uphaar reads 4,102 items first.
**Change.** Header + ribbon render instantly; each tab shows three grey pulse rows until data lands; the WO/PO tree streams categories first and items on expand. **S (skeleton) / M (streaming)**

### 37. Something failed — anyone
**Today.** `global-error.tsx` prints the message and digest; the workspace header degrades to nulls when the IN4 chain fails (`workspace-header.ts`); "This project could not be opened" appears with no next step.
**Change.** Every error card has the same three lines: what failed (plain words) · what you can do (retry / go to live hub / tell Aksha) · a copyable reference code. **S**

### 38. The bell — anyone
**Today.** Unread count in the header (`layout.tsx:141-143`).
**Change.** Group notifications by project, most recent project first; "mark project read". **M**

### 39. Dates — anyone
**Today.** Mostly IST helpers; a few `toLocaleDateString('en-IN')` on the dashboard/admin (`dashboard/page.tsx:111`, `admin/page.tsx:112`).
**Change.** Relative for recent ("today", "3 days ago") with the absolute IST date on hover; one helper. **S**

### 40. Knowing you're on the trial — anyone
**Today.** `DemoBanner` at the top; blocked writes return "This is the trial site — nothing is saved here."
**Change.** Banner stays; add the live hub link in it; make the favicon/browser-tab title say "TRIAL · CT Hub" so a second tab is never mistaken for live. **S**

### 41. Small text on phones — everyone
**Today.** Many `text-[10.5px]` and `text-[11px]` labels in the workspace (`BudgetTab.tsx:61`, `OverviewTab.tsx:73`, `ReportsTab.tsx:165`, `Ribbon`). AGENTS.md asks for ≥44 px tap targets.
**Change.** Minimum 12 px for anything a person reads, 13 px for figures; tap targets on tree chevrons and Print links to 44 px. **S**

### 42. Two worlds — the old Cost Control pages and the new workspace
**Today.** Both exist and look different (old page: wide table + card pair with its own header; workspace: ribbon + pills). Users will bounce between them via links (`/cost-control/approvals/thumbrule`, working-sheet pages).
**Friction.** The biggest UX cost on the trial is not any one screen; it's that a task starts in one visual world and ends in another.
**Change.** Decide the direction: either the workspace embeds the old pages with their chrome suppressed (as pill 0 already does with `in_cockpit`), or old pages get the workspace header. Pick one; do not keep both for long. **L** **[confirm — product decision]**

---

## What I'd do first (if you approve nothing else)

| # | Scenario | Why first | Size |
|---|---|---|---|
| 1 | 21 — blocked-action message in place of the button | Pairs with the P0 guard fix; without it the guard looks like a crash | S |
| 2 | 36 — skeletons | Every tab, every phone, every day | S |
| 3 | 4b — collapse the six unbuilt tabs | Declutter rule; 40 % of the ribbon is empty promise | M [confirm] |
| 4 | 2 — project filter in the sidebar | 33 projects, phone-first | S |
| 5 | 23 — search in the WO/PO tree | 608 orders on one project | M |
| 6 | 18 — collapsed approval cards | The approver's daily task, on a phone | M |
| 7 | 32/33 — "link it in Setup" + label the gear | No silent blockers | S |
| 8 | 10/13/15 — short pill names, one dash, one legend | Consistency, cheap | S |
| 9 | 12 — ₹ / L / Cr preference | Readability of every money column | M |
| 10 | 42 — decide old-page vs workspace direction | Everything else inherits it | L [confirm] |

Not included: anything that changes who can see what, any figure's formula, or the trial guard — those stay with the audit backlog and the confirmation rule.
