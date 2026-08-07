# Rebuild IN4 as CT Hub's own ERP — Engineering · Purchase · Admin

**Ask (Aksha, 2026-08-07):** make a "copy" of the IN4 ERP modules SRMD actually uses —
**Engineering, Purchase, Admin** — import all IN4 data, and start CT Hub's own ERP so the
whole project process lives in one app.

This is the parked [`FUTUREPROOF_ROADMAP.md`](./FUTUREPROOF_ROADMAP.md) plan, sharpened to the
three modules in use and a concrete import. Visual version: Artifact
`https://claude.ai/code/artifact/76109c61-46ef-4616-8e59-4ba47f256da1`.

> Research basis: **IN4 = In4Suite® (In4Velocity Systems, Bangalore)** — a purpose-built
> real-estate & construction ERP. Module structure + the budget→commitment→actual→AP spine are
> high-confidence from In4Velocity's own material. **To verify with SRMD's IN4 partner:** the exact
> export column headers and the DB engine (MS SQL Server assumed) — their live manual
> (help.in4suite.com) was down during research.

---

## 1. Where CT Hub stands today (a "watch-tower" over IN4)

| Module | Coverage | Reality |
|---|---|---|
| **Admin** | **~95% — effectively done** | Dynamic roles, one config-driven approval engine + audit across every module, per-user overrides, multi-channel notifications + cron. Richer than IN4's admin. |
| **Engineering** | **~75% — strong** | Cost Control (budget → 3-stage approval → tranche release → IN4-entry tracking → BPH actuals), Inventory/WMS, JMR measurement + running bills, Schedule/WO tracking, rate library, Comparison Maker. |
| **Purchase** | **~20% — the real work** | Indents / POs / GRNs / invoices / payments are **read-only mirrors** of IN4 Excel exports (only indent *notes* are editable; `payments` is a stub). |

**One-line truth:** ~80% there on Engineering + Admin. The one-stop app hinges on making
**Purchase** a system of record, then wiring a real **Work Order** into the Cost Control approval
that already exists.

---

## 2. The data spine to replicate (from In4Suite)

```
BUDGET ──▶ COMMITMENT ──▶ ACTUAL ──▶ AP LIABILITY ──▶ PAYMENT ──▶ (JV → GL)
(work cat) (WO / PO)     (measure/GRN) (RA/supplier bill)          ledger
  HAVE       BUILD        PARTIAL         BUILD          BUILD       DECIDE
```
- **Engineering:** Budget → BOQ → Work Order → site measurement/abstract → **RA (running) bill**
  (auto retention / advance recovery / TDS / GST) → certified to AP. Approval: Site Eng → QS → PM → Finance.
- **Purchase:** Indent/PR → RFQ + quote comparison → PO (incl. import PO) → GRN → supplier bill → payment;
  plus returns, inter-site transfers, scrap.
- **Admin:** users, RBAC, generic per-doc-type approval engine (SLAs), shared masters, DMS, audit trail.

---

## 3. Module-by-module: keep vs build

### Purchase — ~20%, the biggest gap (turn mirrors into native transactions)
| Capability | CT Hub today | To build |
|---|---|---|
| Item / material master | Scattered (inv_items, est items) | One unified item master — code, UOM, HSN, GST%, category |
| Vendor + contractor master | **Native** | Add GSTIN/PAN/terms/TDS section + evaluation |
| Indent / requisition | Read-only mirror | Native create + approval (engine exists) + collation for bulk buys |
| RFQ + quote comparison | **Native** (Comparison Maker) | Wire comparison → award → PO |
| Purchase Order | Read-only mirror | Create off indent/award + multi-level approval + PDF + budget commitment |
| GRN / goods receipt | Read-only mirror | Receive against PO, update stock, accepted/rejected qty |
| Supplier bill / invoice | Read-only mirror | Native bill + 3-way match (PO·GRN·bill) + deductions |
| Payment | Missing (stub) | Payment record + vendor ledger / ageing |
| Material reconciliation | Missing | GRN ↔ indent ↔ issue ↔ BOQ consumption, book vs physical |

### Engineering — ~75%, extend the edges
| Capability | CT Hub today | To build |
|---|---|---|
| Budget by work category | **Native** (Cost Control + BPH) | — |
| BOQ + rate library | Native-ish (est_rates, cc items) | Formalise BOQ master + templates |
| Estimate → approval | **Native** (PH → Atm Head → Trustee) | — |
| **Work Order (commitment)** | Tracking flag only | Real WO document issued off approval — **kills the manual re-key into IN4** |
| Site measurement / abstract | Partial — JMR = machinery/manpower only | **Civil-works measurement book** vs BOQ |
| Contractor RA / running bill | Partial (JMR bills; Zoho for SRA) | Civil RA bill: cumulative qty, retention, advance, TDS, GST |
| Inventory / stock at site | **Native** (full WMS) | — |
| Schedule / progress | **Native** (new) | Link WO ↔ schedule item |

### Admin — ~95%, effectively done
RBAC (dynamic roles + matrix), generic approval engine (per doc type, SLA), audit/versioning,
notifications — all **native**. Add UOM/tax/cost-centre masters; upgrade per-module file storage
to a central tagged DMS. This already mirrors In4Suite's "shared masters + one workflow engine"
architecture — validating the hub's *shared-module-infra* principle.

---

## 4. Importing IN4 data (three waves)

1. **Masters first** — items, vendors, contractors, UOM, tax, cost-centres/projects, BOQ & rates.
   Much already in CT Hub (vendors, projects, established-rates, disciplines) — merge, don't start cold.
2. **Open transactions** — open POs, open indents, un-billed GRNs, WOs with balance qty, unpaid bills,
   current stock balances. What you operate on from day one.
3. **History for continuity** — closed registers (PO/GRN/bill/RA) for reporting & search only.
   A **crosswalk table** maps each old IN4 code → new ID so old document numbers still resolve.

- **Best path:** In4Suite is very likely **MS SQL Server** → ask the IN4 partner for a **SQL backup /
  ODBC export** (highest fidelity, one shot). *Confirm the engine.*
- **Fallback:** the Excel register exports — and **CT Hub already parses IN4 Excel** today
  (procurement-tracker, BPH budget, established-rates), so those importers are reused.

---

## 5. Phased roadmap (risk-ordered; parallel-run before switch-off)

- **P0 · Decide & get access** — lock the two decisions (below); get IN4 export (SQL backup or register
  Excels); confirm master lists with whoever runs IN4 for SRMD.
- **P1 · Shared masters + import** — one item master; UOM/tax/cost-centre masters; formalise BOQ master;
  import wave 1. Reuses vendors/projects/rates.
- **P2 · Purchase, made native (the big one)** — indent → comparison → PO → GRN → supplier bill →
  payment + vendor ledger + material reconciliation. Import open transactions; run in parallel with IN4.
- **P3 · Engineering: Work Order + measurement** — issue a real WO off the Cost Control approval (ends the
  re-key); add a civil measurement book + RA bill. Budget → commitment → actual now fully native.
- **P4 · Ledger + cutover** — either native payments + AP (+ JV/GL push) **or** keep IN4/Tally as the
  accounting book and sync to it. Run one full cycle in parallel, reconcile, decommission.

---

## 6. Three decisions only Aksha can make

1. **Replace IN4's accounting too?** Own operations (indents/POs/WOs/bills/budgets) but keep IN4 or Tally
   as the *accounting ledger* (GST/TDS/statutory books) — or replace the ledger as well?
   **Recommendation:** keep a ledger downstream at first (In4Suite itself posts journals to Tally/SAP —
   proven, lower-risk); decide full replacement after a parallel-run.
2. **IN4 data access?** Full SQL Server backup / ODBC pull, or only Excel register exports? Decides import
   fidelity. Either works (CT Hub already reads IN4 Excel); a DB dump is one clean shot.
3. **How to start?** Big-bang import + go-live, or module-by-module parallel-run?
   **Recommendation:** parallel, **Purchase first** (it's the gap), then the Engineering Work Order.
   Nothing switches off until a full cycle reconciles.
