import { describe, it, expect } from 'vitest'
import {
  canMarkComplete, savingsOnCompletion, canCompleteDiscipline,
  blockersForDiscipline, cascadeCount, hasMoney,
} from './completion'

describe('canMarkComplete', () => {
  // Real SRAH lines. The eligible ones all have WO === Paid to the rupee.
  it('offers it on 1213 SS Works — WO and Paid both ₹1,87,620', () => {
    const f = { budget: 350000, wo: 187620, paid: 187620 }
    expect(canMarkComplete(f)).toBe(true)
    expect(savingsOnCompletion(f)).toBe(162380)
  })

  it('offers it on 1911 GEB Construction Electricity', () => {
    const f = { budget: 3086950, wo: 2210288, paid: 2210288 }
    expect(canMarkComplete(f)).toBe(true)
    expect(savingsOnCompletion(f)).toBe(876662)
  })

  it('offers it when the budget was spent to the rupee — no saving', () => {
    const f = { budget: 34000, wo: 34000, paid: 34000 }
    expect(canMarkComplete(f)).toBe(true)
    expect(savingsOnCompletion(f)).toBe(0)
  })

  it('withholds it on 302 Steel Works — WO is ₹6 above Paid', () => {
    expect(canMarkComplete({ budget: 6355388, wo: 6758594, paid: 6758588 })).toBe(false)
  })

  it('withholds it on 1004 BHP — committed ₹3,82,518 but nothing paid', () => {
    expect(canMarkComplete({ budget: 385000, wo: 382518, paid: 0 })).toBe(false)
  })

  it('withholds it on 717 Contractor Cost — ₹1.78 Cr still unpaid', () => {
    expect(canMarkComplete({ budget: 25600000, wo: 25100005, paid: 7314141 })).toBe(false)
  })

  it('withholds it when nothing has been committed — not started, not finished', () => {
    expect(canMarkComplete({ budget: 500000, wo: 0, paid: 0 })).toBe(false)
  })

  it('still offers it on an overspent line, but reports no saving', () => {
    // 303 Concrete Work: paid matches WO, and both are past the budget.
    const f = { budget: 2311645, wo: 2366247, paid: 2366247 }
    expect(canMarkComplete(f)).toBe(true)
    expect(savingsOnCompletion(f)).toBe(0)
  })

  it('ignores paise: 307 Dowels is ₹59,206.20 on both sides', () => {
    expect(canMarkComplete({ budget: 59206, wo: 59206.2, paid: 59206.2 })).toBe(true)
  })

  it('handles a missing budget line', () => {
    expect(canMarkComplete(null)).toBe(false)
    expect(savingsOnCompletion(undefined)).toBe(0)
  })
})

describe('the work-category rule', () => {
  const closable = { budget: 500000, wo: 400000, paid: 400000 }
  const owing = { budget: 500000, wo: 400000, paid: 100000 }
  const empty = { budget: 0, wo: 0, paid: 0 }

  it('closes a category whose money-bearing sub-categories all match', () => {
    expect(canCompleteDiscipline([
      { completed: false, figures: closable },
      { completed: true, figures: owing },   // already closed — no longer a blocker
      { completed: false, figures: empty },  // empty row — not unfinished work
    ])).toBe(true)
  })

  it('refuses while any sub-category still owes money', () => {
    expect(canCompleteDiscipline([
      { completed: false, figures: closable },
      { completed: false, figures: owing },
    ])).toBe(false)
  })

  it('names what is blocking it', () => {
    const subs = [
      { completed: false, figures: closable, label: 'ok' },
      { completed: false, figures: owing, label: 'still owed' },
      { completed: false, figures: empty, label: 'empty' },
    ]
    expect(blockersForDiscipline(subs).map(s => s.label)).toEqual(['still owed'])
  })

  it('refuses a category with no money anywhere — nothing to close', () => {
    expect(canCompleteDiscipline([
      { completed: false, figures: empty },
      { completed: false, figures: null },
    ])).toBe(false)
  })

  it('counts what the cascade will close, ignoring the already-closed', () => {
    expect(cascadeCount([
      { completed: false, figures: closable },
      { completed: false, figures: closable },
      { completed: true, figures: closable },
      { completed: false, figures: empty },
    ])).toBe(2)
  })

  it('treats budget with nothing committed as unfinished, not empty', () => {
    // Real money sitting on a line nobody has raised a WO against — the work
    // has not started, so the category is not finished.
    expect(hasMoney({ budget: 385000, wo: 0, paid: 0 })).toBe(true)
    expect(canCompleteDiscipline([{ completed: false, figures: { budget: 385000, wo: 0, paid: 0 } }])).toBe(false)
  })
})
