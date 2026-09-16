import { describe, it, expect } from 'vitest'
import {
  sayStage, sayStatus, VOCABULARY, ENTRY_STAGES, REQUEST_STATUSES, MAX_LABEL,
} from './status'

/**
 * The point of this file is that there is exactly ONE word for each state.
 *
 * Before it, the gate filter and the chip beside it said different things
 * about the same row, and the requests filter said "With Mayank / Kanti" while
 * the card said "Pending". These tests are what stops that growing back.
 */
describe('one status language', () => {
  it('names every entry stage', () => {
    for (const s of ENTRY_STAGES) expect(sayStage(s).label).toBeTruthy()
    expect(ENTRY_STAGES).toEqual(['gate', 'complete', 'closed', 'void'])
  })

  it('names every request status', () => {
    for (const s of REQUEST_STATUSES) expect(sayStatus(s).label).toBeTruthy()
    expect(REQUEST_STATUSES).toEqual(['pending', 'approved', 'rejected', 'issued', 'closed'])
  })

  it('gives two different entry stages two different words', () => {
    const labels = ENTRY_STAGES.map(s => sayStage(s).label)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('gives two different request statuses two different words', () => {
    const labels = REQUEST_STATUSES.map(s => sayStatus(s).label)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('says whose desk it is on, rather than naming a database value', () => {
    expect(sayStatus('pending').label).toBe('With Mayank / Kanti')
    expect(sayStatus('approved').label).toBe('With the storekeeper')
    expect(sayStage('gate').label).toBe('Waiting on storekeeper')
  })

  it('shares one word only where the fact really is the same', () => {
    // A signed-for entry and a signed-for request are the same thing happening.
    expect(sayStage('closed').label).toBe(sayStatus('closed').label)
    const shared = VOCABULARY.filter(v => v.states.length > 1)
    expect(shared.map(v => v.label)).toEqual(['Closed'])
    expect(shared[0].states.sort()).toEqual(['entry:closed', 'request:closed'])
  })

  it('keeps every word short enough to read across a desk', () => {
    const tooLong = VOCABULARY.filter(v => v.label.length > MAX_LABEL).map(v => v.label)
    expect(tooLong).toEqual([])
  })

  it('explains every word in the vocabulary panel', () => {
    for (const v of VOCABULARY) expect(v.meaning.length).toBeGreaterThan(10)
  })

  it('never names a column or a code in a label', () => {
    const jargon = /_id\b|status|stage|flag|null|boolean/i
    expect(VOCABULARY.filter(v => jargon.test(v.label)).map(v => v.label)).toEqual([])
  })

  it('falls back to a real state rather than a blank one', () => {
    // A row with no status at all reads as a bug; the gate is the one state a
    // new row can honestly be in.
    expect(sayStage(null).label).toBe(sayStage('gate').label)
    expect(sayStage('something-new').label).toBe(sayStage('gate').label)
    expect(sayStatus(undefined).label).toBe(sayStatus('pending').label)
  })

  it('marks exactly the states somebody has to act on as waiting', () => {
    expect(ENTRY_STAGES.filter(s => sayStage(s).tone === 'wait')).toEqual(['gate'])
    expect(REQUEST_STATUSES.filter(s => sayStatus(s).tone === 'wait')).toEqual(['pending'])
  })
})
