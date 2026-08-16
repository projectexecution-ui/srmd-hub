/** SCENARIO regression suite — the module described the way the people using it
 *  would describe it: a truck arrives short, a keeper counts alone, an auditor
 *  asks what the stock was back in March.
 *
 *  These sit alongside the unit tests on purpose. A unit test checks a function;
 *  these check that a real situation still comes out the way it is meant to, and
 *  each is phrased so a failure reads as the broken SCENARIO rather than as a
 *  broken assertion.
 *
 *  Rules enforced by the DATABASE rather than by code — damaged more than
 *  received, a move into the same store, a vendor return with nobody named, an
 *  approved count with no approver, an IN4 mismatch flagged with no note — are
 *  covered by supabase/qa/warehouse-scenarios.sql, which runs against a real
 *  database inside a transaction and rolls back. */
import { describe, expect, it } from 'vitest'
import { periodLockBlocker, showValuesFor } from './settings'
import { submitBlocker, summarize } from './count'
import type { CountLine } from './count'
import { stockEffect, foldLedger, stockFlag, groupOf, groupByCategory, groupByLocation } from './ledger'
import type { LedgerRow, MovementKind, StockLine } from './ledger'
import {
  ageBucket, poPending, rateSpread, outstandingReturnables, seriesGaps, RATE_SPREAD_FLOOR,
} from './exceptions'
import { plan } from './in4-sync'
import type { SyncExisting, SyncLine } from './in4-sync'

/** Assert a scenario, and on failure print the scenario, what was expected and
 *  what actually happened — so the message alone explains the break. */
const rec = (id: string, s: string, exp: string, act: string, pass: boolean) => {
  expect(pass, `${id} — ${s}\n     expected: ${exp}\n     actual  : ${act}`).toBe(true)
}

const cl = (o: Partial<CountLine> & { itemId: string }): CountLine => ({
  id: o.itemId, itemName: o.itemId, unit: 'Bag', seq: 0, bookQty: 0, countedQty: null,
  skipped: false, skipReason: null, reason: null, remark: null, rate: null, ...o,
})

describe('QA scenarios — rules enforced in code', () => {
  const LOCK = { wh_period_lock_on: 'true', wh_period_lock_date: '2026-03-31' }

  it('S21 the locked date itself is closed', () => {
    const b = periodLockBlocker(LOCK, '2026-03-31')
    rec('S21', 'Accounts locked "up to 31 Mar" — someone back-dates an entry to 31 Mar',
      'refused', b ? 'refused' : 'ACCEPTED', b !== null)
  })

  it('S22 the day after the lock is open', () => {
    const b = periodLockBlocker(LOCK, '2026-04-01')
    rec('S22', 'Entry dated 1 Apr, the day after the lock',
      'allowed', b ?? 'allowed', b === null)
  })

  it('S23 a half-walked count cannot be submitted', () => {
    const b = submitBlocker([cl({ itemId: 'a', bookQty: 10, countedQty: 10 }), cl({ itemId: 'b', bookQty: 4 })], 'w')
    rec('S23', 'He submits the count with one item still not walked',
      'refused, and says how many', b ?? 'ACCEPTED', Boolean(b && /1 item is still not counted/.test(b)))
  })

  it('S24 a difference with no reason cannot be submitted', () => {
    const b = submitBlocker([cl({ itemId: 'a', bookQty: 10, countedQty: 7 })], 'w')
    rec('S24', 'A shortage of 3 with no reason typed against it',
      'refused', b ?? 'ACCEPTED', Boolean(b && /no reason/.test(b)))
  })

  it('S25 the two-person rule follows the Settings switch', () => {
    const done = [cl({ itemId: 'a', bookQty: 10, countedQty: 10 })]
    const on = submitBlocker(done, null)
    const off = submitBlocker(done, 'not-required')
    rec('S25', 'Keeper counts alone — with the witness switch ON, then OFF',
      'refused when on, allowed when off',
      'on: ' + (on ? 'refused' : 'allowed') + ', off: ' + (off ? 'refused' : 'allowed'),
      on !== null && off === null)
  })

  it('S26 the ledger reconciles to stock across every movement kind', () => {
    const kinds: Array<[MovementKind, number]> = [
      ['in', 500], ['damage', 15], ['issue', 100], ['move_out', 150], ['move_in', 150],
      ['return', 20], ['vendor_out', 50], ['adjust', -29],
    ]
    const rows: LedgerRow[] = kinds.map(([kind, qty], i) => ({
      itemId: 'i', locationId: 'L', kind, qty, rate: null,
      day: '2026-08-0' + (i + 1),
    }))
    const [cell] = foldLedger(rows)
    const signed = kinds.reduce((s, [k, q]) => s + stockEffect(k, q), 0)
    rec('S26', 'One item touched by every kind of movement — receipt, damage, issue, move out and in, return, vendor return, count correction',
      'in hand 341, damage in its own bucket, vendor return not counted as site consumption',
      'in hand ' + cell.inHand + ', damaged ' + cell.damagedQty + ', out (site) ' + cell.outQty
        + ', vendor out ' + cell.vendorOutQty + ', signed sum ' + signed,
      cell.inHand === 341 && signed === 341 && cell.damagedQty === 15
        && cell.outQty === 100 && cell.vendorOutQty === 50)
  })

  it('S37 stock as on a date ignores anything that happened later', () => {
    const rows: LedgerRow[] = [
      { itemId: 'i', locationId: 'L', kind: 'in', qty: 500, rate: null, day: '2026-08-01' },
      { itemId: 'i', locationId: 'L', kind: 'issue', qty: 100, rate: null, day: '2026-08-05' },
      { itemId: 'i', locationId: 'L', kind: 'issue', qty: 200, rate: null, day: '2026-08-20' },
    ]
    const [asOn] = foldLedger(rows, '2026-08-10')
    const [now] = foldLedger(rows)
    rec('S37', 'Auditor asks what the stock was on 10 Aug, when 200 more went out on the 20th',
      '400 as on 10 Aug, 200 today',
      'as on 10 Aug: ' + asOn.inHand + ', today: ' + now.inHand,
      asOn.inHand === 400 && now.inHand === 200)
  })

  it('S38 an empty shelf is reported as nil, not as running low', () => {
    rec('S38', 'One item is down to 0, another is at 5 against a minimum of 10',
      'the empty one reads nil, not low',
      'zero -> ' + stockFlag(0, 10) + ', five of ten -> ' + stockFlag(5, 10) + ', healthy -> ' + stockFlag(50, 10),
      stockFlag(0, 10) === 'nil' && stockFlag(5, 10) === 'low' && stockFlag(50, 10) === null)
  })

  it('S39 the same item in two stores is two separate balances', () => {
    const rows: LedgerRow[] = [
      { itemId: 'i', locationId: 'A', kind: 'in', qty: 300, rate: null, day: '2026-08-01' },
      { itemId: 'i', locationId: 'B', kind: 'in', qty: 200, rate: null, day: '2026-08-01' },
      { itemId: 'i', locationId: 'A', kind: 'issue', qty: 50, rate: null, day: '2026-08-02' },
    ]
    const cells = foldLedger(rows)
    const a = cells.find(c => c.locationId === 'A')!
    const b = cells.find(c => c.locationId === 'B')!
    rec('S39', 'Cement sits in two different stores and is issued from only one',
      'each store keeps its own balance — 250 and 200',
      'store A ' + a.inHand + ', store B ' + b.inHand + ', rows ' + cells.length,
      cells.length === 2 && a.inHand === 250 && b.inHand === 200)
  })

  it('S40 a vendor return never inflates what a site consumed', () => {
    const rows: LedgerRow[] = [
      { itemId: 'i', locationId: 'L', kind: 'in', qty: 400, rate: null, day: '2026-08-01' },
      { itemId: 'i', locationId: 'L', kind: 'issue', qty: 100, rate: null, day: '2026-08-02' },
      { itemId: 'i', locationId: 'L', kind: 'vendor_out', qty: 150, rate: null, day: '2026-08-03' },
    ]
    const [c] = foldLedger(rows)
    rec('S40', 'A vendor takes 150 of his plates back after 100 were issued to site',
      'site consumption stays 100, but stock falls by both',
      'out (site) ' + c.outQty + ', vendor out ' + c.vendorOutQty + ', in hand ' + c.inHand,
      c.outQty === 100 && c.vendorOutQty === 150 && c.inHand === 150)
  })

  it('S41 stock groups by CATEGORY ONLY — never by the IN4 budget head', () => {
    // The trade used to be a fallback, because the IN4 items had no category.
    // All 2,288 of them were read and given one (2026-08-16), and the fallback
    // came out: "07 Electrical Works" and "56 Mock Up Expense" are cost codes,
    // not kinds of material, and a store grouped by them reads as nonsense.
    const rows = [
      { category: 'Electrical', discipline: '07 Electrical Works' },
      { category: 'Plumbing',   discipline: '19 Site Admin' },
      { category: null,         discipline: '56 Mock Up Expense' },
    ]
    rec('S41', 'Three items whose budget head disagrees with the material',
      'the category wins every time; a missing one is named, never filled from the trade',
      rows.map(groupOf).join(' / '),
      groupOf(rows[0]) === 'Electrical'
        && groupOf(rows[1]) === 'Plumbing'
        && groupOf(rows[2]) === 'Not categorised')
  })

  it('S42 the same stock totals the same whichever way it is grouped', () => {
    const line = (o: Partial<StockLine> & { itemId: string }): StockLine => ({
      locationId: 'A', inQty: 0, outQty: 0, transferQty: 0, adjustQty: 0, voidQty: 0,
      damagedQty: 0, vendorOutQty: 0, inHand: 10, itemName: o.itemId, unit: 'Nos',
      category: null, discipline: null, locationName: 'Store A', siteName: 'Site',
      minQty: null, rate: 5, value: 50, flag: null, ...o,
    })
    const lines = [
      line({ itemId: 'a', category: 'Electrical', locationId: 'A', locationName: 'Store A' }),
      line({ itemId: 'b', category: 'Electrical', locationId: 'B', locationName: 'Store B' }),
      line({ itemId: 'c', category: 'Plumbing', locationId: 'A', locationName: 'Store A' }),
    ]
    const byCat = groupByCategory(lines)
    const byLoc = groupByLocation(lines)
    const catValue = byCat.reduce((s, g) => s + g.value, 0)
    const locValue = byLoc.reduce((s, g) => s + g.value, 0)
    const elec = byCat.find(g => g.category === 'Electrical')!
    rec('S42', 'The same three lines read by category and by store',
      'same total either way, and a category spanning two stores says so',
      `by category ${byCat.length} groups ₹${catValue}, by store ${byLoc.length} groups ₹${locValue}, `
        + `Electrical across ${elec.locations} stores`,
      catValue === locValue && catValue === 150 && byCat.length === 2 && byLoc.length === 2
        && elec.locations === 2)
  })

  it('S27 idle stock lands in the worst bucket it qualifies for', () => {
    rec('S27', 'An item untouched for 200 days',
      'reported as 180+, not as 60+', 'bucket ' + ageBucket(200), ageBucket(200) === 180)
  })

  it('S28 a PO that never delivered counts as stale', () => {
    const [p] = poPending([{
      poNo: 'PO-1', vendor: 'V', entity: null, itemName: 'X', unit: 'Nos',
      ordered: 100, received: 0, rate: null, status: 'open', lastDeliveryDay: null,
    }], '2026-08-13')
    rec('S28', 'A PO where nothing has EVER arrived',
      'flagged stale — the worst case, not an exemption',
      p.stale ? 'stale' : 'not flagged', p.stale === true)
  })

  it('S29 a small rate difference is ignored, a real one is flagged', () => {
    const small = rateSpread([
      { rate: 100, entity: 'A', party: null, day: 'd' },
      { rate: 103, entity: 'B', party: null, day: 'd' }])!
    const real = rateSpread([
      { rate: 100, entity: 'A', party: null, day: 'd' },
      { rate: 140, entity: 'B', party: null, day: 'd' }])!
    rec('S29', 'The same item bought at 100 and 103, then at 100 and 140',
      'under ' + RATE_SPREAD_FLOOR * 100 + '% ignored as freight noise, above it flagged',
      '3% -> ' + (small.spreadPct < RATE_SPREAD_FLOOR ? 'ignored' : 'flagged')
        + ', 40% -> ' + (real.spreadPct >= RATE_SPREAD_FLOOR ? 'flagged' : 'ignored'),
      small.spreadPct < RATE_SPREAD_FLOOR && real.spreadPct >= RATE_SPREAD_FLOOR)
  })

  it('S30 overdue is measured from the due date, not from when it went out', () => {
    const [f] = outstandingReturnables([{
      entryNo: 'E', day: '2026-06-27', projectName: null, engineerName: null,
      itemName: 'Scaffolding', unit: 'Nos', qty: 100, returnedQty: 0, dueDate: '2026-08-01',
    }], '2026-08-13')
    rec('S30', 'Scaffolding out since 27 Jun, was due back on 1 Aug',
      '47 days out, 12 days overdue',
      f.daysOut + ' days out, ' + f.overdueDays + ' overdue',
      f.daysOut === 47 && f.overdueDays === 12)
  })

  it('S31 a returnable that came back is closed, however late', () => {
    const none = outstandingReturnables([{
      entryNo: 'E', day: '2026-01-01', projectName: null, engineerName: null,
      itemName: 'X', unit: 'Nos', qty: 50, returnedQty: 50, dueDate: '2026-02-01',
    }], '2026-08-13')
    rec('S31', 'A returnable months past its due date but fully returned',
      'not listed — it is closed', none.length + ' listed', none.length === 0)
  })

  it('S32 a burnt entry number with no entry shows as a gap', () => {
    const gaps = seriesGaps(5, [1, 2, 4, 5])
    rec('S32', 'Numbers 1 to 5 handed out at the gate, but entry 3 never saved',
      'number 3 reported missing', 'missing ' + JSON.stringify(gaps),
      JSON.stringify(gaps) === '[3]')
  })

  it('S33 a guard sees quantities but never money', () => {
    const guard = showValuesFor({}, 'security', false)
    const head = showValuesFor({}, 'head', false)
    rec('S33', 'The security guard opens the stock screen, then the Atm Head opens the same screen',
      'guard sees no rates, head does',
      'guard ' + (guard ? 'SEES MONEY' : 'money hidden') + ', head ' + (head ? 'sees money' : 'MONEY HIDDEN'),
      guard === false && head === true)
  })

  it('S34 re-running the IN4 sync brings nothing across twice', () => {
    const lines: SyncLine[] = [{
      material: 'OPC 53 Cement', uom: 'Bags', discipline: '03 Civil',
      indentNo: 'IND/SRASSK/NGH/2024-25/1', project: 'NGH',
      pos: [{ poNo: 'PO-1', poDate: 'Apr 01, 2025', supplier: 'U', rate: 392, qty: 100 }],
    }]
    const fresh: SyncExisting = {
      byIn4Key: new Map(), byNameKey: new Map(), units: new Set(), disciplines: new Set(),
      poNos: new Set(), projectsByName: new Map(),
    }
    const first = plan(lines, fresh)
    const after: SyncExisting = {
      byIn4Key: new Map([['opc 53 cement', { id: 'i1', unit: 'Bags' }]]),
      byNameKey: new Map([['opc 53 cement', { id: 'i1', unit: 'Bags' }]]),
      units: new Set(['Bags']), disciplines: new Set(['03 Civil']),
      poNos: new Set(['PO-1']), projectsByName: new Map(),
    }
    const second = plan(lines, after)
    const nothing = second.items.create.length === 0 && second.items.adopt.length === 0
      && second.units.create.length === 0 && second.disciplines.create.length === 0
      && second.pos.create.length === 0
    rec('S34', 'The sync is run again after next week upload',
      'nothing duplicated the second time',
      'first run: ' + first.items.create.length + ' item + ' + first.pos.create.length + ' PO; '
        + 'second run: ' + second.items.create.length + ' item + ' + second.pos.create.length + ' PO',
      first.items.create.length === 1 && first.pos.create.length === 1 && nothing)
  })

  it('S35 an item already held by hand is linked, not duplicated', () => {
    const lines: SyncLine[] = [{
      material: 'OPC 53 Cement', uom: 'Bags', discipline: null,
      indentNo: null, project: null, pos: [],
    }]
    const have: SyncExisting = {
      byIn4Key: new Map(), byNameKey: new Map([['opc 53 cement', { id: 'manual-1', unit: 'Bag' }]]),
      units: new Set(), disciplines: new Set(), poNos: new Set(), projectsByName: new Map(),
    }
    const p = plan(lines, have)
    rec('S35', 'IN4 names a material we already typed in by hand',
      'linked to the existing item, keeping OUR unit — never a second copy',
      p.items.create.length + ' created, ' + p.items.adopt.length + ' linked, unit kept as '
        + (p.items.adopt[0] ? p.items.adopt[0].unit : 'n/a'),
      p.items.create.length === 0 && p.items.adopt.length === 1 && p.items.adopt[0].unit === 'Bag')
  })

  it('S36 a count where everything tallied is not an exception', () => {
    const s = summarize([cl({ itemId: 'a', bookQty: 10, countedQty: 10 })])
    rec('S36', 'A count where every item tallied exactly',
      'no shortage, no reason needed, nothing to report',
      'tallied ' + s.tallied + ', short ' + s.shortLines + ', missing reasons ' + s.missingReasons,
      s.tallied === 1 && s.shortLines === 0 && s.missingReasons === 0)
  })
})
