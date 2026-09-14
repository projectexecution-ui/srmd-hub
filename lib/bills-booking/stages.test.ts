import { describe, it, expect } from 'vitest'
import {
  PIPELINE, LEGACY, stageDef, stageIndex, nextStage, prevStage,
  isTerminal, slaFor, daysAtStage, isOverSla, type BbStage,
} from './stages'

const NOW = new Date('2026-09-14T12:00:00Z').getTime()
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString()

describe('the stage spine', () => {
  // Aksha, 13 Sep 2026: the Atm Head no longer approves in IN4 — the CT Hub
  // click is the approval of record and CT Billing keys IN4 afterwards. The
  // ladder went on showing "Atm (IN4)" as step 7 of 9 for a day.
  it('no longer walks through Atm (IN4)', () => {
    expect(PIPELINE.map(s => s.key)).not.toContain('atm_in4')
    expect(nextStage('ct_billing')).toBe('trust')
    expect(prevStage('trust')).toBe('ct_billing')
  })

  it('still renders a bill parked at the retired stage instead of blanking', () => {
    expect(LEGACY.map(s => s.key)).toContain('atm_in4')
    expect(stageDef('atm_in4' as BbStage).label).toMatch(/retired/i)
    // Off the ladder, so it has no position on it.
    expect(stageIndex('atm_in4' as BbStage)).toBe(-1)
  })

  it('is eight steps, ending at Paid', () => {
    expect(PIPELINE).toHaveLength(8)
    expect(PIPELINE[0].key).toBe('submitted')
    expect(PIPELINE.at(-1)!.key).toBe('paid')
    expect(isTerminal('paid')).toBe(true)
    expect(isTerminal('rejected')).toBe(true)
  })

  // Work ends at Approved; Entity Trust Accounts take it on from there, and the
  // Paid entry is made sometimes by them and sometimes by CT.
  it('marks Trust and Paid as followed, not owned', () => {
    expect(stageDef('trust').tracking).toBe(true)
    expect(stageDef('paid').tracking).toBe(true)
    expect(stageDef('ct_head').tracking).toBeUndefined()
  })
})

describe('how late is late', () => {
  it('counts the days a bill has sat where it is', () => {
    expect(Math.round(daysAtStage(ago(19), NOW))).toBe(19)
    expect(daysAtStage(null, NOW)).toBe(0)
    expect(daysAtStage('not a date', NOW)).toBe(0)
  })

  it('calls a CT desk late once it is past its own limit', () => {
    expect(slaFor('ct_head')).toBe(3)
    expect(isOverSla('ct_head', ago(2), NOW)).toBe(false)
    expect(isOverSla('ct_head', ago(4), NOW)).toBe(true)
  })

  // Colouring a delay red at a desk nobody at CT can move only teaches people
  // to ignore red. The days are still shown; the word "late" is not used.
  it('never calls Trust or Paid late, however long they sit', () => {
    expect(slaFor('trust')).toBeUndefined()
    expect(isOverSla('trust', ago(358), NOW)).toBe(false)
    expect(isOverSla('paid', ago(999), NOW)).toBe(false)
    // …but the wait is still measurable, so a delay tracker can read it.
    expect(Math.round(daysAtStage(ago(358), NOW))).toBe(358)
  })

  it('never calls an off-pipeline bill late either', () => {
    expect(isOverSla('on_hold', ago(90), NOW)).toBe(false)
    expect(isOverSla('rejected', ago(90), NOW)).toBe(false)
  })
})
