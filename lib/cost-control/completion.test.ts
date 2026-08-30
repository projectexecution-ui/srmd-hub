import { describe, it, expect } from 'vitest'
import {
  canMarkComplete, savingsOnCompletion, outstandingOnLine,
  outstandingUnderDiscipline, cascadeCount, hasMoney,
} from './completion'

describe('canMarkComplete — a CLEAN close, not a gate', () => {
  it('is true when WO equals Paid to the rupee', () => {
    expect(canMarkComplete({ budget: 350000, wo: 187620, paid: 187620 })).toBe(true)
  })

  it('ignores paise, because BPH carries them', () => {
    expect(canMarkComplete({ budget: 59206, wo: 59206.2, paid: 59206.2 })).toBe(true)
  })

  it('is false while a work order is part-paid', () => {
    expect(canMarkComplete({ budget: 25600000, wo: 25100005, paid: 7314141 })).toBe(false)
  })

  it('is false when nothing has been committed — not started, not finished', () => {
    expect(canMarkComplete({ budget: 500000, wo: 0, paid: 0 })).toBe(false)
  })

  it('handles nothing at all', () => {
    expect(canMarkComplete(null)).toBe(false)
  })
})

describe('outstandingOnLine', () => {
  it('is the unpaid part of the work order', () => {
    expect(outstandingOnLine({ budget: 25600000, wo: 25100005, paid: 7314141 })).toBe(17785864)
  })

  it('is zero on a clean line', () => {
    expect(outstandingOnLine({ budget: 350000, wo: 187620, paid: 187620 })).toBe(0)
  })

  it('never goes negative when more was paid than committed', () => {
    expect(outstandingOnLine({ budget: 100000, wo: 50000, paid: 80000 })).toBe(0)
  })
})

describe('savingsOnCompletion', () => {
  it('is budget minus paid on a clean close', () => {
    expect(savingsOnCompletion({ budget: 350000, wo: 187620, paid: 187620 })).toBe(162380)
  })

  it('does NOT release budget still committed on an unpaid WO', () => {
    // ₹2.56 Cr budget, ₹2.51 Cr on order, ₹73 L paid. The gap is committed,
    // not spare — releasing it would strip cover from invoices still to come.
    expect(savingsOnCompletion({ budget: 25600000, wo: 25100005, paid: 7314141 })).toBe(499995)
  })

  it('releases the whole budget when nothing was ever committed', () => {
    expect(savingsOnCompletion({ budget: 500000, wo: 0, paid: 0 })).toBe(500000)
  })

  it('is zero, never negative, on a line that overspent', () => {
    expect(savingsOnCompletion({ budget: 6355388, wo: 6758594, paid: 6758588 })).toBe(0)
  })
})

describe('the work-category view', () => {
  const clean = { budget: 500000, wo: 400000, paid: 400000 }
  const owing = { budget: 500000, wo: 400000, paid: 100000 }
  const empty = { budget: 0, wo: 0, paid: 0 }

  it('names the sub-categories that still owe money', () => {
    const subs = [
      { completed: false, figures: clean, label: 'clean' },
      { completed: false, figures: owing, label: 'still owed' },
      { completed: true, figures: owing, label: 'already closed' },
      { completed: false, figures: empty, label: 'empty' },
    ]
    expect(outstandingUnderDiscipline(subs).map(s => s.label)).toEqual(['still owed'])
  })

  it('counts what the cascade will close — money-bearing and still open', () => {
    expect(cascadeCount([
      { completed: false, figures: clean },
      { completed: false, figures: owing },
      { completed: true, figures: clean },
      { completed: false, figures: empty },
    ])).toBe(2)
  })

  it('treats budget with nothing committed as money', () => {
    expect(hasMoney({ budget: 385000, wo: 0, paid: 0 })).toBe(true)
    expect(hasMoney(empty)).toBe(false)
    expect(hasMoney(null)).toBe(false)
  })
})
