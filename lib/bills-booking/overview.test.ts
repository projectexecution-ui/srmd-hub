import { describe, it, expect } from 'vitest'
import { rollUpProjects, type CertRow, type ProjectRow } from './overview'

const NOW = new Date('2026-09-13T00:00:00Z').getTime()
const projects: ProjectRow[] = [{ id: 12, name: 'New Guest House' }, { id: 5, name: 'Staff Facilities Block' }]

const cert = (over: Partial<CertRow>): CertRow => ({
  certificate_id: 1, kind: 'wo', display_no: 'ENP/X/1', project_id: 12, wo_id: 100, wo_no: 'WO/X/1',
  status_name: 'Approved', outstanding_amt: 1000, creation_dt: '2026-09-11', ...over,
})

describe('bills overview roll-up', () => {
  it('groups by project, counts distinct work orders, and sorts by money', () => {
    const { rows, totals } = rollUpProjects([
      cert({ certificate_id: 1, project_id: 12, wo_id: 100, outstanding_amt: 500 }),
      cert({ certificate_id: 2, project_id: 12, wo_id: 100, outstanding_amt: 700 }),  // same WO
      cert({ certificate_id: 3, project_id: 12, wo_id: 101, outstanding_amt: 300 }),
      cert({ certificate_id: 4, project_id: 5, wo_id: 200, outstanding_amt: 9000 }),
    ], projects, NOW)

    expect(rows.map(r => r.project)).toEqual(['Staff Facilities Block', 'New Guest House'])
    const ngh = rows.find(r => r.projectId === 12)!
    expect(ngh.bills).toBe(3)
    expect(ngh.wos).toBe(2)            // 100 counted once
    expect(ngh.outstanding).toBe(1500)
    expect(totals.outstanding).toBe(10500)
    expect(totals.wos).toBe(3)
  })

  it('drops cancelled and reversed, which carry a balance in IN4 but are not owed', () => {
    const { totals } = rollUpProjects([
      cert({ certificate_id: 1, outstanding_amt: 1000, status_name: 'Approved' }),
      cert({ certificate_id: 2, outstanding_amt: 5000, status_name: 'Cancelled' }),
      cert({ certificate_id: 3, outstanding_amt: 2000, status_name: 'reversed' }),   // case-insensitive
    ], projects, NOW)
    expect(totals.outstanding).toBe(1000)
    expect(totals.bills).toBe(1)
  })

  it('counts rows whose status has not synced yet, and says statuses are missing', () => {
    const a = rollUpProjects([cert({ status_name: null, outstanding_amt: 400 })], projects, NOW)
    expect(a.totals.outstanding).toBe(400)
    expect(a.asOf).toBeNull()

    const b = rollUpProjects([cert({ status_name: 'Approved', outstanding_amt: 400 })], projects, NOW)
    expect(b.asOf).not.toBeNull()
  })

  it('ignores rows with no balance', () => {
    const { rows } = rollUpProjects([
      cert({ outstanding_amt: 0 }), cert({ certificate_id: 2, outstanding_amt: null }),
    ], projects, NOW)
    expect(rows).toEqual([])
  })

  it('ages from the day the bill was raised, and keeps the oldest per project', () => {
    const { rows, totals } = rollUpProjects([
      cert({ certificate_id: 1, creation_dt: '2026-09-11' }),   // 2 days
      cert({ certificate_id: 2, creation_dt: '2023-05-29' }),   // ~1203 days
    ], projects, NOW)
    expect(rows[0].oldest).toBe(1203)
    expect(totals.oldest).toBe(1203)
  })

  it('does not lose a certificate whose project is unknown to the mirror', () => {
    const { rows } = rollUpProjects([cert({ project_id: 999, outstanding_amt: 50 })], projects, NOW)
    expect(rows[0].project).toBe('Project 999')
    expect(rows[0].outstanding).toBe(50)
  })
})
