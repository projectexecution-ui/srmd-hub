import { describe, expect, it } from 'vitest'
import {
  isCrossProject, returnableLock, waiveBlocker, waivableLines,
  stillExpectedBack, returnSummary, WAIVE_FROM,
} from './cross-project'
import type { WaivableLine } from './cross-project'

const NGH_A = 'p-ngh-a'
const P2 = 'p-p2'

const line = (over: Partial<WaivableLine> = {}): WaivableLine => ({
  lineId: 'l1', isReturnable: true, waivedAt: null, issuedQty: 10, ...over,
})

describe('is this another project’s stock', () => {
  it('yes when the store belongs to a different project', () => {
    expect(isCrossProject({ projectId: NGH_A }, { projectId: P2 })).toBe(true)
  })
  it('no when it is the same project', () => {
    expect(isCrossProject({ projectId: NGH_A }, { projectId: NGH_A })).toBe(false)
  })
  it('no for a shared store, whoever asks', () => {
    // Central Store and the CT containers hold common stock.
    expect(isCrossProject({ projectId: null }, { projectId: P2 })).toBe(false)
    expect(isCrossProject({ projectId: null }, { projectId: null })).toBe(false)
  })
  it('yes when the store is owned but the request names no project', () => {
    // Otherwise the rule is avoided by leaving the project blank.
    expect(isCrossProject({ projectId: NGH_A }, { projectId: null })).toBe(true)
  })
})

describe('the engineer is told why the tick is locked', () => {
  it('says whose stock it is and that the Head can waive it later', () => {
    const msg = returnableLock({ projectId: NGH_A }, { projectId: P2 }, 'NGH A')
    expect(msg).toContain('NGH A')
    expect(msg).toMatch(/returnable/i)
    expect(msg).toMatch(/waive/i)
  })
  it('tells him to name the project when that is what would clear it', () => {
    const msg = returnableLock({ projectId: NGH_A }, { projectId: null }, 'NGH A')
    expect(msg).toMatch(/name the project/i)
  })
  it('falls back gracefully when the project name is unknown', () => {
    const msg = returnableLock({ projectId: NGH_A }, { projectId: P2 }, null)
    expect(msg).toMatch(/another project/i)
  })
  it('says nothing when the engineer is free to choose', () => {
    expect(returnableLock({ projectId: null }, { projectId: P2 }, null)).toBeNull()
    expect(returnableLock({ projectId: NGH_A }, { projectId: NGH_A }, 'NGH A')).toBeNull()
  })
})

describe('who may release a return, and when', () => {
  it('refuses anyone who is not the Atm Head or an admin', () => {
    const why = waiveBlocker({ status: 'approved', canWaive: false, lines: [line()] })
    expect(why).toMatch(/Atm Head or an admin/i)
  })

  it('refuses before the request is approved', () => {
    for (const status of ['pending', 'checked', 'rejected', 'cancelled']) {
      const why = waiveBlocker({ status, canWaive: true, lines: [line()] })
      expect(why, status).toMatch(/not been approved/i)
    }
  })

  it('allows it at every stage from approval onwards', () => {
    // Post-approval flexibility is the whole request: the Head must be able to
    // decide this after the fact, including once the material is out.
    for (const status of WAIVE_FROM) {
      expect(waiveBlocker({ status, canWaive: true, lines: [line()] }), status).toBeNull()
    }
  })

  it('says so when nothing was returnable', () => {
    const why = waiveBlocker({
      status: 'approved', canWaive: true, lines: [line({ isReturnable: false })],
    })
    expect(why).toMatch(/Nothing on this request was returnable/i)
  })

  it('says so when it has all been released already', () => {
    const why = waiveBlocker({
      status: 'approved', canWaive: true, lines: [line({ waivedAt: '2026-08-20T00:00:00Z' })],
    })
    expect(why).toMatch(/already been released/i)
  })

  it('still allows it when only some lines are released', () => {
    expect(waiveBlocker({
      status: 'approved', canWaive: true,
      lines: [line({ lineId: 'a', waivedAt: '2026-08-20T00:00:00Z' }), line({ lineId: 'b' })],
    })).toBeNull()
  })
})

describe('which lines a waiver touches', () => {
  it('only returnable lines that are not already released', () => {
    const ls = [
      line({ lineId: 'a' }),
      line({ lineId: 'b', isReturnable: false }),
      line({ lineId: 'c', waivedAt: '2026-08-20T00:00:00Z' }),
    ]
    expect(waivableLines(ls).map(l => l.lineId)).toEqual(['a'])
  })
})

describe('what the Returnables report should still count', () => {
  it('counts a returnable line that went out and has not been released', () => {
    expect(stillExpectedBack(line())).toBe(true)
  })
  it('drops a released line, even though nothing physically came back', () => {
    expect(stillExpectedBack(line({ waivedAt: '2026-08-20T00:00:00Z' }))).toBe(false)
  })
  it('ignores a line that was never returnable', () => {
    expect(stillExpectedBack(line({ isReturnable: false }))).toBe(false)
  })
  it('ignores a line nothing has been issued against yet', () => {
    // Nothing has left the store, so there is nothing to chase.
    expect(stillExpectedBack(line({ issuedQty: 0 }))).toBe(false)
  })
})

describe('the one-line summary on the request screen', () => {
  it('says nothing when no line was returnable', () => {
    expect(returnSummary([line({ isReturnable: false })])).toBeNull()
  })
  it('counts what must still come back', () => {
    expect(returnSummary([line({ lineId: 'a' }), line({ lineId: 'b' })]))
      .toBe('2 items must come back')
  })
  it('uses the singular for one', () => {
    expect(returnSummary([line()])).toBe('1 item must come back')
  })
  it('reports a full release', () => {
    expect(returnSummary([line({ waivedAt: '2026-08-20T00:00:00Z' })]))
      .toBe('1 item released — no need to return')
  })
  it('reports a partial release', () => {
    expect(returnSummary([line({ lineId: 'a' }), line({ lineId: 'b', waivedAt: '2026-08-20T00:00:00Z' })]))
      .toBe('1 still to come back · 1 released')
  })
})
