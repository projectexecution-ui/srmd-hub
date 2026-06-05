import { describe, it, expect } from 'vitest'
import { formatINR, formatINRShort, formatNumberIN, formatDateIN, formatDateShort } from './format'

// ============================================================================
// SCENARIO MATRIX — lib/jmr/format.ts (money + date display for JMR dashboard,
// matrix, and contractor bills). Pure functions, so we can exhaust the input
// space. Grouped: valid / invalid / edge / extreme.
//
// "Try to break it" findings that drove fixes:
//   • formatINR(Infinity)        was "₹Infin,ity"     → now "—"   (isFinite guard)
//   • formatINRShort(Infinity)   was "₹Infinity Cr"   → now "—"   (isFinite guard)
//   • formatDateIN("2026/05/21") THREW RangeError (crash) → now "—" (isValid guard)
// Known, documented limits (NOT fixed — beyond realistic money / cosmetic):
//   • formatINR(1e21)            → "₹1e,+21"  (JS toFixed goes exponential ≥1e21)
//   • formatINRShort(999.5)      → "₹1000"    (rounds to 1000 but no "K")
// ============================================================================

describe('formatINR (full ₹ + Indian grouping)', () => {
  describe('valid', () => {
    it('groups thousand / lakh / crore — why: the core money display everywhere', () => {
      expect(formatINR(1000)).toBe('₹1,000')
      expect(formatINR(12345)).toBe('₹12,345')
      expect(formatINR(150000)).toBe('₹1,50,000')
      expect(formatINR(10000000)).toBe('₹1,00,00,000')
    })
    it('rounds to 0 decimals by default — why: tiles show whole rupees', () => {
      expect(formatINR(1234.56)).toBe('₹1,235')
    })
    it('honours a custom decimal count — why: bill lines show paise', () => {
      expect(formatINR(1234.5, { decimals: 2 })).toBe('₹1,234.50')
      expect(formatINR(0.5, { decimals: 2 })).toBe('₹0.50')
    })
  })

  describe('edge', () => {
    it('zero — why: empty totals must read "₹0", not blank', () => {
      expect(formatINR(0)).toBe('₹0')
    })
    it('negative — why: credits / adjustments; sign goes BEFORE the ₹', () => {
      expect(formatINR(-150000)).toBe('-₹1,50,000')
    })
    it('negative zero collapses to ₹0 — why: never show "-₹0"', () => {
      expect(formatINR(-0)).toBe('₹0')
    })
    it('sub-thousand stays ungrouped', () => {
      expect(formatINR(999)).toBe('₹999')
    })
    it('realistic project max (11 digits ≈ ₹999 cr) groups correctly', () => {
      expect(formatINR(99999999999)).toBe('₹99,99,99,99,999')
    })
  })

  describe('invalid (wrong / missing type — data from loosely-typed RPCs)', () => {
    it('NaN → "—" — why: a failed Number() upstream must not render garbage', () => {
      expect(formatINR(NaN)).toBe('—')
    })
    it('null / undefined → "—"', () => {
      expect(formatINR(null as unknown as number)).toBe('—')
      expect(formatINR(undefined as unknown as number)).toBe('—')
    })
    it('a string is NOT coerced → "—" — why: this helper expects a real number', () => {
      // Number.isFinite does not coerce, so even "123" is rejected here.
      expect(formatINR('123' as unknown as number)).toBe('—')
    })
  })

  describe('extreme', () => {
    it('Infinity / -Infinity → "—" — why: a divide-by-zero ratio reaching a tile must not show "₹Infin,ity"', () => {
      expect(formatINR(Infinity)).toBe('—')
      expect(formatINR(-Infinity)).toBe('—')
    })
    it('KNOWN LIMIT: ≥1e21 leaks exponential notation (beyond any real money)', () => {
      // Documented in the gap report. Pinned so a future fix/regression is noticed.
      expect(formatINR(1e21)).toBe('₹1e,+21')
    })
  })
})

describe('formatINRShort (₹82.57 L / ₹1.42 Cr tiles)', () => {
  describe('valid', () => {
    it('K / L / Cr thresholds — why: dashboard tiles must be glanceable', () => {
      expect(formatINRShort(500)).toBe('₹500')
      expect(formatINRShort(1500)).toBe('₹1.5 K')
      expect(formatINRShort(8257000)).toBe('₹82.57 L')
      expect(formatINRShort(14167000)).toBe('₹1.42 Cr')
    })
  })

  describe('edge', () => {
    it('zero and tiny fractions', () => {
      expect(formatINRShort(0)).toBe('₹0')
      expect(formatINRShort(0.4)).toBe('₹0')
    })
    it('negative crore keeps sign before ₹', () => {
      expect(formatINRShort(-14167000)).toBe('-₹1.42 Cr')
    })
    it('exact 1-lakh / 1-crore boundaries', () => {
      expect(formatINRShort(100000)).toBe('₹1.00 L')
      expect(formatINRShort(10000000)).toBe('₹1.00 Cr')
    })
    it('KNOWN QUIRK: just-under-boundary rounds up within the unit, not to the next', () => {
      // 99,999 ≈ 1 lakh but shows as "₹100.0 K"; 99,99,999 ≈ 1 cr shows "₹100.00 L".
      // Cosmetic only — flagged in the gap report, pinned here.
      expect(formatINRShort(99999)).toBe('₹100.0 K')
      expect(formatINRShort(9999999)).toBe('₹100.00 L')
    })
  })

  describe('invalid', () => {
    it('NaN / null → "—"', () => {
      expect(formatINRShort(NaN)).toBe('—')
      expect(formatINRShort(null as unknown as number)).toBe('—')
    })
  })

  describe('extreme', () => {
    it('Infinity / -Infinity → "—" (was "₹Infinity Cr")', () => {
      expect(formatINRShort(Infinity)).toBe('—')
      expect(formatINRShort(-Infinity)).toBe('—')
    })
    it('KNOWN QUIRK: 999.5 rounds to "₹1000" instead of "₹1.0 K"', () => {
      expect(formatINRShort(999.5)).toBe('₹1000')
    })
  })
})

describe('formatNumberIN (grouped number, no symbol)', () => {
  describe('valid', () => {
    it('strips ₹ but keeps grouping', () => {
      expect(formatNumberIN(150000)).toBe('1,50,000')
      expect(formatNumberIN(1234.5, 2)).toBe('1,234.50')
    })
  })
  describe('edge', () => {
    it('zero and negative', () => {
      expect(formatNumberIN(0)).toBe('0')
      expect(formatNumberIN(-5000)).toBe('-5,000')
    })
  })
  describe('invalid / extreme', () => {
    it('NaN / Infinity → "—"', () => {
      expect(formatNumberIN(NaN)).toBe('—')
      expect(formatNumberIN(Infinity)).toBe('—')
    })
  })
})

describe('formatDateIN / formatDateShort', () => {
  describe('valid', () => {
    it('renders d MMM yyyy / d MMM yy — why: never US-style for Indian users', () => {
      expect(formatDateIN('2026-05-21')).toBe('21 May 2026')
      expect(formatDateShort('2026-05-21')).toBe('21 May 26')
    })
    it('accepts a Date object too', () => {
      expect(formatDateIN(new Date('2026-05-21T00:00:00Z'))).toMatch(/2026/)
    })
  })

  describe('invalid / edge', () => {
    it('null / undefined / empty → "—"', () => {
      expect(formatDateIN(null)).toBe('—')
      expect(formatDateIN(undefined)).toBe('—')
      expect(formatDateIN('')).toBe('—')
      expect(formatDateShort(null)).toBe('—')
    })
  })

  describe('extreme — try to break it', () => {
    it('unparseable strings return "—" instead of CRASHING — why: bad import data must not kill the page', () => {
      // Before the isValid guard these threw RangeError("Invalid time value"),
      // which would crash the whole route render.
      expect(formatDateIN('not-a-date')).toBe('—')
      expect(formatDateIN('2026/05/21')).toBe('—')   // slashes — common paste format
      expect(formatDateIN('2026-13-45')).toBe('—')   // impossible month/day
      expect(formatDateShort('garbage')).toBe('—')
    })
  })
})
