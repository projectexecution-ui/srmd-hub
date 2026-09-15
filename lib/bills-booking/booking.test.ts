import { describe, it, expect } from 'vitest'
import { resolveBooking, bookingGaps, stripSkillNumber, type BookingMaps } from './booking'

const RU_EXEC = 41          // Raj Uphaar - Execution — 136 WOs, no CT Hub project
const SRAH_EXEC = 12        // SRAH - Execution — 112 WOs, links to SRAH
const FINISHES = 46, CRECHE = 91

const SRAH = { id: 'p-srah', code: 'SRAH', name: 'SRAH' }
const RU_HUB = { id: 'p-ru', code: 'RU', name: 'Raj Uphaar' }
const PARIMAL = { id: 'u-par', name: 'Parimal' }
const MAYANK = { id: 'u-may', name: 'Mayank' }

function maps(over: Partial<BookingMaps> = {}): BookingMaps {
  return {
    subprojects: new Map([[RU_EXEC, 'Raj Uphaar - Execution'], [SRAH_EXEC, 'SRAH - Execution']]),
    linked: new Map([[SRAH_EXEC, SRAH]]),
    desks: new Map(),
    projectHeads: new Map([['p-srah', [PARIMAL]]]),
    people: new Map([['u-par', PARIMAL], ['u-may', MAYANK]]),
    ctProjects: new Map([['p-srah', SRAH], ['p-ru', RU_HUB]]),
    skills: new Map([[FINISHES, '12 Finishes'], [CRECHE, '46 Creche Area']]),
    disciplines: new Map([['finishes', { id: 'd-fin', name: 'Finishes' }]]),
    ...over,
  }
}

const wo = (subprojectId: number | null, categoryId: number | null = FINISHES, workDescription: string | null = 'Tiling to lobby') =>
  ({ subprojectId, categoryId, workDescription })

describe('where a bill books, worked out from the work order', () => {
  it('takes the CT Hub project from IN4 own link, and says so', () => {
    const b = resolveBooking(wo(SRAH_EXEC), maps())
    expect(b.projectId).toBe('p-srah')
    expect(b.projectName).toBe('SRAH')
    expect(b.projectSource).toBe('in4')
    expect(b.subprojectName).toBe('SRAH - Execution')
  })

  it('inherits the Atm Head already carrying the project in Cost Control', () => {
    const b = resolveBooking(wo(SRAH_EXEC), maps())
    expect(b.atmHeads).toEqual([PARIMAL])
    expect(b.atmSource).toBe('project')
    expect(bookingGaps(b)).toEqual([])
  })

  // The 30 sub-projects CT Hub has no project for — Raj Uphaar, Staff
  // Facilities Block, Warehouse, Raj Saurabh. Most of the money.
  it('leaves the project empty rather than guessing when CT Hub has none', () => {
    const b = resolveBooking(wo(RU_EXEC), maps())
    expect(b.projectId).toBeNull()
    expect(b.projectSource).toBeNull()
    expect(b.hasDesk).toBe(false)
    expect(b.subprojectName).toBe('Raj Uphaar - Execution')
    expect(bookingGaps(b)).toEqual(['no CT Hub project', 'no Atm Head'])
  })

  it('a desk with only an Atm Head answers the approval question, project or no project', () => {
    const b = resolveBooking(wo(RU_EXEC), maps({
      desks: new Map([[RU_EXEC, { subproject_id: RU_EXEC, in4_name: 'Raj Uphaar - Execution', cc_project_id: null, atm_head_id: 'u-may', note: null }]]),
    }))
    expect(b.hasDesk).toBe(true)
    expect(b.atmHeads).toEqual([MAYANK])
    expect(b.atmSource).toBe('desk')
    expect(b.projectId).toBeNull()
    expect(bookingGaps(b)).toEqual(['no CT Hub project'])
  })

  it('a desk pointed at a CT Hub project fills it, marked as the desk not IN4', () => {
    const b = resolveBooking(wo(RU_EXEC), maps({
      desks: new Map([[RU_EXEC, { subproject_id: RU_EXEC, in4_name: 'Raj Uphaar - Execution', cc_project_id: 'p-ru', atm_head_id: null, note: null }]]),
    }))
    expect(b.projectId).toBe('p-ru')
    expect(b.projectSource).toBe('desk')
  })

  it('IN4 own link wins over a desk that points somewhere else — the ERP is what Billing keys against', () => {
    const b = resolveBooking(wo(SRAH_EXEC), maps({
      desks: new Map([[SRAH_EXEC, { subproject_id: SRAH_EXEC, in4_name: 'SRAH - Execution', cc_project_id: 'p-ru', atm_head_id: null, note: null }]]),
    }))
    expect(b.projectId).toBe('p-srah')
    expect(b.projectSource).toBe('in4')
  })

  it('an Atm Head named on the desk beats one inherited from Cost Control', () => {
    const b = resolveBooking(wo(SRAH_EXEC), maps({
      desks: new Map([[SRAH_EXEC, { subproject_id: SRAH_EXEC, in4_name: 'SRAH - Execution', cc_project_id: null, atm_head_id: 'u-may', note: null }]]),
    }))
    expect(b.atmHeads).toEqual([MAYANK])
    expect(b.atmSource).toBe('desk')
  })

  it('lists both heads rather than picking one when a project has two', () => {
    const b = resolveBooking(wo(SRAH_EXEC), maps({ projectHeads: new Map([['p-srah', [PARIMAL, MAYANK]]]) }))
    expect(b.atmHeads).toEqual([PARIMAL, MAYANK])
    expect(bookingGaps(b)).toEqual([])
  })

  it('reads the category and matches the CT Hub discipline once the sort number is dropped', () => {
    const b = resolveBooking(wo(SRAH_EXEC, FINISHES), maps())
    expect(b.categoryIn4).toBe('12 Finishes')
    expect(b.disciplineName).toBe('Finishes')
    expect(b.disciplineId).toBe('d-fin')
  })

  // 134 of 1,685 work orders sit on an IN4 category CT Hub has no discipline
  // for. IN4's own name is still better than an empty box.
  it('keeps IN4 own category when no CT Hub discipline matches', () => {
    const b = resolveBooking(wo(SRAH_EXEC, CRECHE), maps())
    expect(b.categoryIn4).toBe('46 Creche Area')
    expect(b.disciplineId).toBeNull()
    expect(b.disciplineName).toBeNull()
  })

  it('carries the scope off the work order, trimmed, and null when blank', () => {
    expect(resolveBooking(wo(SRAH_EXEC, FINISHES, '  Excavation and rock breaking '), maps()).scope)
      .toBe('Excavation and rock breaking')
    expect(resolveBooking(wo(SRAH_EXEC, FINISHES, '   '), maps()).scope).toBeNull()
    expect(resolveBooking(wo(SRAH_EXEC, FINISHES, null), maps()).scope).toBeNull()
  })

  it('resolves nothing, and throws nothing, with no work order at all', () => {
    const b = resolveBooking(null, maps())
    expect(b.subprojectId).toBeNull()
    expect(b.atmHeads).toEqual([])
    expect(bookingGaps(b)).toEqual(['no CT Hub project', 'no Atm Head'])
  })

  // A purchase order carries no skill id — IN4 writes the skill on its bills,
  // as a name. It must reach the same CT Hub discipline a work order does.
  it('resolves a purchase order by the category NAME when there is no skill id', () => {
    const b = resolveBooking(
      { subprojectId: SRAH_EXEC, categoryId: null, categoryName: '12 (M) Finishes', workDescription: null },
      maps())
    expect(b.categoryIn4).toBe('12 (M) Finishes')
    expect(b.disciplineId).toBe('d-fin')
    expect(b.disciplineName).toBe('Finishes')
    expect(b.projectId).toBe('p-srah')
    // A purchase order has no scope field, and one is not invented for it.
    expect(b.scope).toBeNull()
  })

  it('prefers the skill id when the order carries one', () => {
    const b = resolveBooking(
      { subprojectId: SRAH_EXEC, categoryId: FINISHES, categoryName: '19 (M) Site Admin', workDescription: null },
      maps())
    expect(b.categoryIn4).toBe('12 Finishes')
  })

  it('falls back to the name the desk recorded if IN4 no longer lists the sub-project', () => {
    const b = resolveBooking(wo(999), maps({
      desks: new Map([[999, { subproject_id: 999, in4_name: 'Retired sub-project', cc_project_id: null, atm_head_id: null, note: null }]]),
    }))
    expect(b.subprojectName).toBe('Retired sub-project')
  })
})

describe('IN4 skill names against CT Hub disciplines', () => {
  it('drops the sort number IN4 prefixes, and nothing else', () => {
    expect(stripSkillNumber('12 Finishes')).toBe('Finishes')
    expect(stripSkillNumber('03 Civil')).toBe('Civil')
    expect(stripSkillNumber('01 Pre Design Works')).toBe('Pre Design Works')
    expect(stripSkillNumber('36 Infra Structures/Buildings')).toBe('Infra Structures/Buildings')
    // The typo is in both lists, so it must survive verbatim.
    expect(stripSkillNumber('28 Temporary Acess Road')).toBe('Temporary Acess Road')
    expect(stripSkillNumber('25 Delay In Drawings, Contractor Idle Charges'))
      .toBe('Delay In Drawings, Contractor Idle Charges')
  })

  // On the purchasing side IN4 writes the ledger between the number and the
  // name: "(M)" for material, "(A)" for asset, against the same skill list.
  it('drops the material/asset marker a purchase bill carries', () => {
    expect(stripSkillNumber('07 (M) Electrical Works')).toBe('Electrical Works')
    expect(stripSkillNumber('12 (M) Finishes')).toBe('Finishes')
    expect(stripSkillNumber('13 (A) Interiors')).toBe('Interiors')
    expect(stripSkillNumber('36 (M) Infra Structures/Buildings')).toBe('Infra Structures/Buildings')
  })

  it('leaves a name that has no sort number alone', () => {
    expect(stripSkillNumber('Consultant Cost And Site Admin')).toBe('Consultant Cost And Site Admin')
    expect(stripSkillNumber('Finishes')).toBe('Finishes')
  })

  // "53 OT'S" against "OT'S", "42 WTP, STP & ETP" against "WTP, STP & ETP" —
  // a digit inside the name is not the prefix.
  it('does not eat digits that belong to the name', () => {
    expect(stripSkillNumber('51 Raj Kruti')).toBe('Raj Kruti')
    expect(stripSkillNumber('CV - 5 Works')).toBe('CV - 5 Works')
  })
})
