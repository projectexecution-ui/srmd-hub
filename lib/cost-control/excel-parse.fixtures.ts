// Literal AoA fixtures for excel-parse.test.ts. Each replicates the SHAPE
// of a real engineer working (synthetic values where noted, structure
// preserved — including real-world typos like "SCEHDULE"/"CONDTION").

import type { SheetInput } from './excel-parse'

// ─── Fixture A — MEP/plumbing BOQ: two-row header + approval ladder ───────
// Mirrors "48 FINAL FOR WO- SRA-NGH-B BUILDING PLUMBING BOQ...xlsx".

const N = null

export const MEP_MONEY_SHEET: unknown[][] = [
  [N, N, N, N, N, N, N],                                                           // R1
  ['PROJECT : SRASSK-NGH WING"B" (GUEST HOUSE ) , DHARAMPUR.'],                    // R2
  ['SUBJECT : PLUMBING WORK FINAL PRICE BOQ OF AMARANDER KAR & PARTY'],            // R3
  ['BUDGET : MAIN CATEGORY : 08 PLUMBING WORKS/ SUB CATEGORY : 805'],              // R4
  ['DATE : 10-04-2026'],                                                           // R5
  ['SR.NO', 'ACTIVITY', 'UNIT', 'QTY', 'AMAR PLUMBING', N, N],                     // R6 — header row 1
  [N, N, N, N, '"ITC" RATE', 'TOTAL AMOUNT', 'REMARK'],                            // R7 — header row 2
  ['A', 'INSTALLATION , TESTING & COMMISSIONING OF COMPLETE PLUMBING SYSTEM'],     // R8 — section head (no numbers)
  ['A.1', 'ITC OF COMPLETE PLUMBING SYSTEM PER TOILET', 'NOS', 64, 28000, 1792000],// R9
  ['A.2', 'MAKING & INSTALLTION OF IC BRICK CHMABER 900x450', 'NOS', 9, 0, 0],     // R10
  ['A.3', 'MAKING & INSTALLTION OF IC BRICK CHMABER 900x800', 'NOS', 6, 0, 0],     // R11
  ['A.4', 'MAKING & INSTALLTION OF CB BRICK CHMABER (RAIN WATER)', 'NOS', 13, 0, 0], // R12
  ['A.5', 'INSTALLATION OF 160MM UPVC FOAM CORE PIPE EXTERNAL', 'MTR', 190, 0, 0], // R13
  ['A.6', 'INSTALLATION OF 200MM UPVC FOAM CORE PIPE EXTERNAL', 'MTR', 240, 0, 0], // R14
  [N, ' 1. INTERNAL WATER SUPPLY WORK :'],                                         // scope notes
  [N, '2. INTERNAL DRAINAGE WORK :'],
  [N, '3. WATER SUPPLY LINE FOR VERTICAL SHAFT & TERRACE RING MAIN :'],
  [N, '4. FLOOR TRAPS & WATER COOLER:'],
  ['A', 'TOTAL  AMOUNT  INCLUDING TAX', N, N, N, 1792000, 'SUB CATEGORY : 805'],   // ladder: rank3 (with tax? "INCLUDING TAX")
  ['B', 'GST@18%', N, N, N, 'NA'],                                                 // GST "NA" → no amount → dropped
  ['C', 'MISCELLANEOUS AMOUNT FOR MATERIAL SHIFTING ETC.', N, N, N, 0],            // addon, 0
  ['D', 'TOTAL AMOUNT WITH TAX', N, N, N, 1792000],                                // rank 3
  ['D', 'APPROVAL FOR TOTAL AMOUNT TO ENTER IN ERP SYSTEM', N, N, N, 1792000],     // rank 3 — LAST → winner
  ['PAYMENT TERMS & CONDITIONS MENTIONED AS BELOW'],                               // tail junk
  [1, '20 % Payment Against Internal Water Supply CPVC Concealed work'],
  [2, '20 % Payment Against Internal S.W.R.P.V.C. work with fixing'],
  [3, '5% Retention Amount Will be deducted from Each RA bills'],
  ['TIME SCEHDULE'],
  [1, 'START DATE : 01-03-2025'],
  [2, 'HANDOVER DATE : 30TH AUGUST - 2026'],
  ['CONTACT DETAILS '],
  [1, ' Contact person : Amarendra Kar '],
  [2, 'Mo no . : 9702340217'],
]

export const MEP_DETAIL_SHEET: unknown[][] = [
  ['NGH WING B TOILET COUNT'],
  ['FLOOR', 'TOILETS'],
  ['GF', 12],
  ['FF', 14],
  ['SF', 14],
  ['TF', 12],
  ['FOURTH', 12],
]

export const MEP_TERMS_SHEET: unknown[][] = [
  ['PAYMENT TERMS AND CONDTION'],
  ['1', 'All payments against RA bills'],
  ['2', 'Retention 5%'],
]

export const MEP_WORKBOOK: SheetInput[] = [
  { name: 'AMARBHAI FINAL RATES FOR INSTAL', aoa: MEP_MONEY_SHEET },
  { name: 'NGH - WING -B TOILET COUNT DET.', aoa: MEP_DETAIL_SHEET },
  { name: 'PAYMENT TERMS AND CONDTION', aoa: MEP_TERMS_SHEET },
]

// ─── Fixture B — Civil estimate: ladder + slab-area trap ──────────────────
// Mirrors "QTY VINAY BUILDING (Amin).xlsx". Amounts are the real ones so the
// 1000x-trap assertion is meaningful.

export const CIVIL_MONEY_SHEET: unknown[][] = [
  ['AMIN DEVELOPERS'],
  [N],
  ['ESTIMATED QUANTITY OF VINAY BUILDING'],
  ['SR. NO', 'WORK CATEGORY', 'Item', 'DESCRIPTION', 'UNIT', 'ESTIMATED QUANTITY', 'RATE', 'AMOUNT', 'REMARK'], // header R4
  [1, 'Civil', 'Anti termite treatment', 'Providing and injecting preconstruction treatment', 'Sqm', 1500, 93, 139500],
  [2, 'Civil', 'Steel Work', 'Providing, straightening, cutting, bending'],                    // group parent — no amount
  [2, N, 'Steel Work', 'TMT or HYS reinforcement FE 500 grade', 'MT', 425, 80340, 34144500],
  [3, N, 'Plum Concrete M15', 'Plum Concrete M15 With 70% Conc.', 'Cum', 285, 6438, 1834830],
  [N, N, 'M15', 'M15', 'Cum', 125, 7004, 875500],
  [N, N, 'M30', 'M30', 'Cum', 350, 7674, 2685900],
  [N, N, 'M40', 'M40', 'Cum', 500, 8523, 4261500],
  [4, 'Civil', 'Ply Shuttering', 'Providing & fixing centring and shuttering', 'Sqm', 7500, 798, 5985000],
  [5, 'Civil', 'Add mixture', 'Dynamon SX 212 superplasticizing admixture', 'KG', 3924.25, 82, 321788.5],
  [6, N, 'RCC Water proofing agents', 'Adding water proofing agents in RCC', 'KG', 2500, 82, 205000],
  [7, 'Dowels & Re Barring', 'Re-barring', 'Providing and fixing HY 150 of HILTI'],             // group parent
  [N, N, '10 mm dia', '10 mm dia', 'Each', 300, 185, 55500],
  [N, N, '12 mm dia', '12 mm dia', 'Each', 300, 247, 74100],
  [N, N, '16 mm dia', '16 mm dia', 'Each', 300, 350, 105000],
  [8, 'Miscellaneo us Works', 'ManPower', 'Supplying of manpower for 8 hours'],                 // group parent
  [N, N, 'Mason', 'Mason', 'Nos', 20, 1185, 23700],
  [N, N, 'Male Coolie', 'Male Coolie', 'Nos', 50, 773, 38650],
  [N, N, 'Female Coolie', 'Female Coolie', 'Nos', 50, 773, 38650],
  [N, N, 'Carpenter', 'Carpenter', 'Nos', 25, 1185, 29625],
  [N, N, 'Fitter', 'Fitter', 'Nos', 25, 1185, 29625],
  [9, 'Miscellaneo\r\nus Works', 'Equipment', 'Mobile tower crane, 20 tons', 'Hrs', N, 1545],   // no qty/amount
  [N, N, 'Vibro Roller', 'Vibro Roller', 'Hrs', 25, 2060, 51500],
  [N, N, 'JCB Per Hrs', 'JCB Per Hrs', 'Hrs', 80, 927, 74160],
  [N, N, 'poclain machine Hrs', 'poclain machine Hrs', 'Hrs', 50, 3090, 154500],
  [N, N, 'Hitachi Breaker 200', 'Hitachi Breaker 200', 'Hrs', 50, 3811, 190550],
  [N, N, 'JCB Breaker', 'JCB Breaker', 'Hrs', 20, 2369, 47380],
  [N, N, 'Tractor', 'Tractor', 'Hrs', 20, 515, 10300],
  [10, 'Water proofing', 'Box Type', 'Providing and Laying box type waterproofing', 'Sqm', 650, 1648, 1071200],
  ['Sub Total', N, N, N, N, N, N, 52447958.5],                                                  // rank 1
  ['GST 18%', N, N, N, N, N, N, 9440632.53],                                                    // tax — kept
  ['Total Amount', N, N, N, N, N, N, 61888591.03],                                              // rank 1
  ['Payment RA01 on Previous WO', N, N, N, N, N, N, 2537095.58, '59,00,000 Advanced to Amin'],  // addon — kept (no double count)
  ['Total Estimated Costing', N, N, N, N, N, N, 64425686.61],                                   // rank 3 — WINNER
  ['Total Slab Area', N, N, N, N, N, N, 64268.4],                                               // rank 1 + EXCLUDED (area trap)
  ['Cost Per SqFt', N, N, N, N, N, N, 1002.45],                                                 // below winner → dropped
  ['NOTE :- This estimated quantity for Work order'],                                           // below winner → dropped
]

export const CIVIL_AREA_SHEET: unknown[][] = [
  [N],
  ['TOTAL SLAB AREA OF VINAY & VIVEK (20/09/2024)'],
  ['Sr.No', 'Description', 'Area in\r\nSqm', 'Area in\r\nSft'],
  [N],
  [1, 'G-2', 807.5, 8691.93],
  [2, 'G-1', 781.02, 8406.9],
  [3, 'Ground Floor', 755.49, 8132.09],
  [4, '1st Floor', 768.61, 8273.32],
  [5, 'Terrace Slab Area', 660.21, 7106.5],
  [N, N, 5970.68, 64268.4],
]

export const CIVIL_WORKBOOK: SheetInput[] = [
  { name: 'Eastimate from AMIN', aoa: CIVIL_MONEY_SHEET },
  { name: 'Area Statement', aoa: CIVIL_AREA_SHEET },
]

// ─── Regression fixtures — today's happy paths must not change ────────────

export const SIMPLE_BOQ: unknown[][] = [
  ['BOQ FOR PAINTING WORK'],
  ['Sr', 'Description', 'Unit', 'Qty', 'Rate', 'Amount'],
  [1, 'Internal painting on walls', 'Sft', 1000, 12, 12000],
  [2, 'External painting', 'Sft', 500, 18, 9000],
  [3, 'Primer coat', 'Sft', 1500, 5, 7500],
  ['', 'Grand Total', '', N, N, 28500],
]

export const SPLIT_COLUMNS: unknown[][] = [
  ['Sr', 'Description', 'Unit', 'Qty', 'Supply Rate', 'Erection Rate', 'Total Rate', 'Amount'],
  [1, 'HVAC ducting', 'Kg', 100, 300, 150, 450, 45000],
  [2, 'Grills & diffusers', 'Nos', 20, 800, 200, 1000, 20000],
  ['', 'Total', '', N, N, N, N, 65000],
]

// ─── Edge fixtures ─────────────────────────────────────────────────────────

export const NO_HEADER_SHEET: unknown[][] = [
  ['Meeting notes 12 April'],
  ['Discussed plumbing vendor'],
  ['Follow up next week'],
]

export const TOTAL_ONLY_SHEET: unknown[][] = [
  ['SUMMARY OF COSTS'],
  ['Total Amount', 450000],
]

/** Two-row candidate where row 2 ALSO has a description label — must NOT
 *  merge (single-row semantics stay intact for such sheets). */
export const TWO_ROW_NOT_MERGEABLE: unknown[][] = [
  ['Sr', 'Item', 'Unit', 'Qty'],
  ['', 'Description', 'Rate', 'Amount'],
  [1, 'Something', 10, 100],
]

// ─── Fixture C — consultant finishing BOQ (desc row + money row header) ────
// Mirrors "DCPL Rate - NGH Finishing Work BOQ...xlsx": R3 = Sr/Description
// only; R4 = Unit/Quantity/Rate/Amount only. Amounts all 0 (rate-only BOQ
// submitted for rate approval, quantities blank).
export const FINISHING_RATE_BOQ: unknown[][] = [
  [N],
  [N],
  ['Sr. No.', 'Description'],
  [N, N, 'Unit', 'Quantity', 'Rate', 'Amount', 'Remarks'],
  [N],
  ['A', 'Flooring, Skirting, Dado Works'],
  [1, 'Providing and fixing of Vitrified tile 600x1200', 'm2', N, 1495, 0],
  [2, 'Providing and fixing of Vetrified tile skirting', 'rmt', N, 270, 0],
  [3, 'Providing and fixing of Vitrified tile treads', 'rmt', N, 1640, 0],
]

// ─── Fixture E — multi-section working (Warehouse-ABS shape) ──────────────
// One sheet, MULTIPLE work packages, each ending in its own "Total Amount
// for <package>" row, with more items following. No closing grand total.
// The sheet total = sum of the section subtotals — NOT the last section.
export const MULTI_SECTION_SHEET: unknown[][] = [
  ['Sr', 'Description', 'Unit', 'Qty', 'Rate', 'Amount'],
  ['A', '309 Tremix Works'],
  [1, 'Tremix flooring ground floor', 'Sqm', 500, 900, 450000],
  [2, 'Tremix flooring first floor', 'Sqm', 500, 905, 452500],
  ['', 'Total Amount for 309 Tremix Works', '', N, N, 902500],
  ['B', '501 Building & Terrace Waterproofing'],
  [3, 'Terrace brickbat coba', 'Sqm', 1200, 2500, 3000000],
  [4, 'Parapet coping', 'Rmt', 300, 3000, 900000],
  ['', 'Total Amount for 501 Building & Terrace Waterproofing', '', N, N, 3900000],
  ['C', '507 Lift-Pit Waterproofing'],
  [5, 'Lift pit box waterproofing', 'Nos', 4, 60000, 240000],
  [6, 'Sump treatment', 'Nos', 2, 30000, 60000],
  ['', 'Total Amount for 507 Lift-Pit Waterproofing Chemical', '', N, N, 300000],
]

/** Same shape but WITH a closing grand total — the grand total must win
 *  and the sections' items must all survive the cut. */
export const MULTI_SECTION_WITH_GRAND: unknown[][] = [
  ...MULTI_SECTION_SHEET,
  ['', 'Grand Total', '', N, N, 5102500],
]

// ─── Fixture D — quantity-only measurement sheet (no money anywhere) ───────
// Mirrors "SRD-NGH B-Quantity Sheet" tabs: totals are SMT/NOS quantities
// and must be EXCLUDED so no quantity masquerades as a money total.
export const QUANTITY_ONLY_SHEET: unknown[][] = [
  ['NGH B - Flooring & Dedo Quantity'],
  ['Sr', 'Location', 'Length', 'Width', 'Qty SMT'],
  [1, 'Unit 1 Living', 5.2, 4.1, 21.32],
  [2, 'Unit 1 Bedroom', 4.0, 3.5, 14.0],
  ['Total Quantity for 9 Units SMT', N, N, N, 1589.9],
  ['Total  RMT', N, N, N, 387],
]
