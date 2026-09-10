import { describe, it, expect } from 'vitest'
import { normaliseBoq, stripBoqNumber, referencesFor, turnOf } from './order-approvals'
import { referenceRate, priceDelta } from './approver'

describe('normaliseBoq — the same BOQ item written two ways is one key', () => {
  it('ignores case, punctuation and spacing, keeps the unit', () => {
    expect(normaliseBoq('Interior Plaster - 12 mm thick to wall', 'SqFt')).toBe(normaliseBoq('interior plaster – 12 mm thick to wall', 'sqft'))
    expect(normaliseBoq('PCC', 'CUM')).not.toBe(normaliseBoq('PCC', 'SqFt'))
    expect(normaliseBoq(null, null)).toBe('|')
  })
  it('drops the running number a WO puts in front of an item', () => {
    expect(normaliseBoq('7. Protection Plaster', 'SqM')).toBe(normaliseBoq('Protection Plaster', 'SqM'))
    expect(normaliseBoq('1) Epoxy grouting', 'RFt')).toBe(normaliseBoq('Epoxy grouting', 'RFt'))
    expect(stripBoqNumber('40MM : PVC CONDUITE')).toBe('40MM : PVC CONDUITE')
  })
})

describe('turnOf — whose turn it is in IN4', () => {
  it('Verify is the Atm Head’s, Submitted the verifier’s, ReSubmit goes back to the raiser', () => {
    expect([113, 117, 1, 77, 60].map(turnOf)).toEqual(['approver', 'approver', 'verifier', 'verifier', 'raiser'])
  })
})

describe('referencesFor — prior lines keyed by name, judged from one project', () => {
  const L = (key: string, rate: number, projectId: number, date: string, party: string) => ({
    key, materialId: 0, poId: 1, poNo: 'WO/1', date, supplier: party, project: projectId === 12 ? 'NGH' : 'RU', projectId, qty: 100, rate, value: rate * 100, grnQty: 0,
  })
  const plaster = normaliseBoq('Interior Plaster - 12 mm thick to wall', 'SqFt')
  const lines = [
    L(plaster, 36, 12, '2026-02-01T00:00:00.000Z', 'A'),
    L(plaster, 42, 7, '2026-08-01T00:00:00.000Z', 'B'),
    L(normaliseBoq('PCC', 'CUM'), 4800, 7, '2026-05-01T00:00:00.000Z', 'C'),
  ]
  it('this project’s last rate first, else the trust’s; unknown items get nothing', () => {
    const refs = referencesFor(lines, [plaster, normaliseBoq('PCC', 'CUM'), normaliseBoq('New thing', 'No')], 12)
    expect(referenceRate(refs.get(plaster))).toMatchObject({ rate: 36, where: 'here' })
    expect(referenceRate(refs.get(normaliseBoq('PCC', 'CUM')))).toMatchObject({ rate: 4800, where: 'elsewhere' })
    expect(refs.get(normaliseBoq('New thing', 'No'))).toBeUndefined()
    expect(priceDelta(38, refs.get(plaster))).toBeCloseTo(5.56, 1)
  })
  it('from another project the same lines read differently', () => {
    const refs = referencesFor(lines, [plaster], 7)
    expect(referenceRate(refs.get(plaster))).toMatchObject({ rate: 42, where: 'here' })
    expect(refs.get(plaster)!.onProject.orderedQty).toBe(100)
  })
})
