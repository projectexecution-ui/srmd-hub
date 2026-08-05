# CT HUB — Future-Proofing Roadmap: retiring IN4 & Zoho

**Goal (Aksha, 2026-08-05):** eventually shut down **IN4** (the construction ERP, fed to
CT HUB by weekly Excel exports) and **Zoho** (Zoho Projects — contractor bills + scheduling),
and make **CT HUB the full-featured system of record** for the whole project process.

This is the migration strategy. The live problem backlog is [`TEAM_PROBLEMS.md`](./TEAM_PROBLEMS.md);
this doc sequences the big builds that let us switch the old systems off. Companion to the
guiding direction: **one central per-project cockpit, not many separate trackers.**

---

## 1. Where we stand today — CT HUB is a "watch tower"

CT HUB reads IN4 and Zoho and shows them back clearly, but **the data is born in IN4/Zoho,
not in CT HUB.** To retire them, CT HUB has to become the place the work is actually *created*,
not just observed.

**Already ours — born in CT HUB (native today):**
Cost Control (working sheets, budgets, the PH → Atm → Trustee approval chain), Vendors,
Projects, JMR / Machinery, Inventory, Comparison Maker, Daily Site Report, Established-Rates
storage, Command Centre (Gmail triage), the Blueprint SLA sandbox, and all users/roles/approvals.

**Still IN4's — we only watch (import-only from weekly Excel):**
Indents, Purchase Orders, GRNs, Invoices, Payments (all read-only mirrors), the Budget/BPH
numbers, contractor certificate accounting (Contractor Report), supplier payment accounting
(Supplier Report), and the rate / WO-history library.

**Still Zoho's — we only watch (live read-only API pull):**
Contractor bills (each Zoho Projects task = one SRA/SRET bill: stages, RA numbers,
claimed/certified/paid amounts, Trust submission) and all site **scheduling** (Zoho Projects
is external — not wired into CT HUB at all).

---

## 2. How a project flows (the three chains)

| Chain | Steps | Who owns it today |
|---|---|---|
| **Procurement** | Indent → PO → GRN → Invoice → Payment | **IN4 owns every step.** CT HUB is read-only. |
| **Cost Control** | Draft → Project Head → Atm Head → Trustee → Approved → **[manual re-key into IN4]** → WO issued | **Native until the last hand-off** — CT HUB approves, then a human re-types the Work Order into IN4. |
| **Contractor bills** | Site Head → CT → Billing → Trust A/c → Payment Done | **Zoho owns the blueprint.** CT HUB is read-only. |

Two future chains have **no code yet** (backlog #2, #3): **Drawings → Budget → Work Order**
and a **simple schedule tracker** with Work Orders built in.

---

## 3. What must become native before the switch-off (the 8 builds)

1. **Native Indent → PO → GRN → Invoice → Payment pipeline** — today all five are read-only IN4 mirrors; `/payments` doesn't even exist. *(replaces IN4 — the core)*
2. **A native Work Order object + issuance** — replaces the IN4 WO and the manual re-key at the end of Cost Control. Cost Control already approves; it just can't *issue*. *(replaces IN4)*
3. **Native contractor-bill workflow** — stages, RA numbers, claimed/certified/paid, Trust submission — reusing the Blueprint SLA engine. *(replaces Zoho)*
4. **Native budget authoring** — let PMs own the budget in Cost Control (`cc_budget_lines` already exists), retire the weekly IN4 BPH Excel. *(replaces IN4)*
5. **In-app schedule tracker** with Work Orders linked to tasks/milestones. *(replaces Zoho Projects — brand-new)*
6. **Drawings → Budget → Work Order pipeline** — per-project blocked-by/SLA tracker; needs `drawings` + `work_orders` tables. *(brand-new)*
7. **A real ingestion/entry pipeline that writes the master tables** — today `/uploads` says the import pipeline is "planned for v2"; until then CT HUB can only observe. *(replaces IN4)*
8. **Rate / WO-history authoring** — replace the IN4 Abstract/WO-Detail imports feeding `est_rates`. *(replaces IN4 — lower priority)*

---

## 4. The phased plan (risk-ordered: greenfield wins → smaller system → core ERP → cutover)

### Phase 0 — Foundation & decisions *(now)*
Lock the process map (this doc). Decide the **one big fork** below. Confirm who owns each step
in real life. The two AI modules (photo QA + "Ask AI", backlog #4/#5) can run in **parallel** —
they don't depend on the ERP cutover.

### Phase 1 — Own the greenfield (schedule + Dwg→Budget→WO + daily entries)
Build the native **schedule tracker** (#3) and the **Drawings → Budget → Work Order** pipeline
(#2), plus tighten **daily site entries** (#1). These replace *external Zoho Projects / manual
work*, so there's nothing to break — low-risk wins that also **create the Work Order object**
we need later. Directly clears the 🔴 backlog items.

### Phase 2 — Replace Zoho (contractor bills)
Build the native contractor-bill workflow on the Blueprint SLA engine. Once bills are *created*
in CT HUB, retire the Zoho pull. Zoho is the smaller, self-contained system (one live
integration) → the right first retirement.

### Phase 3 — Replace IN4 (the core ERP)
The big one, done module-by-module: native Indent → PO → GRN → Invoice → Payment, Work Order
*issuance* wired off Cost Control's existing approval, native budget authoring (retire the BPH
Excel), then rates. Run **in parallel with IN4** for a reconciliation period per module.

### Phase 4 — Switch off & reconcile
Run both systems for one full cycle, reconcile the numbers, then decommission IN4 and Zoho.

---

## 5. The one big decision (blocks the shape of Phase 3)

**Full ERP replacement vs. operational-layer ownership.** Do we want CT HUB to become the
*complete* system of record — including the accounting book (POs, payments, GST/TDS, statutory
audit) — or do we keep IN4 as the **accounting ledger** and make CT HUB own the **operational
layer** (indents, WOs, schedule, bills, budgets) with a sync/export back to IN4? This changes
the whole scope and risk of Phase 3.

**Open gap questions to lock the roadmap:**
- Is there truly **no IN4 API / DB access** — only Excel exports? (Decides native-entry vs two-way sync.)
- The Zoho bill stages (Site Head → CT → Billing → Trust → Paid) — are those the real stages, and **who moves each**?
- Do POs/payments need to stay in IN4 for **statutory / audit** reasons (GST, TDS, books)? If yes, full replacement may be off the table and CT HUB becomes the operational front with an export to IN4.
