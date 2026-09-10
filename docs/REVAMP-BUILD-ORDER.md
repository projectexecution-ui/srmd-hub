# Revamp — build order for Claude Code

Everything below is already working in `app-preview.html` against live data. That
file is the reference: when a layout question comes up, open it rather than guess.

Branch: `revamp`. Nothing here writes to IN4 — the login stays read-only.

---

## 0 · What is already done

- **`in4_wo_boq_items`** (9,852 rows) and **`in4_wo_abstract_items`** (8,230) are
  synced, behind the `boq` feed. Ordered qty/rate per WO BOQ item, executed qty
  per item per bill, with `BOQ_NAME` and `UOM` from `BI.DIM_ENGG_WORK_ORDER_BOQ`.
- Join rule, proven: **`WO_ID` + `ITEM_ID`**, never `BOQ_ID` — the two fact views
  disagree by one. Verified on WO 623 item 6340: 57,775.06 of 60,707.15 = 95.17%,
  matching `ENGG_VIEW_WO_ABSTRACT_BOQ_COMPLETION`.

---

## 1 · Project workspace shell

Header on one line, ≤56px: project name (20px), then grey meta separated by
hairlines — workspace · trust · sub-projects · sft. Right: sync stamp in light
grey, then `🔔 Notifications` with an indigo count pill. No action button.

Ribbon below it: **all fifteen tabs visible, no scrolling, no overflow menu.**
Icon over an 11px label, five groups with a hairline between:

| Group | Tabs |
|---|---|
| Money | Budget vs Actual · Approvals · SC Budget · Accounts |
| Procurement | Indents · WO / PO · Material |
| Site | JMR · QC · Schedule |
| Documents | Drawings · Reports |
| People | Stakeholders · Discussions · Consultants |

Below 1180px the labels drop and the icons stay. Only on phone does it scroll.
Sub-tabs are a pill row under the ribbon. Two levels of tab, never three.

---

## 2 · Budget vs Actual — three pills

**Category / sub-category wise** — this is CT HUB's Internal Estimate, reproduced
to the rupee. Do not re-derive it:

- Internal estimate = the **maintained estimate**: `cc_budget_lines.internal_estimate_amt`
  where set, otherwise the latest working sheet total for that sub-skill. Include
  sub-skills that have a sheet but no budget line. Where a budget line exists on a
  null sub-skill, do **not** add the sheet on top — that double-counts (it cost
  ₹22.93 L on NGH B).
- Budget (CT HUB) = `approved_for_erp_amt` — approved for ERP, not yet in IN4.
- Budget (ERP) = `current_budget_amt`. WO/PO = `current_wo_committed_amt`.
  Paid = `current_paid_amt`. % used = paid ÷ budget (ERP).
- Five KPIs with ₹/sft under each; per-sft under every money cell; em-dash for nil.
- Sub-skill rows expand to the working sheet: `cc_excel_rows` — `#`, description
  with its `source_sheet!source_cell` in green, unit, qty, rate with the `M+L`
  breakdown beneath, amount; then Rows total and **Grand total (the approved figure)**.
- Check: NGH B totals ₹25,37,44,524 estimate, ₹17,82,72,601 budget,
  ₹11,07,69,381 WO/PO, ₹8,17,55,876 paid.
- **Flag where rows total ≠ sheet total.** On approved sheets they match; on drafts
  they don't (Dado: rows ₹3.09 Cr against a ₹47.84 L sheet).

**Category — WO/PO wise** — the orders tree, WO and PO together, no filter buttons.

**CT wise** — sub-project roll-up. Flat, no drill-down.

---

## 3 · Procurement → WO / PO

Sub-tabs: All orders · Work orders · POs · BOQ upload.

Five-level tree: **category → sub-category → order → BOQ item → bill.**

- A **PO** opens to its items: unit, ordered qty, rate, value, received qty,
  pending qty, GRN value, % received. From `in4_indent_items`, unnesting `pos`
  with `jsonb_array_elements` — **not** `pos->0`, which returns 0 on multi-PO lines
  and silently drops them.
- A **work order** opens to its **abstract** — twelve figures: order value, gross
  with tax, gross billed, certified, balance to bill, retention held, advance
  recovered, advance still to recover, paid, outstanding, billed against order,
  paid against certified — then its BOQ items, each expanding to per-bill certified
  quantity with a running cumulative.
- Received value exceeds order value on most PO lines because the GRN carries
  landed cost. Say so under the table; compare quantities, not those two amounts.
- **BOQ upload** — one row per WO, with Template and Upload. IN4's importer lands
  on `ENGG_TEMP_IMPORT_BOQ_ITEM`, so the columns are fixed: `EXCEL_SL_NO, NAME,
  DESCRIPTION, NOTES, REMARKS, SKILL_ID, UOM, QUANTITY, RATE, REVENUE_QUANTITY,
  REVENUE_RATE, BOQ_LEVEL, Floor, Unit`. `ENGG_BOQ_MAPTEMPLATE` is empty — that
  staging table *is* the format.

---

## 4 · Approvals

Sub-tabs: Waiting on me · All pending · Returned to engineer · Transfers.

**Waiting on me** groups by project: project card with coloured left edge, amber
"N waiting on you" pill, code chip, PROJECT BUDGET (ERP). Inside, a grey category
band with `approved ₹x → ₹y` on the right, then each sheet — sub-skill code and
name, ws_code beneath, amount, red `Nd overdue` past 7 days, the PH → Atm →
Trustee chain with `· you` on the current step, an APPROVED SO FAR → AFTER THIS
box with both the sub-skill and discipline lines, then Budget Excel and a green
Review & approve.

**Approved so far is the CT HUB chain figure, not the ERP budget.** BHP shows
₹0 → ₹11,07,952, not ₹3,85,000 → ₹14,92,952.

"Waiting on me" must use the same rule as the notification count — one shared
function, so the two can never disagree.

---

## 5 · Indents — procurement flow

Sub-tabs: Approval queue · Open POs · Rate history · Material master.

Six-step flow strip, labelled with where each step happens:
`Indent keyed in IN4 → Approved in app → Approved in IN4 → PO made in IN4 →
PO approved in app → GRN in IN4`.

- **The app watches IN4.** An indent appearing at `indent_status = 1` opens an
  approval by itself. Nobody keys anything twice. Decode the other status codes
  (13, 60, 65, 66) against IN4's lookup before relying on 1 = draft.
- **Thresholds.** Under a set value, one approval; above it, the full chain. At
  ~33 indents a month, three signatures on each is 200 sign-offs a month and
  nobody reads them. Reuse `cc_approval_thresholds`.
- Every line shows the **last rate from past POs, with the count**. Approving a
  rate without the history is not a check.
- **Open POs** — 232 open, ₹1.49 Cr undelivered, age pills, oldest first. The
  oldest is April 2023. Also surface the 542 approved lines across 168 indents
  with no PO at all.
- **Rate history** — lowest, average, highest and spread per material across every
  PO. Over 100% spread is flagged. This is what a PO approval screen shows.
- **Material master** — the engineer picks from the mirrored 3,972; unit comes
  from the master and is not editable. Only 67 materials carry a rate in IN4, so
  show the **last purchased rate from the PO feed**, never the master rate.
- **Print PO** renders your own layout from IN4 fields, re-keying none, same PO
  number. The app never creates a PO.

---

## 6 · JMR

Sub-tabs: Measure · Build abstract · Measured vs certified · Register.

- Measure against a **real `in4_wo_boq_items` item**, never free text: location,
  date, who measured, quantity, photo.
- Build abstract rolls the measurements into IN4's shape — `WORK_ORDER_ID`, then
  per line `BOQ_ITEM_ID`, executed quantity, rate.
- Measured vs certified compares against `in4_wo_abstract_items` per bill.
  Bills before the app go in as **not measured** — never backfill from the
  certified figure.
- Tolerance for flagging a difference is a **setting**, and differs by unit.
- IN4's measurement book is empty across all 2,874 abstracts and `IS_FROM_MBOOK`
  is 0 on every one. This record exists nowhere else.

---

## 7 · SC Budget

A report, not a dashboard: every category with its sub-categories clubbed
underneath in one continuous sheet, no expanding, with a grand total. Columns:
category/sub-category · SC estimate · Budget (ERP) · Over budget · WO/PO · Paid ·
Balance · % used. Excel and Print in the toolbar. Sub-tabs: Report · Category
totals · Contractors.

---

## 8 · Accounts

Sub-tabs: Payment reports — FY wise · Month wise · Reconcile with trust accounts ·
Party ledgers.

- FY and month splits from contractor certificate dates.
- **Party ledgers in Tally format**: Date · Particulars (Dr/Cr) · Vch Type ·
  Vch No. · Debit · Credit · Balance, with opening and closing balance and
  current totals. The gross bill credits the party; retention, advance recovery,
  deductions and the payment debit it. **Vch No. is IN4's invoice number** — that
  is what reconciles to the physical bill.
- Party ledgers open **only with CS approval**.
- Reconcile with trust accounts has no source yet — the trust ledger isn't in IN4.

---

## 9 · Known gaps to raise, not to code around

- `in4_supplier_certificates` has **no date column** — supplier payments can't be
  placed in a month or FY. ₹1.18 Cr of the ₹21.37 Cr paid is undated.
- Duplicate certificates: WO 623 has 12 abstracts but 15 certificate rows — one
  advance and two superseded bills (GHB/03, GHB/10 each twice). De-duplicate
  against `ABSTRACT_ID` or certified totals double-count.
- WO 623 is billed at 118% of order value while its BOQ shows 95.17% executed.
- IN4 has **no indent import and no abstract import**. Both are hand-keyed.
- The BOQ importer has 95 template downloads since March 2023 and **zero uploads**.
  Confirm with In4Velocity that the import is enabled before building on it.

---

## 10 · Rules that hold everywhere

- **No derived figures.** A column shows what IN4 holds or it shows `n/a`. Never
  back-calculate a quantity from an amount ÷ rate.
- Tree view everywhere, and the same spine — category → sub-category — so figures
  on one screen trace to another.
- Money right-aligned, tabular, Indian grouping, zero decimals except in the
  Tally ledger.
- Every screen ships phone and desktop in the same change.
- `position: sticky` is inert if any ancestor sets `overflow-x: auto`. Give the
  scrolling region its own `overflow-auto` + `max-h` container.
- Show the Supabase `error`, never a silent empty state.
- Every figure-producing function gets a test with a real IN4 case and its
  expected rupee value.
