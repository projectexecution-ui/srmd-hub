# HOD inputs — Cost Control project view

Raised by Atmarpit Akshay, 25 Aug 2026, against
`/cost-control/projects/768e48c0-6a01-4c95-b406-1ccc8c82a93b` (SRAH).

**Working agreement:** more than one agent session works this repo. Claim an item
here (put your commit SHA in) before starting it, so we do not build the same
thing twice — points 1 and 2 were built twice before this file existed.

---

## 0. Approvals must open the project, not the voucher — DONE (`2ca7f88`)

Home *Needs you now*, My Approvals, the bell and the approval email now open
the project focused on the work category + sub-skill, carrying `?ws=` for the
sheet. Three routes into the voucher from there: the amber "Waiting on you"
bar, an **Approve** button on the highlighted row, and the same button on the
phone card. Telegram keeps its sheet button (the only way to Return or
part-approve) and gains a "Full project" button.

Verified on production: all 20 dashboard items relink, the click lands and
auto-scrolls to the highlighted row.

---

## 1. Sequencing of the disciplines — DONE (`414e763`, merged in `d7aff5d`)

`cc_disciplines.display_order` is `NOT NULL DEFAULT 0` and the admin form
coerces a blank box to 0, so **9 disciplines carried 0** and sorted above
"01 Site Pre-lims" — on SRAH that floated `53 OT'S` and `54 Specialized
Flooring` to the top.

`lib/cost-control/discipline-order.ts` is now the single rule: explicit order
(> 0) wins; 0/null falls back to the code number; ties break on the raw code
so the sort is total and stable.

## 2. Freeze the top row headers — DONE (`c165eb7`, merged in `d7aff5d`)

Each scrolling region gets its own `overflow-auto max-h-[75vh]` container with
`sticky top-0` cells inside. A plain page-scroll sticky is **inert everywhere
in this app** because `main` sets `overflow-x-auto`, which makes `overflow-y`
compute to `auto`. Documented in `AGENTS.md`.

---

## 3. Completed items: mark complete + budget reduced — DONE (`7a525f2`)

**Answered by the HOD:** offer the button ONLY where WO/PO committed equals
Paid, so only a few rows ever show it. Portfolio-wide 152 of 272 lines with a
WO match to the rupee; on SRAH exactly 32 of several hundred rows qualify.
Compared on whole rupees with NO tolerance (155 match within ₹100 — three extra
lines are not worth an unexplainable rule).

Closing shows the leftover budget as released, e.g. 1213 SS Works: ₹3,50,000
budget, ₹1,87,620 paid → **₹1,62,380 released**. Nothing is written back to
`cc_budget_lines` — those figures are authored by the IN4 → BPH sync and the
next sync would overwrite us. Stored on
`cc_project_sub_skills.completed_at / completed_by / completed_note`.

Eligibility is re-checked server-side, so a stale page cannot close a line that
still owes money; the refusal names the outstanding amount.

## 4. Items showing spend over the ERP-approved budget — DONE (`49dc34a`)

**Not a display bug — the data says so.** SRAH has exactly three such lines:

| Sub-category | ERP Budget | WO/PO | Paid | Over by |
|---|---:|---:|---:|---:|
| 302 Steel Works | ₹63,55,388 | ₹67,58,594 | ₹67,58,588 | **₹4,03,206** |
| 303 Concrete Work | ₹23,11,645 | ₹23,66,247 | ₹23,66,247 | **₹54,602** |
| 307 Dowels & Re-barring | ₹59,206 | ₹59,206 | ₹59,206 | ₹0.20 |

IN4 shows WOs issued *above* the released budget. Today the row only turns red
past 95% used, which reads as "nearly full", not "overspent".

**Done:** an explicit `OVER by ₹X` marker on the row and the phone card, a
count on the project header, and the same on the discipline roll-up. Read-only
— it reports, it does not block.

## 5. Internal Estimate can never be below what ERP already approved — TODO

The rule is clear; the enforcement point is the question. The Internal Estimate
is usually loaded **before** the ERP figures arrive, so a hard block at upload
would reject legitimate imports.

**Proceeding assumption:** allow the value, but flag it loudly on the row
(`below ERP approved by ₹X`) and block the *manual* Trustee "accept" of an
estimate that sits below the approved figure. Never silently clamp a number.

## 6. Create a new discipline / sub-discipline from this view — TODO

Today this only happens in the setup wizard and `/cost-control/admin/disciplines`.
Add an inline "Add work category" / "Add sub-category" on the project view,
gated to management, writing `cc_project_disciplines` / `cc_project_sub_skills`
(and `cc_disciplines` / `cc_sub_skills` when genuinely new).

## 7. Show which budgets are adhoc vs per the BOQ estimate — TODO

**Open question — needs the HOD's definition of "adhoc".** We currently record
*how* a sheet was entered (`entry_mode`: BOQ line items / Excel summary /
Thumbrule), not *why* it exists.

**Proceeding assumption:** "as per BOQ" = the sub-skill carries an imported
`[IB…]` Internal Estimate baseline; "adhoc" = a sheet raised against a
sub-skill with no baseline, i.e. extra work outside the original BOQ. Shown as
a small `BOQ` / `ADHOC` chip.

## 8. Tree view down to the item — Unit / Qty / Rate / Amt, and WO/PO per item

**8a — item detail: BUILDABLE.** `cc_working_sheet_items` already holds
`sr_no, description, uom, qty, rate, total_amount, vendor_id`. Expanding a
sub-skill can show exactly what the HOD asked for.

**8b — which items have WOs/POs issued: BLOCKED, no data.** Nothing links a WO
or PO to a working-sheet line item:

- `cc_budget_lines.current_wo_committed_amt` is a **sub-skill-level total**
  pulled from IN4.
- `po_lines` is the material-procurement side (`po_id`, `indent_line_id`,
  `material_name`) — no discipline, sub-skill or CC item reference.

So this needs one of:
1. an IN4 export carrying WO/PO **line items** (then map them), or
2. engineers tagging items by hand (extra daily work — avoid), or
3. accept WO/PO shown at sub-skill level only, with the items listed beneath.

**Needs the HOD's call.** 8a proceeds regardless.

## 9. (cut off in the message) — awaiting the rest
