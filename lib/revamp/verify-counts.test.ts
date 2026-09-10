import { describe, it, expect } from 'vitest'
import { verifyBadges } from './verify-counts'

describe('verifyBadges — the yellow numbers on Indents and WO / PO', () => {
  it('puts indents on Indents and WOs + POs together on WO / PO, with words for the tooltip', () => {
    const { badges, titles } = verifyBadges({ indents: 1, wos: 1, pos: 2 })
    expect(badges).toEqual({ procurement: 1, 'wo-po': 3 })
    expect(titles['procurement']).toBe('1 indent at Verify in IN4 — waiting for the Atm Head')
    expect(titles['wo-po']).toBe('1 WO and 2 POs at Verify in IN4 — waiting for the Atm Head')
  })
  it('shows nothing when nothing is at Verify', () => {
    expect(verifyBadges({ indents: 0, wos: 0, pos: 0 })).toEqual({ badges: {}, titles: {} })
    expect(verifyBadges({ indents: 0, wos: 0, pos: 1 }).titles['wo-po']).toBe('1 PO at Verify in IN4 — waiting for the Atm Head')
  })
})
