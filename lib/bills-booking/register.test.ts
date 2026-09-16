import { describe, it, expect } from 'vitest'
import { applyFilters, duplicateKeys, tagsFor, whyHere, waitingOnMe, toCsv, type RegisterRow } from './register'
import { stageDef } from './stages'

const NOW = new Date('2026-09-16T00:00:00Z').getTime()
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString()

const row = (o: Partial<RegisterRow> = {}): RegisterRow => ({
  id: 'b1', vendor: 'Desai Construction Pvt Ltd', billNo: 'RU-WH-CV/08', orderType: 'WO',
  orderNo: 'WO/SRET/WH/2025-26/210', project: 'WH', amount: 5_069_122, stage: 'disc_head',
  stageSince: daysAgo(1), isExample: false, autoRaised: true, hasStampedBill: true,
  lastComment: 'Abstract approved in IN4 — moved on automatically', lastAction: 'forward', mine: true, ...o,
})

describe('the register as a desk reads it', () => {
  it('finds a bill by vendor, order, bill number or project', () => {
    const rows = [row(), row({ id: 'b2', vendor: 'Laxmi Traders', orderNo: 'WO/SRET/RU/2025-26/401', billNo: 'RU-LT/05', project: 'RU' })]
    expect(applyFilters(rows, { q: 'laxmi' }, NOW).map(r => r.id)).toEqual(['b2'])
    expect(applyFilters(rows, { q: 'wh/2025' }, NOW).map(r => r.id)).toEqual(['b1'])
    expect(applyFilters(rows, { q: 'RU-LT' }, NOW).map(r => r.id)).toEqual(['b2'])
    expect(applyFilters(rows, { project: 'RU' }, NOW).map(r => r.id)).toEqual(['b2'])
  })

  it('shows only my desk on the default view, oldest first', () => {
    const rows = [
      row({ id: 'new', stageSince: daysAgo(0) }),
      row({ id: 'old', stageSince: daysAgo(4) }),
      row({ id: 'theirs', mine: false }),
    ]
    expect(applyFilters(rows, { view: 'mine' }, NOW).map(r => r.id)).toEqual(['old', 'new'])
  })

  // Late means past the desk's own turnaround — disc_head is 2 days.
  it('"late only" keeps what is past the turnaround, amber or red', () => {
    const rows = [row({ id: 'ok', stageSince: daysAgo(1) }), row({ id: 'warn', stageSince: daysAgo(3) }), row({ id: 'late', stageSince: daysAgo(6) })]
    expect(applyFilters(rows, { late: true }, NOW).map(r => r.id)).toEqual(['late', 'warn'])
  })

  it('leaves finished bills out unless you ask for everything', () => {
    const rows = [row(), row({ id: 'paid', stage: 'paid' })]
    expect(applyFilters(rows, { view: 'mine' }, NOW).map(r => r.id)).toEqual(['b1'])
    expect(applyFilters(rows, { view: 'all' }, NOW).map(r => r.id).sort()).toEqual(['b1', 'paid'])
    // …but not when a filter narrows it: "all, in WH" means live bills in WH.
    expect(applyFilters(rows, { view: 'all', project: 'WH' }, NOW).map(r => r.id)).toEqual(['b1'])
  })

  it('flags the same bill number booked twice on one order — as a warning', () => {
    const rows = [row(), row({ id: 'b2', billNo: 'ru-wh-cv/08 ' })]
    const d = duplicateKeys(rows)
    expect(tagsFor(rows[0], d)).toContain('duplicate')
    // Different order, same number: not a duplicate.
    expect(tagsFor(row({ orderNo: 'WO/OTHER' }), d)).not.toContain('duplicate')
  })

  it('says on the row that the stamped bill is missing, at the Disc Head only', () => {
    const none = new Set<string>()
    expect(tagsFor(row({ hasStampedBill: false }), none)).toContain('stamped_missing')
    expect(tagsFor(row({ hasStampedBill: false, stage: 'ct_head' }), none)).not.toContain('stamped_missing')
    expect(tagsFor(row(), none)).toEqual(['arrived'])
  })

  it('puts the send-back reason on the row', () => {
    expect(whyHere(row({ lastAction: 'send_back', lastComment: 'quantity on item 4 above BOQ' })))
      .toBe('Sent back — "quantity on item 4 above BOQ"')
    expect(whyHere(row())).toBe('Abstract approved in IN4 — moved on automatically')
    expect(whyHere(row({ lastComment: null }))).toBeNull()
  })

  it('totals what is waiting on me, examples left out, worst age wins', () => {
    const w = waitingOnMe([
      row({ amount: 100, stageSince: daysAgo(1) }),
      row({ id: 'b2', amount: 50, stageSince: daysAgo(6) }),
      row({ id: 'ex', amount: 9999, isExample: true }),
      row({ id: 'theirs', amount: 7, mine: false }),
    ], NOW)
    expect(w).toEqual({ bills: 2, value: 150, oldestDays: 6, tone: 'late' })
  })

  it('writes a CSV a spreadsheet can sort, quoting what needs it', () => {
    const csv = toCsv([row({ lastComment: 'Sent back, "item 4"' })], s => stageDef(s).label, NOW)
    const [head, line] = csv.split('\r\n')
    expect(head.startsWith('Vendor,Order,Bill no')).toBe(true)
    expect(line).toContain('CT Disc Head')
    expect(line).toContain('"Sent back, ""item 4"""')
    expect(line).toContain(',5069122,')
  })
})
