# Internal Budgets — June-2026 wave: parser verification (17 files)

Run date: 2026-07-12 · Parser: `lib/cost-control/internal-budget-parse.ts` (18 unit tests green)
Source root (MASTER FILES — read-only, never modified):
`G:\Shared drives\09.01 SRM Construction Atmarpits Core Team\03 Budgets & Costing & Approvals\02 Internal Budgets`

Every file parsed with the "Internal Estimated Budget / Internal Budget" money pair
(the internal number, never the Consultants/CS pair). `itemSum` = Σ of every captured
line; `footer` = the file's own "Total Amount with GST (A)". Remarks (col K) are
captured per line. Uncoded prose rows and category-level lump figures are captured
as code-null sub-skills — **no money row is dropped anywhere**.

| File | Project | Area (sft) | Disc | Subs | Working tabs | Σ items (₹) | File total (₹) | Δ |
|---|---|---|---|---|---|---|---|---|
| V9 Internal Budget SRAH 24.6.26 | SRAH (new) | 3,215 ⚠ | 21 | 106 | 0 | 56,78,63,342 | 56,78,63,342 | 0.0% |
| V1 Welcome Centre - Internal Budget 260626 | WCE (new) | — | 15 | 36 | 0 | 4,32,97,031 | 4,32,97,031 | 0.0% |
| V1 Ekant Kutir - Internal Budget 260626 | EK (new) | 3,450 | 12 | 28 | 0 | 2,43,11,429 | 2,43,11,429 | 0.0% |
| V1 Row House - Internal Budget 260626 | NRH (new) | — | 14 | 41 | 0 | 21,97,40,347 | 21,97,40,347 | 0.0% |
| V2 P2 5STs Infra Budget -Jun 26 | P2 (umbrella) | 1,49,189 | 15 | 40 | 0 | 24,57,62,230 | 24,57,62,230 | 0.0% |
| V1 P2 A01 Internal Budget Jun-26 (03 A-03 folder) | P2 A03 | 72,000 | 17 | 32 | 0 | 27,71,65,000 | 27,71,65,000 | 0.0% |
| V1 P2 A02 Internal Budget Jun-26 | P2 A02 | 72,000 | 17 | 32 | 0 | 27,71,65,000 | 27,71,65,000 | 0.0% |
| V1 P2 A01 Internal Budget Jun-26 | P2 A01 | 72,000 | 17 | 32 | 0 | 27,71,65,000 | 27,71,65,000 | 0.0% |
| V2 VV Infra Budget Jun-26 | VV (umbrella) | 59,202 | 14 | 26 | 0 | 12,99,67,098 | 11,49,67,098 | 13.0% ⚠ |
| V3 Vivek Internal Budget Jun-26 | VIVEK | 64,000 | 17 | 32 | 0 | 24,92,55,000 | 24,92,55,000 | 0.0% |
| V4 Vinay Internal Budget Jun-26 | VINAY | 64,000 | 17 | 32 | 0 | 24,92,55,000 | 24,92,55,000 | 0.0% |
| V8 NGH_INFRA Internal Budget Jun-26 | NGH (umbrella) | 1,43,269 | 16 | 38 | 0 | 18,41,84,025 | 18,41,84,025 | 0.0% |
| V6 NGH_C Internal Budget Jun-26 | NGH C | 83,500 | 18 | 28 | 2 | 34,76,29,349 | 34,76,29,349 | 0.0% |
| V8 NGH_B Internal Budget Jun-26 | NGH B | 65,400 | 23 | 54 | 16 | 20,93,74,786 | 20,83,74,786 | 0.5% ⚠ |
| V7 NGH_A Internal Budget Jun-26 | NGH A | 56,000 | 19 | 48 | 16 | 20,10,00,488 | 20,10,00,488 | 0.0% |
| V1 CV5 Internal Budget_YM_200626 | CV5 (new) | 240 | 8 | 12 | 0 | 11,99,654 | 11,99,654 | 0.0% |
| V1 CV4 Internal Budget_YM_180626 | CV4 (new) | 2,300 | 9 | 15 | 0 | 1,10,00,341 | 1,10,00,341 | 0.0% |

## ⚠ Findings for Aksha's review (Excel-side, NOT parser errors)

Both non-zero deltas are inconsistencies **inside the source Excels themselves**,
verified by reading the footer cell formulas. The parser keeps the itemized rows
(so no data is lost); the files' own totals are the smaller number.

1. **VV-Infra (+₹1,50,00,000)** — "Gabion Wall" ₹1.5Cr (remark: *"for 6m height -
   200m length - considered…"*) is itemized under "Retaining Walls & Gabion Walls",
   but that section's Category Total (₹3,49,17,000) only covers the two RCC walls,
   and the file's footer is `SUM(I8:I136)` over Category Totals — so the file's own
   total **excludes** the Gabion Wall line. Decide: include (Σ ₹12.99Cr) or match
   the file total (₹11.49Cr).
2. **NGH-B (+₹10,00,000)** — "1501 Landscape…" ₹10L is itemized (col M) but the
   footer is `SUM(N9:N175)` over Category Totals and its category's total misses
   this line. Same decision as above.
3. **SRAH area** — the file's area cell reads **3,215 sft**, which puts the budget
   at ≈ ₹1.77 lakh/sft. That is implausible for ₹56.78Cr of work; the ₹/sft notes
   for SRAH should not be trusted until the real built-up area is confirmed.

## What "captured" includes
- Coded disciplines ("03 Civil") and coded sub-skills ("302 Steel Works"), with
  decimal variants (715.1/715.2) rolled up under the master code.
- Prose sections of the Infra variant ("Compound Wall", "Earthworks") — discipline
  code derived from their first coded sub-skill (1605 → 16).
- Uncoded prose money rows ("Substation/HT Building", "CSS", "RCC Retaining
  Walls - C") — captured as code-null sub-skills for master-mapping at ingestion.
- Category-level lump figures with no item rows ("Special Item - Auditorium"
  ₹25L, "20 Extra Works" ₹25L) — captured as single lump sub-skills.
- Per-line **remarks** (col K) — e.g. thumbrule notes, "as per sheet attached".
- Per-code working tabs (NGH A: 16, NGH B: 16, NGH C: 2) as working lines.
- Area (sft) from the title block where present.

Total across the wave: **₹3,51,55,25,347** captured line-by-line (Σ items).
