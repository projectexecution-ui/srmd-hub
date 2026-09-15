import type { SupabaseClient } from '@supabase/supabase-js'
import { billLadder, woHistory, type CertMoney, type BillLadder, type WoHistory } from './calc'
import { buildAbstractSheet, type AbstractSheet, type AbstractLine, type BoqLine } from './abstract'
import { seedLines, pickRate, type MakerLine, type RatePick } from './maker'
import { buildGrnSheet, advancePosition, type GrnSheet, type AdvancePosition } from './purchase'

/** The live IN4 position behind one CT Hub bill.
 *
 *  A bill in CT Hub carries a claimed figure and not much else. The order it
 *  names has a real history in IN4 — every bill raised on it, what each was
 *  certified at, what tax went on, what was held back and what has been paid.
 *  That is the arithmetic an approver needs, and CT Hub already mirrors it.
 *
 *  Both sides of the house are read here. Work orders come from
 *  `in4_wo_certificates`; purchase orders from `in4_supplier_certificates`,
 *  which is the same shape under different column names and reconciles better:
 *  payable = landed − tax deducted − advance − debit notes − retention on 1,334
 *  of 1,376 supplier bills, and payable − paid = outstanding on all 1,376. The
 *  ladder itself is shared, so a vendor bill is checked exactly the way a
 *  contractor bill is. */

export interface BillCalc {
  /** The order this bill is drawn against, as IN4 has it. */
  orderNo: string
  /** Which kind it is — the panel's wording follows it, and a purchase order
   *  has no abstract sheet to show. */
  kind: 'WO' | 'PO'
  orderedGross: number
  /** Every bill on that order, this one's predecessors included. */
  history: WoHistory
  /** The ladder for THIS bill, when a certificate for it exists in IN4. Null
   *  while the bill is still moving through CT Hub and Billing has not keyed
   *  it — which is most of the time, and is not an error. */
  mine: BillLadder | null
  /** The certificate the ladder came from. */
  mineCert: CertMoney | null
  /** What this bill would look like if it were certified at the claimed figure,
   *  using the tax and retention this work order has actually carried. Shown
   *  only when there is no real certificate yet, and always labelled as an
   *  expectation rather than a fact. */
  expected: BillLadder | null
  /** The measurement behind this bill, line by line, when IN4 holds one.
   *  Work orders only — a purchase order is measured by what arrived. */
  sheet: AbstractSheet | null
  /** The goods received behind this bill: the purchase side of `sheet`. */
  grn: GrnSheet | null
  /** The advance on this order and how much of it has been worked off, when it
   *  took one. 215 purchase orders have, ₹9.9 Cr between them. */
  advance: AdvancePosition | null
}

const n = (v: unknown) => Number(v ?? 0)

const toMoney = (r: Record<string, unknown>): CertMoney => ({
  certificateId: n(r.certificate_id),
  displayNo: (r.display_no as string | null) ?? null,
  invoiceNo: (r.invoice_no as string | null) ?? null,
  createdOn: (r.creation_dt as string | null) ?? null,
  statusName: (r.status_name as string | null) ?? null,
  certified: n(r.certified_amt),
  gross: n(r.gross_bill_amt),
  retention: n(r.retention_amt),
  advanceRecovery: n(r.advance_recovery_amt),
  recoveries: n(r.recoveries),
  deductions: n(r.deductions),
  paid: n(r.paid_amt),
  outstanding: n(r.outstanding_amt),
})

/** The rates this work order has actually carried, averaged over its live
 *  bills. Never a house rule: retention is 10% on some orders and 5% on
 *  others, and 60% of IN4 bills carry no tax at all. With no history there is
 *  nothing to go on, and the expectation is not shown. */
function ratesFrom(certs: CertMoney[]): { gst: number; retention: number } | null {
  const live = certs.filter(c => c.certified > 0)
  if (!live.length) return null
  const basic = live.reduce((s, c) => s + c.certified, 0)
  if (!(basic > 0)) return null
  return {
    gst: live.reduce((s, c) => s + (c.gross - c.certified), 0) / basic,
    retention: live.reduce((s, c) => s + c.retention, 0) / basic,
  }
}

export async function loadBillCalc(
  sb: SupabaseClient,
  bill: {
    orderType: string | null
    orderNo: string | null; billNo: string | null; raNo: string | null
    claimed: number; abstractNo: string | null
  },
): Promise<BillCalc | null> {
  const woNo = bill.orderNo?.trim()
  if (!woNo) return null
  if (bill.orderType === 'PO') return loadPoCalc(sb, { ...bill, orderNo: woNo })

  const { data: woRow } = await sb.from('in4_work_orders')
    .select('wo_id, wo_gross_value').eq('display_no', woNo).maybeSingle()
  if (!woRow) return null

  const { data: certData } = await sb.from('in4_wo_certificates')
    .select('certificate_id, display_no, invoice_no, creation_dt, status_name, certified_amt, gross_bill_amt, retention_amt, advance_recovery_amt, recoveries, deductions, paid_amt, outstanding_amt')
    .eq('wo_id', woRow.wo_id as number)

  const certs = ((certData ?? []) as Record<string, unknown>[]).map(toMoney)
  const ordered = n(woRow.wo_gross_value)
  const history = woHistory(certs, ordered)

  // Is one of them THIS bill? Billing keys the contractor's invoice number
  // into IN4, so that is the only honest link — matching on amount would pair
  // two bills of the same value on the same order, which happens.
  const key = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()
  const mineCert = certs.find(c =>
    (bill.abstractNo && key(c.displayNo) === key(bill.abstractNo)) ||
    (bill.billNo && key(c.invoiceNo) === key(bill.billNo))) ?? null

  let expected: BillLadder | null = null
  if (!mineCert && bill.claimed > 0) {
    const rates = ratesFrom(certs.filter(c => !['cancelled', 'reversed'].includes(key(c.statusName))))
    if (rates) {
      // The claim is a gross figure — that is how Aksha works — so the basic
      // value is backed out of it rather than the tax being added on top.
      const basic = Math.round(bill.claimed / (1 + rates.gst))
      const gross = Math.round(basic * (1 + rates.gst))
      const retention = Math.round(basic * rates.retention)
      expected = billLadder({
        certificateId: 0, displayNo: null, invoiceNo: null, createdOn: null, statusName: null,
        certified: basic, gross, retention,
        advanceRecovery: 0, recoveries: 0, deductions: 0, paid: 0,
        outstanding: gross - retention,
      })
    }
  }

  // The abstract sheet for this bill, matched on the contractor's bill number.
  //
  // Aksha, 15 Sep 2026: "Site Head also does one entry in IN4 - and once
  // Abstract is made in IN4 the Abstract ... is made with all previous data n
  // current data - this will reduce overall process." He is right, and the
  // mirror agrees: the abstract is the FIRST document. 661 of 2,706 abstracts
  // sit in IN4 with no certificate at all, and of those since certified, 1,484
  // were dated BEFORE their certificate against 13 after.
  //
  // So this no longer waits for a certificate. The key is the bill number the
  // ERP clerk already types at entry — IN4 stores that same number on the
  // abstract (bill_no) and later on the certificate (invoice_no) — so the Disc
  // Head, CT Head and Atm Head see the real measurement while the bill is still
  // with them, and the Site Head never types the sheet twice.
  const sheetKey = mineCert?.invoiceNo ?? bill.billNo
  const sheet = sheetKey
    ? await loadAbstractSheet(sb, {
        woNo, invoiceNo: sheetKey,
        // No certificate yet means no figure to reconcile against, and the
        // sheet must say so rather than implying a match.
        certified: mineCert?.certified ?? null,
      }).catch(() => null)
    : null

  return {
    orderNo: woNo,
    kind: 'WO',
    orderedGross: ordered,
    history,
    mine: mineCert ? billLadder(mineCert) : null,
    mineCert,
    expected,
    sheet,
    // Both belong to the purchase side of the same questions.
    grn: null,
    advance: null,
  }
}

/* ── the same thing, for a purchase order ────────────────────────────────── */

/** IN4's supplier certificate carries the identical ladder under different
 *  names. Mapped once, here, so nothing downstream has to know which kind of
 *  bill it is looking at:
 *
 *      certified_amt   → certified        landed_cost   → gross
 *      retention       → retention        adv_recovery  → advance recovered
 *      debit_note_adj  → other recoveries tax_deduction → deductions
 *      paid            → paid             outstanding   → outstanding
 *
 *  `kind = 'advance'` rows are not bills and are kept out of the history — an
 *  advance is paid on the terms of the order and recovered out of the bills
 *  that follow, so counting the 244 of them as billed would show every order
 *  that took one as spent twice. They come back as their own position instead.
 *
 *  Instead of an abstract there is a GRN, because that is what IN4 raises the
 *  certificate against. See purchase.ts. */
async function loadPoCalc(
  sb: SupabaseClient,
  bill: { orderNo: string; billNo: string | null; claimed: number; abstractNo: string | null },
): Promise<BillCalc | null> {
  const { data: poRow } = await sb.from('in4_purchase_orders')
    .select('po_id, po_value').eq('po_no', bill.orderNo).maybeSingle()
  if (!poRow) return null
  const poId = poRow.po_id as number

  const [{ data: certData }, { data: lineData }] = await Promise.all([
    sb.from('in4_supplier_certificates')
      .select('kind, certificate_id, certificate_no, certificate_date, certified_amt, landed_cost, retention, adv_recovery, debit_note_adj, tax_deduction, paid, outstanding')
      .eq('po_id', poId),
    // One PO's pay lines are tens of rows, and they carry three things the
    // certificate does not: the supplier's own invoice number, a real status
    // name, and the GRN each line came in on.
    sb.from('in4_supplier_pay_lines')
      .select('certificate_id, grn_id, material_id, invoice_no, status_name, landed_cost, certified_amt')
      .eq('po_id', poId),
  ])

  const lines = (lineData ?? []) as Record<string, unknown>[]
  const invoiceOf = new Map<number, string>()
  const statusOf = new Map<number, string>()
  for (const l of lines) {
    const id = n(l.certificate_id)
    const inv = (l.invoice_no as string | null)?.trim()
    if (inv && !invoiceOf.has(id)) invoiceOf.set(id, inv)
    const st = (l.status_name as string | null)?.trim()
    if (st && !statusOf.has(id)) statusOf.set(id, st)
  }

  const all = (certData ?? []) as Record<string, unknown>[]
  const toCert = (r: Record<string, unknown>): CertMoney => ({
    certificateId: n(r.certificate_id),
    displayNo: (r.certificate_no as string | null) ?? null,
    // The supplier's own bill number, which is what the person holding the
    // paper is looking at. The certificate table does not carry it; its lines
    // do, on 4,482 of 4,494.
    invoiceNo: invoiceOf.get(n(r.certificate_id)) ?? (r.certificate_no as string | null) ?? null,
    createdOn: (r.certificate_date as string | null) ?? null,
    statusName: statusOf.get(n(r.certificate_id)) ?? null,
    certified: n(r.certified_amt),
    gross: n(r.landed_cost),
    retention: n(r.retention),
    advanceRecovery: n(r.adv_recovery),
    recoveries: n(r.debit_note_adj),
    deductions: n(r.tax_deduction),
    paid: n(r.paid),
    outstanding: n(r.outstanding),
  })

  const isAdvance = (r: Record<string, unknown>) => (r.kind as string | null) === 'advance'
  const certs = all.filter(r => !isAdvance(r)).map(toCert)

  // po_value is gross, like the certificates it is compared against: on a
  // fulfilled purchase order the supplier bills sum to it to the rupee.
  const ordered = n(poRow.po_value)
  const history = woHistory(certs, ordered)

  const key = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()
  const mineCert = certs.find(c =>
    (bill.abstractNo && key(c.displayNo) === key(bill.abstractNo)) ||
    (bill.billNo && (key(c.invoiceNo) === key(bill.billNo) || key(c.displayNo) === key(bill.billNo)))) ?? null

  let expected: BillLadder | null = null
  if (!mineCert && bill.claimed > 0) {
    const rates = ratesFrom(certs)
    if (rates) {
      const basic = Math.round(bill.claimed / (1 + rates.gst))
      const gross = Math.round(basic * (1 + rates.gst))
      const retention = Math.round(basic * rates.retention)
      expected = billLadder({
        certificateId: 0, displayNo: null, invoiceNo: null, createdOn: null, statusName: null,
        certified: basic, gross, retention,
        advanceRecovery: 0, recoveries: 0, deductions: 0, paid: 0,
        outstanding: gross - retention,
      })
    }
  }

  // The advance, and how much of it this order has worked off.
  const advance = advancePosition(
    all.filter(isAdvance).map(r => ({ gross: n(r.landed_cost), paid: n(r.paid) })),
    certs.reduce((s, c) => s + c.advanceRecovery, 0),
    mineCert?.advanceRecovery ?? 0,
  )

  // What this bill is for. Once Billing has raised the certificate that is its
  // own pay lines; before that — where a bill spends most of its life — it is
  // the goods RECEIVED against the order that no certificate covers yet. That
  // is the purchase side of an abstract made and waiting, and it is what the
  // Disc Head, CT Head and Atm Head are actually being asked to pass.
  const billedGrns = new Set(lines.map(l => l.grn_id).filter((v): v is number => typeof v === 'number'))
  const grn = mineCert
    ? await loadGrnSheet(sb, {
        poId,
        lines: lines.filter(l => n(l.certificate_id) === mineCert.certificateId),
        landed: mineCert.gross,
      }).catch(() => null)
    : await loadUnbilledGrn(sb, { poId, billedGrns }).catch(() => null)

  return {
    orderNo: bill.orderNo,
    kind: 'PO',
    orderedGross: ordered,
    history,
    mine: mineCert ? billLadder(mineCert) : null,
    mineCert,
    expected,
    sheet: null,
    grn,
    advance,
  }
}

/** The goods received behind one supplier bill — the purchase side's abstract.
 *
 *  Aksha, 15 Sep 2026: "Supplier Certificate is raised - pls check post GRN -
 *  so instead of Abstract PO follows GRN." Exactly so, and it holds up: the
 *  lines of a bill sum to that bill's landed cost on all 1,376 certificates.
 *
 *  Quantities come from the receipt, money from the pay line, and what was
 *  ordered from the PO itself, so the sheet answers the same three questions
 *  the abstract does — this bill, received to date, still to come. */
async function loadGrnSheet(
  sb: SupabaseClient,
  opts: { poId: number; lines: Record<string, unknown>[]; landed: number; billed?: boolean },
): Promise<GrnSheet | null> {
  if (!opts.lines.length) return null

  const [{ data: itemData }, { data: grnData }] = await Promise.all([
    sb.from('in4_po_items')
      .select('material_id, uom_id, base_po_qty, grn_qty, net_rate, material_value').eq('po_id', opts.poId),
    sb.from('in4_grn_items')
      .select('grn_id, material_id, received_qty, grn_material_cost, grn_no, grn_dt, delivery_challan_no').eq('po_id', opts.poId),
  ])

  const items = (itemData ?? []) as Record<string, unknown>[]
  const grns = (grnData ?? []) as Record<string, unknown>[]

  const matIds = [...new Set([
    ...items.map(i => i.material_id), ...opts.lines.map(l => l.material_id),
  ].filter((v): v is number => typeof v === 'number'))]
  const uomIds = [...new Set(items.map(i => i.uom_id).filter((v): v is number => typeof v === 'number'))]

  const [{ data: matData }, { data: uomData }] = await Promise.all([
    matIds.length ? sb.from('in4_materials').select('id, name').in('id', matIds) : Promise.resolve({ data: [] }),
    uomIds.length ? sb.from('in4_uoms').select('id, name').in('id', uomIds) : Promise.resolve({ data: [] }),
  ])
  const matName = new Map((matData ?? []).map(m => [m.id as number, (m.name as string | null) ?? '']))
  const uomName = new Map((uomData ?? []).map(u => [u.id as number, (u.name as string | null) ?? '']))

  return buildGrnSheet(
    opts.lines.map(l => ({
      grnId: (l.grn_id as number | null) ?? null,
      materialId: (l.material_id as number | null) ?? null,
      landed: n(l.landed_cost),
      certified: n(l.certified_amt),
    })),
    grns.map(g => ({
      grnId: (g.grn_id as number | null) ?? null,
      materialId: (g.material_id as number | null) ?? null,
      qty: n(g.received_qty),
      cost: n(g.grn_material_cost),
      no: (g.grn_no as string | null) ?? null,
      on: (g.grn_dt as string | null) ?? null,
      challanNo: (g.delivery_challan_no as string | null) ?? null,
    })),
    items.map(i => {
      const id = (i.material_id as number | null) ?? null
      return {
        materialId: id,
        material: (id != null ? matName.get(id) : '') || `Material ${id ?? '—'}`,
        uom: (i.uom_id != null ? uomName.get(i.uom_id as number) : null) || null,
        orderedQty: n(i.base_po_qty),
        rate: n(i.net_rate),
        orderedAmt: n(i.material_value),
        receivedQty: n(i.grn_qty),
      }
    }),
    opts.landed,
    opts.billed ?? true,
  )
}

/* ── the abstract sheet ──────────────────────────────────────────────────── */



/** The measurement behind one bill, from IN4.
 *
 *  Matched on the contractor's invoice number — the abstract's `bill_no`
 *  against the certificate's `invoice_no`. NOT on `abstract_id`, which is the
 *  abstract's own id in its own id space and matches nothing; see the note at
 *  the top of abstract.ts for how long that cost me.
 *
 *  Null when IN4 holds no abstract under that number — normal for a bill the
 *  Site Head has not measured yet, and the screen says which number it looked
 *  for rather than showing an empty panel. */
export async function loadAbstractSheet(
  sb: SupabaseClient,
  opts: { woNo: string; invoiceNo: string | null; certified: number | null },
): Promise<AbstractSheet | null> {
  const key = opts.invoiceNo?.trim()
  if (!key) return null

  const { data: wo } = await sb.from('in4_work_orders')
    .select('wo_id').eq('display_no', opts.woNo).maybeSingle()
  if (!wo) return null
  const woId = wo.wo_id as number

  const { data: allLines } = await sb.from('in4_wo_abstract_items')
    .select('abstract_id, item_id, display_no, bill_no, abstract_dt, executed_quantity, recommended_rate, executed_amt')
    .eq('wo_id', woId)
  if (!allLines?.length) return null

  const rows: AbstractLine[] = allLines.map(l => ({
    abstractId: Number(l.abstract_id),
    itemId: Number(l.item_id),
    abstractNo: (l.display_no as string | null) ?? null,
    billNo: (l.bill_no as string | null) ?? null,
    on: (l.abstract_dt as string | null) ?? null,
    qty: Number(l.executed_quantity ?? 0),
    rate: Number(l.recommended_rate ?? 0),
    amt: Number(l.executed_amt ?? 0),
  }))

  const same = (a: string | null, b: string) => (a ?? '').trim().toLowerCase() === b.toLowerCase()
  const mine = rows.filter(r => same(r.billNo, key))
  if (!mine.length) return null

  // Everything measured on this order BEFORE this abstract — that is what makes
  // the cumulative column honest. Ordered by date, then by id for the two that
  // share a day.
  const mineId = mine[0].abstractId
  const mineOn = mine[0].on ?? ''
  const earlier = rows.filter(r =>
    r.abstractId !== mineId &&
    ((r.on ?? '') < mineOn || ((r.on ?? '') === mineOn && r.abstractId < mineId)))

  const { data: boqData } = await sb.from('in4_wo_boq_items')
    .select('item_id, boq_name, description, uom, quantity, rate, amt').eq('wo_id', woId)
  const boq: BoqLine[] = (boqData ?? []).map(b => ({
    itemId: Number(b.item_id),
    name: (b.boq_name as string | null) ?? null,
    description: (b.description as string | null) ?? null,
    uom: (b.uom as string | null) ?? null,
    orderedQty: Number(b.quantity ?? 0),
    rate: Number(b.rate ?? 0),
    orderedAmt: Number(b.amt ?? 0),
  }))

  return buildAbstractSheet(mine, earlier, boq, opts.certified)
}

/* ── the maker ───────────────────────────────────────────────────────────── */

/** Seed the Abstract maker for one bill.
 *
 *  Lines come from the work order's own BOQ, which is mirrored exact. What has
 *  already been measured — by IN4's earlier abstracts and by earlier CT Hub
 *  sheets on the same order — is folded in as `prior`, so the first thing a
 *  Site Head sees is the balance still to do rather than a blank page.
 *
 *  Any quantities already saved on THIS bill come back in, so the sheet
 *  reopens where it was left. */
export async function loadMakerSeed(
  sb: SupabaseClient,
  opts: { billId: string; woNo: string },
): Promise<{ lines: MakerLine[]; gst: RatePick; retention: RatePick; ownSheet: boolean } | null> {
  const { data: wo } = await sb.from('in4_work_orders')
    .select('wo_id').eq('display_no', opts.woNo).maybeSingle()
  if (!wo) return null
  const woId = wo.wo_id as number

  const [{ data: boqData }, { data: in4Lines }, { data: mine }, { data: certData }] = await Promise.all([
    sb.from('in4_wo_boq_items').select('item_id, boq_name, description, uom, quantity, rate, amt').eq('wo_id', woId),
    sb.from('in4_wo_abstract_items').select('item_id, executed_quantity, executed_amt').eq('wo_id', woId),
    sb.from('bb_bill_lines').select('sr, item_id, this_qty').eq('bill_id', opts.billId),
    sb.from('in4_wo_certificates')
      .select('certified_amt, gross_bill_amt, retention_amt, status_name, creation_dt').eq('wo_id', woId),
  ])
  if (!boqData?.length) return null

  // What IN4 already shows measured, per item.
  const measured = new Map<number, { qty: number; amt: number }>()
  for (const l of in4Lines ?? []) {
    const id = Number(l.item_id)
    const cur = measured.get(id) ?? { qty: 0, amt: 0 }
    cur.qty += Number(l.executed_quantity ?? 0)
    cur.amt += Number(l.executed_amt ?? 0)
    measured.set(id, cur)
  }

  const lines = seedLines(
    boqData.map(b => ({
      itemId: Number(b.item_id),
      name: (b.boq_name as string | null) ?? null,
      description: (b.description as string | null) ?? null,
      uom: (b.uom as string | null) ?? null,
      orderedQty: Number(b.quantity ?? 0),
      rate: Number(b.rate ?? 0),
      orderedAmt: Number(b.amt ?? 0),
    })),
    measured,
  )

  // Put back whatever was already typed on this bill.
  const saved = new Map((mine ?? []).map(r => [Number(r.item_id), Number(r.this_qty ?? 0)]))
  for (const l of lines) if (l.itemId != null && saved.has(l.itemId)) l.thisQty = saved.get(l.itemId)!

  // The rate this order actually carries — read PER BILL and never blended.
  // Averaging across the order gave "GST @ 14.4%" on WO/SRASSK/SQ/2023-24/7,
  // whose 27 bills carry 0% or 18% and nothing in between. See pickRate.
  const live = (certData ?? []).filter(c =>
    !['cancelled', 'reversed'].includes(((c.status_name as string | null) ?? '').trim().toLowerCase())
    && Number(c.certified_amt ?? 0) > 0)

  const gst = pickRate(live.map(c => ({
    on: (c.creation_dt as string | null) ?? null,
    part: Number(c.gross_bill_amt ?? 0) - Number(c.certified_amt ?? 0),
    whole: Number(c.certified_amt ?? 0),
  })), 18)

  const retention = pickRate(live.map(c => ({
    on: (c.creation_dt as string | null) ?? null,
    part: Number(c.retention_amt ?? 0),
    whole: Number(c.certified_amt ?? 0),
  })), 5)

  // Whether CT Hub already holds a sheet of its own for this bill. It decides
  // which of the two abstracts the page shows — never both.
  const ownSheet = (mine ?? []).length > 0

  return { lines, gst, retention, ownSheet }
}

/** Goods received against a purchase order that no supplier certificate covers
 *  yet — the purchase side of an abstract made and awaiting Billing.
 *
 *  Aksha, 15 Sep 2026, on the PO flow: "the process is little diff than WO".
 *  It is. A work order is measured by an abstract the Site Head writes; a
 *  purchase order is measured by what physically arrived, and IN4 records that
 *  as a GRN the moment the store receives it — days or weeks before anyone
 *  raises a certificate. So a PO bill sitting with the Disc Head has something
 *  real to show, and it is this.
 *
 *  The quantities here are certain by construction: the money and the receipt
 *  are the same row, so there is no bill-covers-part-of-a-receipt problem — see
 *  the note in purchase.ts about why that matters once a certificate exists. */
async function loadUnbilledGrn(
  sb: SupabaseClient,
  opts: { poId: number; billedGrns: Set<number> },
): Promise<GrnSheet | null> {
  const { data: grnData } = await sb.from('in4_grn_items')
    .select('grn_id, material_id, received_qty, grn_material_cost, grn_no, grn_dt, delivery_challan_no')
    .eq('po_id', opts.poId)

  const open = ((grnData ?? []) as Record<string, unknown>[])
    .filter(g => typeof g.grn_id === 'number' && !opts.billedGrns.has(g.grn_id))
  if (!open.length) return null

  return loadGrnSheet(sb, {
    poId: opts.poId,
    // Each receipt line stands in for its own bill line: the money IS what the
    // receipt says the goods cost, so nothing is inferred.
    lines: open.map(g => ({
      certificate_id: 0,
      grn_id: g.grn_id,
      material_id: g.material_id,
      landed_cost: g.grn_material_cost,
      certified_amt: g.grn_material_cost,
    })),
    landed: open.reduce((s, g) => s + Number(g.grn_material_cost ?? 0), 0),
    billed: false,
  })
}
