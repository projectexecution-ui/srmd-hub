# IN4 database → CT Hub: what backs each report we upload

**Phase 0 of the IN4 live-data plan. Read-only reconnaissance, 3–4 Sept 2026.**
Companion to `scripts/in4-explore.mjs`. Nothing here has been built yet — this is the
map the build follows.

## Connection facts

| | |
|---|---|
| Server | `mssql-rds.srmd.org:2609` → AWS RDS **us-east-1**, SQL Server 2022 (RTM-CU22) |
| Database | **`In4re`** (the only user database the login can open; 20 others on the instance are unreachable to it) |
| Login | `in4reuserdbo` — **read-only** (`fn_my_permissions` shows no INSERT/UPDATE/DELETE/ALTER; server-level: CONNECT SQL, VIEW ANY DATABASE) |
| Can it read code? | **No.** 0 of 3,735 procedure/view definitions are visible and `sys.procedures` returns 0 rows. We can `SELECT` from every view and table, but not read how a view is built. So the report SQL cannot be copied — it has to be reproduced from base tables/views, and every reproduction is validated against a real Excel export. |
| Reachability | TCP handshake succeeds from Aksha's laptop (and, per commit `3750c9d`, from outside SRMD's network). Vercel `bom1` → Virginia ≈ 200 ms per round trip: fine for batch sync, wrong for per-page reads. **Everything syncs into Supabase first; pages read Supabase.** |
| Credentials | `.env.in4.local` (git-ignored). Production: Vercel env vars `IN4_DB_HOST/PORT/NAME/USER/PASSWORD`. Never in the repo. |

**Security note (raised separately with Aksha):** the ERP database accepts connections from the whole internet. Ask In4Velocity to restrict inbound to an allow-list. A read-only login with a long password over TLS is the minimum posture and is what the scripts enforce.

## How IN4's own reports are organised (why this matters)

IN4 keeps its report catalogue in the database (`COMMON.REPORT_LIST_VIEW`, `Report.DYNAMIC_REPORT_CONFIG_HEADER`). Two things fell out of reading it:

1. **"BPH" is not "Budget Performance Hub".** It is the suffix In4Velocity puts on reports built for another client (BPH), then reused for SRMD — alongside `(Kolte)`, `(Rajapushpa)`, `(Everstone)`. The budget report we upload is one of the `…(BPH)` dynamic reports (most likely *Consolidated Budget Report(BPH)* or *Construction Budget Report for Project(BPH)*). Their procedures are hidden from our login, so the figures are reproduced from the tables below instead.
2. The other reports we upload are ASPX pages: *Indent to Issue report* (`ReportIndenttoIssue.aspx`), *All Types of Certificates Detail* (`AllTypesOfCertificateReports.aspx`), *PO Register report*, *Purchase Supplier Certificates*. Each sits on a named view that **is** readable — listed per report below.

Status codes used everywhere (`COMMON_STATUS_LOOKUP`): 1 Submitted · 2 Approved · 3 Rejected · 6 Cancelled · 13 Draft · 15 Paid · 54 Closed · 66 Terminated · 75 Partially Paid · 78 Amended & Approved · 113 Verify · 139 Submit-SRA PUR · 140 Submit-CT · 141 Verify-CT · 142 Verify-SRA PUR.

## Masters (the alias problem, solved at the source)

| Master | IN4 source | Rows | Notes |
|---|---|---|---|
| Projects | `ENGG_PROJECT` (ID, NAME, **EX_CODE**, PARENT_PROJECT_ID, CERT_COMPANY_ID, BUDGET_AMT) | 36 | `EX_CODE` is IN4's short code: NGH, VVST, P2ST, P2I, RU, SRAH, AB, EK, WCE, CVR… |
| Sub-projects | `ENGG_SUBPROJECT` (ID, PROJECT_ID, SUBPROJECT_NAME, **EX_CODE**, CONSTRUCTION_AREA_FEET, BUDGET, ISACTIVE, IS_COMMON_SERVICE) | 123 | Stage is in the name: `New Guest House A-Execution`, `…-Design`, `…-Professional Consultancy`, `…Common Expenses`. `EX_CODE` (NGHA, NGHCE, P2STEA01, VST01…) is the stable key to alias **to**, not the name. |
| Paying companies (trusts) | `ENGG_PROJECT.CERT_COMPANY_ID` → 2 SRM Trust · 3 SRASSK · 4 SRJT · 5 Fixed Assets | | The Bills Pipeline's SRA/SRET/SRJT split comes from here. |
| Work categories | `ENGG_SKILLS_LOOKUP` (ID, NAME, PARENT_ID, SHORT_NAME, isActive) | 89 categories, 317 sub-categories active | Two-level: `PARENT_ID = 0` = category (“03 Civil”, “05 Waterproofing Works”), else sub-category (“317 Civil Contractor Cost”, PARENT 1). The numeric prefix in NAME **is** the hub's `cc_disciplines.code` / `cc_sub_skills.code`. Also as BI views `BI.DIM_SKILLS_CATEGORY`, `BI.DIM_SKILLS_SUBCATEGORY`. |
| Contractors | `ENGG_SERVICE_PROVIDER` (ID, FIRM_NAME, PAN_NO, GSTIN_NO, MSME_NO, VENDOR_CODE, IsActive) | 422 | |
| Suppliers | `BI.VENDOR_MASTER` (VEN_ID, VEN_CODE, VEN_NAME, VEN_TYPE, PAN_NO, ADDRESS…) · `COMMON_VW_VENDOR_DETAILS` | 51 / all modules | |
| Materials (items) | `PURCH_MATERIAL_LOOKUP` (ID, NAME, CODE, LONG_NAME, SHORT_NAME, UNIT_OF_MEASUREMENT, HSN_ID, ISACTIVE, MATERIAL_SUBTYPE_ID) | 3,972 | Hierarchy `PURCH_MATERIAL_TYPE_LOOKUP` → `PURCH_MATERIAL_SUBTYPE_LOOKUP` → material. The hub's `wh_items.in4_name` matches `NAME`; `ID` is the key to store. |
| UOM | `UNIT_OF_MEASUREMENT` id → name appears as `INDENT_BASE_UOM` / `ORDER_UOM_NAME` in the views | | |

Hub side today: 41 live `projects`, 36 `cc_bph_project_links` (all pulled 3 Sept), 4 BPH projects unlinked (Naturopathy, Old Swadhyay Hall, Raj Saurabh – Interior Scope, Raj Uphaar – Interior Scope).

## Report → source, one by one

### 1 · Budget report (the "BPH" upload → `/budget`, Budget vs Actual V2, Internal Estimate ERP columns)

What the hub reads from the Excel (`public/budget-hub.html` → `lib/budget-v2.ts`, `cost-control/import/bph/actions.ts`): per **Sub Project × Work Category × Sub Skill** — *Budget Amount*, *Approved Amount* (WO/PO), *Gross Bill Amount*, *Advance Balance for Recovery*, *Total Paid Including Advance*; categories tagged `(M)` material vs untagged contractor.

| Figure | IN4 source | Grain |
|---|---|---|
| Budget (contractor + material) | `ENGG_SUBPROJECT_BUDGET` (SUBPROJECT_ID, SKILL_ID, Budget_Allocated, IS_BUDGETED, ENGG_BUDGET_PERIOD_ID) — SKILL_ID is a category **or** a sub-category, so the sub-skill rows come straight out | sub-project × (sub-)skill |
| Budget / WO-PO / Certified, category level, split ENGG vs MAT | **`QLIKVIEW_COST_REPORT_BUDGET`** (RTYPE ENGG\|MAT, RSUBTYPE BUDGET\|WO/PO\|CERT, SUBPROJECT_ID, CATEGORY, VALUE) — a live view, 15,305 rows | sub-project × category |
| WO value per WO, with category | `BI.ENGG_WORK_ORDER_DETAILS` (WO_ID, SUBPROJECT_ID, WORK_CATEGORY_ID, WORK_SUBCATEGORY_ID, WO_VALUE, WO_PAID_AMT, STATUS) / `ENGG_WORK_ORDER` | work order |
| WO split across categories | `ENGG_WORK_ORDER_SUBPROJECT_CATEGORY_DETAIL` (WORK_ORDER_ID, SUBPROJECT_ID, CATEGORY_ID, SUBCATEGORY_ID) — 2,305 rows | WO × category |
| Contractor certified / gross / paid | `ENGG_RPT_WO_CERTIFICATE_DETAILS` joined to `ENGG_WORK_ORDER` for project/category | certificate |
| Supplier certified / paid per sub-skill | `PURCH_VW_SUPLIER_CERTIFIED_AMOUNT_SKILL`, `PURCH_VW_SUPPLIER_PAID_AMOUNT_SKILL` (SUBPROJECT_ID, SKILL_ID, SUBSKILL_ID, amounts) | sub-project × sub-skill |
| Budget totals cross-check | `FINANCE_DASHBOARD_COST_REPORT_BUDGET` (ENGG 110 rows ₹267.83 Cr · PURCHASE 55 rows ₹68.27 Cr) | sub-project |

**Validated on NGH A (`ENGG_SUBPROJECT.ID = 43`) against the hub's `cc_budget_lines`:**

| Line | IN4 | Hub | |
|---|---|---|---|
| 317 Civil Contractor Cost — budget | 7,67,00,000 | 7,67,00,000 | ✓ |
| 03 Civil — WO/PO and certified | 6,66,55,030 | 6,66,55,031 | ✓ |
| 05 Waterproofing — WO/PO | 61,70,345 | 28,78,809 + 14,54,478 + 18,37,059 = 61,70,346 | ✓ |
| 12 Finishes — WO/PO | 79,92,750 | 51,18,500 + 28,74,250 | ✓ |
| 08 Plumbing (M) — certified / WO | 9,90,244 / 10,30,174 | 9,90,245 / 10,30,175 | ✓ |
| 501/502/503, 207/208, 1105, 1207, 1209 — budget | equal | equal | ✓ |
| 310 Door & Window Sills — budget | 7,00,310 | 17,76,948 (hub edit 18 Aug) | hub-side revision, expected |

So: the hub's BPH numbers **are** `ENGG_SUBPROJECT_BUDGET` + `QLIKVIEW_COST_REPORT_BUDGET`, rounded. "Paid" in the hub is IN4's *certified* (CERT) figure — worth naming honestly when the sync lands.

### 2 · Indent → PO tracker (`PURCHINDENT_TO_ISSUE_RPT` + `PUR_PurchaseOrderReport` → `/procurement-tracker`, Warehouse sync)

| Excel | IN4 source |
|---|---|
| `PURCHINDENT_TO_ISSUE_RPT` (banded: WO category / contractor / WO no / indent no, type, date / material, qty, UOM / supplier, PO no, date, qty / GRN no, date, qty, rate, value) | **`PURCH_INDENT_TO_ISSUE`** (view; also `PURCHASE_INDENT_TO_ISSUE` TVF). One row per indent-item × PO × GRN. Columns match the parser's `C` map one-for-one: PROJECT_NAME, SUBPROJECT_NAME, WO_SKILL_NAME, WO_DISPLAY_NO, WO_SERVICE_PROVIDER_NAME, MATERIAL_TYPE, MAT_SUBTYPE, MATERIAL_NAME, INDENT_DISPLAY_NO, INDENT_STATUS, INDENT_CREATION_DT, INDENT_QTY_BASE_UOM, INDENT_BASE_UOM, INDENT_TYPE, INDENT_RATE, INDENT_VALUE, PO_DISPLAY_NO, PO_SUPPLIER_NAME, PO_STATUS, PO_CREATED_DT, PO_ORDER_QTY_IN_BASE_UOM, PO_ORDER_RATE_IN_BASE_UOM, GRN_DISPLAY_NO, GRN_DC_NO, GRN_DATE, GRN_STATUS, GRN_QTY_RECD_BASE_UOM, GRN_DEFECTIVE_QTY…, GRN_RATE, GRN_VALUE, ISSUE_*, CLOSED_FOR_PO, CLOSED_FOR_ISSUE. **5,586 rows · 1,124 indents · 1,358 POs · 1,560 GRNs · latest indent 3 Sept 2026.** |
| `PUR_PurchaseOrderReport` (flat PO lines with rate) | **`PURCH_PO_VIEW_REPORT`** (PO_DISPLAY_NO, SUPPLIER_NAME, PO_STATUS, PO_CREATED_DT, MATERIAL_ID, ORDER_UOM_NAME, ORDER_QTY_IN_ORDER_UOM, RATE_FOR_ORDER_OUM, ORDER_RATE_IN_BASE_UOM, Landed_cost, Freight_Charge, Total_Amount, BrandName, Remarks, PROJECT_ID) + `PURCH_REPORT_VIEW_PO_PRJ_SPRJ` for sub-project. **4,873 lines · latest PO 2 Sept 2026.** Headers: `PURCH_PURCHASE_ORDER` (1,437), `PURCH_INDENT` (1,384). |
| BI alternative (already keyed by ids, no names to parse) | `BI.FACT_PURCHASE_INDENT_DETAILS`, `BI.FACT_PURCHASE_ORDER(_DETAILS)`, `BI.FACT_PURCHASE_GRN_DETAILS`, `BI.DIM_PURCHASE_ORDER_HEADER`, `BI.DIM_PURCHASE_GRN_HEADER`, `BI.DIM_MATERIALS`, `BI.DIM_SUPPLIER`, `BI.DIM_STORE` |

The tracker's `simplifyBlock` / `projectFromIndentNo` guesswork disappears: PROJECT_ID / SUBPROJECT_ID are columns.

### 3 · Contractor report (`All Types Certificates Details` → `/contractor-report`)

Excel columns the parser uses: work category, WO number, contractor, WO value, gross bill, advance/misc/material/debit-note recovered, tax deduction, retention, other deduction, amount paid, outstanding; markers for project/sub-project.

| IN4 source | Notes |
|---|---|
| **`ENGG_RPT_WO_CERTIFICATE_DETAILS`** — CERTIFICATE_TYPE, CERTIFICATE_ID, WORK_ORDER_ID, INVOICE_NO/DATE, STATUS_NAME, CREATION_DT, GROSS_AMT, CERTIFICATE_AMT, PAYABLE_AMT, PAID_AMT, Amt_Outstanding, RETENTION_AMT, TAX_DED, ADDITIONAL_DEDUCTION_AMT, ADVANCE_RECOVERY_AMT, MISC_EXPENSE_RECOVERY_AMT, MATERIAL_ADJUSTMENT, DEBIT_NOTE_RECOVERY_AMT | Every Excel column has a counterpart. Join `ENGG_WORK_ORDER` (PROJECT_ID, SUBPROJECT_ID, SKILL_ID, SUB_SKILL_ID, SERVICE_PROVIDER_ID, DISPLAY_NO, WORK_ORDER_VALUE) → `ENGG_SERVICE_PROVIDER.FIRM_NAME`. **3,083 certificates · 11 Apr 2023 → 3 Sept 2026 · gross ₹153.19 Cr · paid ₹115.73 Cr.** |
| `PURCH_VW_WOCERTIFICATE_DETAILS_SRM` | An SRMD-specific flat view (Project, Sub Project, Paying Company, W.O. No., Work Categeory, Sub Work Category, Contractor Name, Bill No./Date, Work Order Value, Certified Amount, Amount Payable, Status, Last Submitted/Approved By). Good for the Bills Booking desk view (who signed what, when); dates are dd/mm/yyyy **text**. |
| `BI.ENGG_CONTRACTOR_OUTSTANDING_REPORT` | Per contractor × sub-project: WO_VALUE, WO_CERTIFIED_AMT, WO_GROSS_BILL_AMT, WO_PAID_AMT, WO_OUTSTANDING_AMT, advances, debit notes — the rolled-up version of the same thing. |
| ✗ `PURCH_VIEW_CONTRACTOR_CERTIFICATE_REPORT` | Broken ("binding errors") — do not use. |

### 4 · Supplier report (`All Purchase Payments Report` → `/supplier-report`)

Excel columns: PO no, certificate type/no, status, vendor, material type (category), invoice amt, tax deductions, total cost, advance recovered, debit-note recovered, retention, net payable, paid, outstanding.

| IN4 source | Notes |
|---|---|
| **`BI.FACT_PURCHASE_SUPPLIER_PAY`** — CERTIFICATE_ID, SUBPROJECT_ID, SUPPLIER_ID, MATERIAL_ID, WORK_CATEGORY_ID, PO_ID, GRN_ID, STATUS_ID, CERTIFIED_AMT, LANDED_COST, ADV_RECOVERY_AMT, PAYABLE_AMT, RETENTION_AMT, DEBIT_NOTE_ADJ_AMT, OTHER_DEDUCTION_AMT, TAX_DEDUCTION_AMT, PAID_AMT, CERTIFIED_OUT_AMT | **4,444 lines · 1,365 certificates · certified ₹22.13 Cr · paid ₹16.76 Cr.** Keyed by ids — join the masters above for names. |
| `PURCHASE_VIEW_SUPPLIER_CERTIFICATES_REPORT` | Named version: COPMANY_NAME, CERTIFICATE_NO, PROJECT_NAME, SUBPROJECT_NAME, CREATION_DT, CERTIFIED_AMT, PAYABLE_AMT, INVOICE_NO/DT/AMT, PARTY_NAME, MATERIAL_NAME (= category, e.g. "08 (M) Plumbing Works"), STATUS_NAME. 1,596 rows, latest 3 Sept 2026. Dates are text ("Sep 03, 2026"). |

### 5 · Established Rates (`ENGGBOQABSTRACTREPORT`, `ENGGWorkOrderDetailReport`) — module OFF today

`ENGG_BOQ_ITEMS` (13,448), `ENGG_BOQ_ABSTRACT_ITEMS` (12,212), `ENGG_WO_BOQ_PRINT_DETAILS`, `BI.FACT_ENGG_WORK_ORDER_BOQ_ITEMS`, `ENGG_VW_BOQ_ITEM_RATE_ABSTRACT_REPORT`, `ENGG_BOQ_ITEM_RATE_HISTORY_REPORT`. Deferred to Phase 4.

### 6 · Item master (Warehouse) — `PURCH_MATERIAL_LOOKUP` (see Masters). Phase 4.

## What the sync stores (design for Phase 1)

```
in4_sync_runs        (id, started_at, finished_at, source, rows, ok, error)
in4_projects         ← ENGG_PROJECT            (mirror, + hub_project_id via project_aliases)
in4_subprojects      ← ENGG_SUBPROJECT
in4_skills           ← ENGG_SKILLS_LOOKUP
in4_budget_lines     ← ENGG_SUBPROJECT_BUDGET  (snapshot per run: synced_at, is_current)
in4_cost_summary     ← QLIKVIEW_COST_REPORT_BUDGET (snapshot per run)
in4_work_orders      ← BI.ENGG_WORK_ORDER_DETAILS
in4_wo_certificates  ← ENGG_RPT_WO_CERTIFICATE_DETAILS (+ WO join columns)
in4_supplier_pay     ← BI.FACT_PURCHASE_SUPPLIER_PAY
in4_indent_to_issue  ← PURCH_INDENT_TO_ISSUE   (Phase 2)
in4_po_lines         ← PURCH_PO_VIEW_REPORT    (Phase 2)
```

Rules: raw columns kept as IN4 names; every row carries `synced_at`; snapshots (budget/cost summary) keep history so Budget vs Actual's week-over-week and "vs last revision" keep working; frozen hub snapshots (Warehouse `received_before_qty`) are never recomputed. The existing parsers/composers are pointed at these tables; the Excel upload buttons stay as a greyed fallback showing "last automatic sync …".

## Open decisions (Aksha)

1. **Cadence/hosting** — twice daily inside the existing Vercel cron dispatcher (free, nothing new), or hourly via a GitHub Actions schedule calling the sync route (free), or Vercel Pro. Recommendation: dispatcher first, GitHub Actions if hourly is wanted.
2. **Which BPH report exactly** is the weekly upload — *Consolidated Budget Report(BPH)* or *Construction Budget Report for Project(BPH)*? Not needed to build (the figures are reproduced from tables) but needed to validate one full Excel against the sync before switching the upload off.
3. **RDS exposure** — raise with In4Velocity.
