# Project Schedule + WO Tracker — design (SIMPLE hat)

The **Schedule** lane in the per-project cockpit. One idea holds it together: **you schedule work by
Category / Sub-category and set one date — when it must start on site — and the Work-Order deadline
(and the budget + drawing deadlines behind it) compute themselves.** This makes #2 (Drawings → Budget →
Work Order) and #3 (schedule) the same simple screen.

Guiding rules: dead-simple for a layman, every space earns its place, default collapsed/rolled-up,
reuse existing data so nobody re-enters anything. IST dates throughout.

---

## The deadline formula (work-back from site-start)

Each work item has **one date the user sets: `Site work starts`.** Everything upstream is computed by
subtracting lead times (calendar days; defaults, editable in Settings — later per-project):

| Milestone | When it must be done | Default lead |
|---|---|---|
| **WO issued** | site-start − procurement lead | **21 days** before start |
| **Budget approved** | WO deadline − approval lead | **28 days** before start (21 + 7) |
| **Drawing ready** | budget deadline − drawing lead | **42 days** before start (28 + 14) |

So set "start = 1 Oct" → WO deadline 10 Sep, budget-approved 3 Sep, drawing-ready 20 Aug — all shown
automatically. Change the start date and everything recomputes. Change the lead numbers once in Settings
and every item recomputes. (v1 = calendar days; holiday/working-day aware is a later toggle.)

---

## What auto-syncs (no re-entry) — the "advanced feature using existing modules"

**No money in the schedule (Aksha, 2026-08-05).** The lane does NOT capture budget or WO amounts — it just
tracks **WO issued? (yes/no + date + WO no)** against each schedule line. Amounts stay in Cost Control.

Categories/items are picked from the master trade tree (Established Rates **Discipline → Category →
Sub-category** — the literal "Category / Sub-category" names, with `short_name`/`uom`) or typed in; nothing
blocks scheduling.

| On the schedule | Comes free from | Source |
|---|---|---|
| **WO issued? + date + WO no** | Cost Control WO events, else IN4 — else a one-tap toggle | `cc_budget_events` (wo_number, event_date) → fallback `est_wo_history` (wo_number, from_date) |
| **Category / Sub-category list** | master trade tree | `est_disciplines → est_categories → est_subcategories` |
| **Floors / locations (matrix columns)** | project floors | `project_floors` (id, project_id, sequence, name) |
| Deadline pill (overdue/soon/ok) | reuse UI | `components/cost-control/DeadlineBadge.tsx` |
| Slip alerts (later) | reuse engine | blueprint SLA severity pattern |

---

## Two views in one lane (anchored on the team's real progress report)

The lane has ONE spine — the work items — seen two ways, via a toggle:

1. **Plan & WOs** — the date view: site-start, the auto WO/budget/drawing deadlines, overdue flags, budget/
   WO-approved. Forward-looking "what must I raise."
2. **Progress** — a live, better version of the team's existing **item × floor progress matrix**
   (`NGH A Progress Report`): rows = work items grouped by trade, columns = the project's floors + staircase
   flights, each cell a **Not started · WIP · Done · NA** status, with Engineer + Agency + WO/PO alongside.

### The Progress matrix — how it beats the hand-coloured Excel
- **One-tap cell update** on mobile: engineer cycles Not started → WIP → Done (live, not a weekly recolour).
- **Auto-%**: computed per item, per floor, per trade, and whole-project (done ÷ applicable, NA excluded).
- **Behind-schedule flag**: cross the cell with the plan — a floor past its plan date but not Done reads red.
- **Engineer / Agency / WO-PO auto-filled** from the item's owner + contractor + the WO tracker.
- **Auto snapshot**: regenerate the same dated report as an image/PDF for WhatsApp — reuse the bills-pipeline
  `svgToPng` renderer; optional weekly send.
- **History**: snapshots over time → this-week-vs-last-week progress trend.

### Columns come free
The matrix columns (floors + staircase flights) come from **`project_floors`** (already in CT HUB —
`id, project_id, sequence, name`). Add "staircase flight" rows there (or a small extra-locations list) so the
grid matches the real building. No re-entry.

---

## Plan vs Actual — three simple levels

1. **Dates** — every item keeps **planned** start/finish (baseline, frozen at lock) and **actual** start/finish
   (actual start auto-set when % first moves; actual finish when it hits 100) + a ±days **variance** chip.
2. **Progress** — **planned %** (where the baseline says it should be *today*) vs **actual %** (recorded, or
   done-cells ÷ applicable from the progress matrix). The gap = the red catch-up strip on the bar.
3. **Project roll-up (the S-curve in one line)** — cumulative **Planned X% vs Actual Y%** as of today, shown as
   a two-tone bar; instantly says ahead/behind. Claude narrates it ("14% behind — RCC is the drag").

**Baseline drift** — the baseline is frozen at lock, so the Timeline draws a faint **ghost bar** at the original
window behind any item whose dates were later revised (via approval), making slippage-over-time visible.

Status chip (derived, never typed): 🟢 on track · 🟠 due soon · 🔴 overdue · ✅ done · ⏸ on hold.

## Setup & the flexible adder (free until lock — Aksha, 2026-08-05)

Building the schedule is fully flexible **until the PM locks it**:
- **Add** items from the master trade tree (Established Rates) or typed; **insert anywhere**, not just append.
- **Rearrange** — drag to reorder within/across trades (`sequence`); move an item to another trade.
- **Edit / rename / split / merge / delete** freely; duplicate an item across floors/blocks.
- **Set dates** — site-start per item → WO/budget/drawing deadlines auto-compute; or set a duration → finish auto.
- **Lock** when happy → baseline frozen → thereafter date changes need approval. Unlock is itself an approval.

**Claude at setup (extreme-intelligence assists — all optional, PM edits everything):**
- **✨ Draft the schedule** — from the project type + past projects' WO history (`est_wo_history` from→to dates per
  trade) + the standard build sequence, Claude proposes a full first cut (items in build order, realistic
  durations, dependencies) so nobody starts from a blank page.
- **✨ Missing-item check** — compares the list to a typical scope for that building type and flags gaps
  ("no DADO / Skirting / Terrace parapet — add?").
- **✨ Duration suggestions** — realistic per-trade durations learned from your own past towers, not guesses.
- **✨ Smart sequencing** — proposes what-follows-what, so moving one item shifts the dependent chain.
- **✨ What-if** — "if RCC slips 2 weeks, what happens to handover?" Claude recomputes downstream + flags new slips.

---

## Chosen enhancements (Aksha, 2026-08-05)

Confirmed on top of the base lane:
- **Timeline view** is the primary "schedule" (bars across months) — not just a list. List + progress-matrix are the other two lenses.
- **Group rows by trade** (Civil, Waterproofing, Electrical…) with a per-trade **% roll-up bar** and overdue count; each trade section collapsible.
- **Zoom: Week / Month / Quarter** — near-term in weeks, far-term in months; today auto-centred (this replaces the earlier This/Next/3-month toggle — zoom *is* the look-ahead).
- **"Behind" shown explicitly** — a red hatched catch-up strip on the bar (gap between where it should be by today and where it is) + a **"Nd behind"** number.
- **Filter by engineer / agency** — show one person's or one contractor's slice.
- **AI — slip prediction (only AI feature chosen for now):** Claude watches actual pace vs plan and flags items **trending late before they're overdue** ("RCC Raft ~2 weeks late at current pace"), shown as a ✨ badge + a one-line insight banner atop the lane. Uses the Anthropic API access. (Daily summary / Ask-AI / photo-progress deferred.)

## Baseline lock + approval for date changes (Aksha, 2026-08-05)

Stops dates quietly slipping after the plan is agreed. Reuses the app's existing approval engine —
no new approval code.

- **Before lock** — the PM/Atm Head builds the schedule; editors set dates freely.
- **Lock the baseline** — PM/Atm Head/admin locks it. Planned dates freeze as the **baseline** (kept forever;
  Timeline shows a faint ghost baseline vs the current bar = drift).
- **After lock** — changing a date does NOT apply instantly; it opens a **change request**
  (`from_date → to_date` + reason) that lands in the approver's `/approvals` inbox via
  `approval_rules` + `enforce_approval_via_matrix()` + `my_approval_inbox()`. Approve → date moves + logged
  (who/when/why); reject → stays. Baseline never moves.
- **Roles** — PM / Atm Head / admin lock + approve; engineers request. Uses the module's `role_permissions`
  + `can_approve()` (AGENTS.md generic approval flow). New `sched_date_change_requests` table (from/to/reason/
  status/requested_by/decided_by) + `sched_items.locked_at` / `baseline_start`.

**Engineer-friendly**
- Engineers land on **their items only** (engineer filter), mobile cards, big tap targets.
- 1-tap actions: update % done, mark WO issued, request a date change.
- A locked date shows **🔒**; tapping it opens *"Locked — request a change"* with a reason box on the same
  screen (never a dead grey field — see [[feedback_no_silent_blockers]]).
- A pending request shows a **⏳ change requested: 5 Oct → 20 Oct · waiting on PM** chip on the item.

## Views: look-ahead

A single row of toggles, default **This month**:
`All · This month · Next month · 3-month look-ahead · Plan vs Actual`

Look-ahead filters items by the month of their **next upcoming milestone** (whichever of drawing/budget/WO/
start is next unfinished), grouped by month so the layman reads "here's what's coming." "3-month" answers
*"what WOs must I raise this quarter."* Completed items hide by default (toggle to show).

---

## View toggle — 4 lenses, one dataset (Aksha, 2026-08-05)

A toggle at the top of the lane flips between four views of the same work items — deliberately **not**
MSP/Zoho (no Task IDs, durations columns, predecessor spaghetti, WBS codes, resource sheets):

- **📅 Timeline** — the Gantt: bars over months, plan-vs-actual fill, WO ◆, today line, zoom.
- **📋 Table** — plain-English, one line per job, grouped by trade. Columns in human words:
  *Work · Who's doing it · Starts on site · Raise WO by · How far · Status · **Next action***. The
  **Next action** column is the lethal bit — it doesn't just show status, it says what to *do* ("🔴 Raise WO now
  — 6 days late", "📝 Raise WO by 09 Aug", "⏫ Push labour — 5 days behind", "🔴 Chase the drawing"). Plain
  filters (All · Behind · This month · Not started · Done) + search. Trade sub-rows show a % bar + "N need action".
- **🧱 Progress** — the floor-by-floor matrix (their NGH report, live).
- **🗂️ Board** — the **default landing** (Aksha 2026-08-05: table felt "too many numbers"). Appealing, low-number:
  one overall progress **ring**, colour chips (2 need a WO · 1 behind · …), a "⚑ Needs you now" set of cards each
  with a ring + plain status + one action button, then calmer "running & upcoming" cards. Rule: **one number per
  card (the ring); everything else is colour + plain words.** (A status-column Kanban is an alternative arrangement.)

Design rule: every column is a phrase a site engineer reads without training; colour + word together; the table
is **action-first** (sorted so what needs doing rises to the top).

## Drawings tracker — folded into the same schedule (Aksha, 2026-08-05)

Drawings are the **first upstream stage** of the formula (drawing-ready = site-start − ~42d), and the #1 cause of
WO/site delays. Make them first-class in the schedule:

- **Inline on each schedule row** — a small **drawing chip**: ✓ GFC (good-for-construction) · ⏳ in review · 🔴
  overdue. A late drawing visibly **blocks** that item's WO + site start (the "blocked on drawing" state we already show).
- **A dedicated Drawings register** (a view/tab in the lane) — per drawing: no., title, discipline (Arch / Struct /
  MEP / Plumbing / FF / Elec), **linked work item(s)**, current **revision** (R0 → R1 → …), status
  (Requested → WIP → Received → Under review → **GFC** → Superseded), consultant/owner, **target date** (auto = the
  item's drawing-ready deadline from the formula), received & GFC dates, and a **"blocking?"** flag.
- **Revisions** — track the latest GFC; site builds to the latest; a new revision landing on an in-progress item
  raises a **rework-risk** flag.
- New tables `sched_drawings` + `sched_drawing_revisions`, each linked to `sched_items`; owner/consultant can reuse
  `vendors`/`profiles`. Claude flags "Drawing X 10 days overdue — blocks Fire Fighting WO — chase consultant Y."

## Micro (engineer) ↔ Macro (management) — one dataset, five altitudes

The same schedule read at whatever height you're standing:

**Portfolio → Project → Trade → Work item → Floor / Drawing**

- **Role-based landing.** An **engineer** lands on *My work* (micro): only their items, floor-by-floor, the drawings
  they're waiting on, the WOs to raise, one-tap % updates + date-change requests. **Management/PM** lands on
  *Project / Portfolio health* (macro): rings, the plan-vs-actual **S-curve**, trade bars, blocker tiles, projected
  finish vs target — few numbers, big signals.
- **Drill-down both ways.** Every macro number is a link **down** to the micro detail; every micro item shows how it
  **rolls up** ("this feeds Civil 37% → project 34%").
- **Macro artifacts:** overall %, S-curve (planned vs actual over time), per-trade bars, blocker tiles (**WOs overdue**,
  **drawings overdue & blocking**), projected finish vs target, and a **portfolio table across all sites** (NGH, P2,
  VV, EK, RH, SRAH…) so management sees the whole company at a glance. Claude narrates the portfolio in one sentence.
- **Micro artifacts:** the Board / Table / Progress-matrix scoped to the engineer, floor-by-floor + drawing-by-drawing,
  act-in-place.

Same tables, same numbers — only the altitude and the default landing change by role.

## Daily photos + AI — fast-follow, NOT v1 (honest read, Aksha, 2026-08-05)

Powerful, but only if it **replaces** manual updating instead of adding a second daily chore. The core pain is
already "engineers don't fill daily entries on time" — and the Warehouse module died from being too heavy with
no adoption. So the rule:

- **The photo IS the update.** Engineer snaps site pics (something they often already do) → AI **suggests** a
  progress % per discipline/floor + a green/red quality read → engineer taps **confirm**. That feeds the schedule
  rings + the macro building automatically. Photos are lower-friction than a form, so this can *reduce* burden.
- **AI suggests, human confirms — never authoritative.** A photo of one corner does not prove a floor is 40% done;
  an over-trusted wrong number is worse than no number. % stays engineer-confirmed.
- **Quality flags: capped + owned.** Top few issues/day to ONE owner (Atm Head/QA) with a 1-line reason + best fix —
  not an unwatched firehose (that just adds chasing).
- **Sequence: schedule first, photos second.** Ship the simple schedule, win adoption, *then* add photo-capture as
  the easiest way to update — so it fixes the entry problem rather than becoming a new one. Needs the Anthropic
  vision API (the plan step we discussed).
- **AI-asks-questions flow (photo → yes/no → confirm): OPTIONAL, behind a toggle (Aksha, 2026-08-06).** Decision:
  ship **both** input modes and switch with a toggle. Manual update (tap floors / mark WO) is always present; the
  AI photo-assist is an **admin setting, default OFF, per-project** — flip on to trial on one site (e.g. NGH), leave
  others manual. **Both modes write the same `sched_progress` data** — no fork; switch anytime. Manual is never
  removed (no silent blocker). Turning the AI half ON requires the Anthropic vision API; build the manual core +
  the toggle first, the AI side lights up when the key is in — no rebuild. Toggle lives in Settings (config off the
  main screens).

## Data model (built on approval — new tables only, additive)

`sched_items` — one row per scheduled work item:
`id, project_id→projects, cc_discipline_id?, cc_sub_skill_id?, category_label, sub_label,
sequence, plan_site_start date, plan_site_end date?, status, owner_user_id?,
actual_drawing_date?, actual_budget_date?, actual_wo_no?, actual_wo_date?, actual_site_start?,
actual_complete?, notes, created_by, timestamps.`
Deadlines are **computed, not stored** (from `plan_site_start` − leads) so changing the leads reflows everything.

Lead-time config in `app_settings`: `sched_lead_procurement_days` (21), `sched_lead_approval_days` (7),
`sched_lead_drawing_days` (14).

Module registered in `lib/modules.ts` (slug `schedule`), lane added to `/projects/[id]` via the existing
`?tab=` + `TabLink` pattern; every page gated by `requirePermission('schedule', …)`.

---

## 20+ scenarios the simple design must handle

1. **Empty project** → friendly "add your first work item" prompt.
2. **Add item** → pick Category (+ optional Sub-category), set site-start → WO/budget/drawing deadlines auto-appear.
3. **Category-level only** (no sub-category chosen) — schedule at the category.
4. **Sub-category level** — finer scheduling under a category.
5. **WO deadline passed, no WO** → 🔴 overdue, surfaced in the top strip count.
6. **WO deadline within 7 days** → 🟠 due soon.
7. **WO issued on time** (synced from Cost Control) → 🟢, shows actual WO no + date, no manual entry.
8. **WO issued late** → 🔴 actual-after-plan flag.
9. **Budget not approved but budget-deadline near** → 🟠 nudge; links to Cost Control.
10. **Drawing not ready & drawing-deadline passed** → earliest blocker; row reads "waiting on drawing."
11. **Actual WO auto-synced from Cost Control** (`cc_budget_events.wo_number`) — zero typing.
12. **Actual WO from IN4** (`est_wo_history.from_date`) when Cost Control has none.
13. **WO issued auto-detected** from Cost Control / IN4 → line flips to 🟢 with WO no + date, no typing.
14. **WO issued by one tap** when nothing synced → engineer marks it issued + picks the date.
15. **Reschedule** — move site-start → all four deadlines recompute instantly.
16. **Many items in one month** → grouped in the look-ahead by month.
17. **Next-month look-ahead** → exactly the WOs that must be raised next month.
18. **3-month look-ahead** → the quarter's pipeline.
19. **Completed item** → greyed, collapsed, out of overdue counts (declutter).
20. **Project has start/target-completion** → warn if an item's plan runs past `projects.target_completion`.
21. **Reorder items** — a sequence number so the schedule reads top-to-bottom in build order.
22. **Two projects** — each cockpit has its own schedule; no cross-contamination.
23. **Sub-project** (`parent_project_id`) — schedule attaches to the sub-project it belongs to.
24. **Lead-time change in Settings** → every item's deadlines reflow.
25. **On-hold item** — parked, excluded from overdue.
26. **Owner per item** — who's chasing the next step (reuse `pm_user_id`/owner).
27. **Mobile** — cards with big tap targets, the same data, one-thumb reachable.
28. **Project-level roll-up** — "3 overdue · 5 next month · 60% on track" at the top and on the cockpit tab badge.
29. **Weekend/holiday** — v1 calendar days; note working-day math as a later toggle.
30. **Share / export** — WhatsApp/PDF of "WOs to raise this month" (reuse existing share pattern) — later.
