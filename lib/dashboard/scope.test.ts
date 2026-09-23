import { describe, it, expect } from 'vitest'
import { verifyRowsFor, tileBadges, groupByModule, istGreeting } from './scope'

const NGH = { id: 'ngh', code: 'NGH A', name: 'New Guest House A' }
const RU = { id: 'ru', code: null, name: 'Raj Uphaar' }
const EK = { id: 'ek', code: 'EK', name: 'Ek Building' }

const portfolio = {
  byProject: {
    ngh: { indents: 1, wos: 0, pos: 0 },
    ru:  { indents: 0, wos: 2, pos: 1 },
    ek:  { indents: 0, wos: 0, pos: 0 },
  },
  unassigned: { indents: 0, wos: 0, pos: 3 },
}

describe('verifyRowsFor — the IN4 Verify card is the Atm Head’s alone', () => {
  it('an engineer, viewer or admin who heads no project sees nothing, not even the loose documents', () => {
    const r = verifyRowsFor(portfolio, new Set(), [NGH, RU, EK])
    expect(r.isHead).toBe(false)
    expect(r.rows).toEqual([])
    expect(r.unassigned).toEqual({ indents: 0, wos: 0, pos: 0 })
  })

  it('a head sees only the projects they head, biggest first, code before name', () => {
    const r = verifyRowsFor(portfolio, new Set(['ru', 'ngh']), [NGH, RU, EK])
    expect(r.isHead).toBe(true)
    expect(r.rows.map(x => x.label)).toEqual(['Raj Uphaar', 'NGH A'])
    expect(r.rows[0]).toEqual({ projectId: 'ru', label: 'Raj Uphaar', indents: 0, wos: 2, pos: 1 })
  })

  it('a head sees the documents parked on no sub-project — they can only be found in IN4', () => {
    const r = verifyRowsFor(portfolio, new Set(['ek']), [NGH, RU, EK])
    expect(r.rows).toEqual([])            // EK has nothing at Verify
    expect(r.unassigned.pos).toBe(3)
  })

  it('never names a project the shell does not let the reader open', () => {
    const r = verifyRowsFor(portfolio, new Set(['ru', 'ngh']), [NGH])
    expect(r.rows.map(x => x.projectId)).toEqual(['ngh'])
  })
})

describe('tileBadges + groupByModule — live counts and named groups from one inbox', () => {
  const inbox = [
    { module_slug: 'bills-booking' }, { module_slug: 'cost-control' }, { module_slug: 'bills-booking' },
    { module_slug: 'jmr' }, { module_slug: 'bills-booking' },
  ]
  it('counts per module', () => {
    expect(tileBadges(inbox)).toEqual({ 'bills-booking': 3, 'cost-control': 1, jmr: 1 })
    expect(tileBadges([])).toEqual({})
  })
  it('groups largest first and keeps arrival order inside a group', () => {
    const g = groupByModule(inbox.map((x, i) => ({ ...x, i })))
    expect(g.map(x => x.slug)).toEqual(['bills-booking', 'cost-control', 'jmr'])
    expect(g[0].items.map(x => x.i)).toEqual([0, 2, 4])
  })
})

describe('istGreeting — by the Indian clock, not the server’s', () => {
  it('06:30 UTC is noon in India: Afternoon, not Morning', () => {
    expect(istGreeting(Date.parse('2026-09-23T06:30:00Z'))).toBe('Afternoon')
  })
  it('03:00 UTC = 08:30 IST → Morning; 12:30 UTC = 18:00 IST → Evening', () => {
    expect(istGreeting(Date.parse('2026-09-23T03:00:00Z'))).toBe('Morning')
    expect(istGreeting(Date.parse('2026-09-23T12:30:00Z'))).toBe('Evening')
  })
})
