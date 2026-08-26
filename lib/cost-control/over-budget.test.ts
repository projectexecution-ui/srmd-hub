import { describe, it, expect } from 'vitest'
import { overBudgetAmount, overBudgetDriver } from './over-budget'

describe('overBudgetAmount', () => {
  // The three real SRAH lines that prompted the HOD's point 4.
  it('flags SRAH 302 Steel Works', () => {
    const f = { budget: 6355387.66, wo: 6758594.42, paid: 6758588.4129 }
    // Each side is rounded BEFORE subtracting, so the marker always agrees with
    // the rupee figures shown in the Budget and WO columns beside it.
    expect(overBudgetAmount(f)).toBe(403206)
    expect(overBudgetDriver(f)).toBe('committed')
  })

  it('flags SRAH 303 Concrete Work', () => {
    expect(overBudgetAmount({ budget: 2311645, wo: 2366247.42, paid: 2366247.3722 })).toBe(54602)
  })

  it('does NOT flag SRAH 307 Dowels — 20 paise is not an overspend', () => {
    expect(overBudgetAmount({ budget: 59206, wo: 59206.2, paid: 59206.2 })).toBe(0)
  })

  it('is silent when spend is inside the budget', () => {
    expect(overBudgetAmount({ budget: 1000000, wo: 900000, paid: 500000 })).toBe(0)
  })

  it('treats no released budget as not-an-overrun', () => {
    expect(overBudgetAmount({ budget: 0, wo: 500000, paid: 250000 })).toBe(0)
  })

  it('catches a committed overrun before anything is paid', () => {
    const f = { budget: 100000, wo: 150000, paid: 0 }
    expect(overBudgetAmount(f)).toBe(50000)
    expect(overBudgetDriver(f)).toBe('committed')
  })

  it('reports paid as the driver when paid has passed the committed figure', () => {
    expect(overBudgetDriver({ budget: 100000, wo: 110000, paid: 120000 })).toBe('paid')
  })

  it('handles a missing budget line', () => {
    expect(overBudgetAmount(null)).toBe(0)
    expect(overBudgetDriver(undefined)).toBe(null)
  })
})
