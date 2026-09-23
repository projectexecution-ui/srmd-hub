import { describe, it, expect } from 'vitest'
import { recodeWs, wsCodeCandidates } from './ws-code'

describe('recodeWs — the code follows the sheet', () => {
  // The real case: NGH A's imported baseline moving from 801 to 804.
  it('swaps the sub-skill code where the code carries it', () => {
    expect(recodeWs('A-801-B01', '801', '804')).toBe('A-804-B01')
  })

  it('prefixes a code that does not carry the old one, rather than leaving it pointing elsewhere', () => {
    expect(recodeWs('Kitchen-rev2', '801', '804')).toBe('804-Kitchen-rev2')
  })

  it('leaves the code alone when the sub-skill is not actually changing', () => {
    expect(recodeWs('A-801-B01', '801', '801')).toBe('A-801-B01')
  })

  it('swaps only the first occurrence, so a code that repeats the number keeps its shape', () => {
    expect(recodeWs('801-A-801', '801', '804')).toBe('804-A-801')
  })

  it('falls back to the target code for an empty one', () => {
    expect(recodeWs('   ', '801', '804')).toBe('804')
  })
})

describe('wsCodeCandidates — collisions do not fail the move', () => {
  it('offers the plain code first', () => {
    expect(wsCodeCandidates('A-804-B01')[0]).toBe('A-804-B01')
  })

  it('then walks numbered suffixes', () => {
    expect(wsCodeCandidates('A-804-B01', 3).slice(1, 4)).toEqual(['A-804-B01-2', 'A-804-B01-3', 'A-804-B01-4'])
  })

  it('ends with one that cannot collide', () => {
    const list = wsCodeCandidates('A-804-B01', 2, 1_700_000_000_000)
    expect(list).toHaveLength(4) // base + 2 numbered + the last resort
    expect(list.at(-1)).toMatch(/^A-804-B01-[0-9A-Z]{6}$/)
  })

  it('never returns a duplicate', () => {
    const list = wsCodeCandidates('A-804-B01', 8)
    expect(new Set(list).size).toBe(list.length)
  })
})
