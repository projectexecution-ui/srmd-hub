// Contractor + Supplier money for ONE project, pulled out of the uploaded
// report state and attributed through the sub-project matcher.
//
// Shape in the DB: reports[] → subprojects[] → categories[] → contractors[]
// (or suppliers[]). The report's own "projectName" is an IN4 GROUPING, never a
// project, so it is deliberately ignored — see subproject-match.ts.

import { createClient } from '@/lib/supabase/server'
import { matchSubProjects, clean, type HubProject } from './subproject-match'
import { PROJECT_ALIASES } from './alias-seed'

export interface PartyRow {
  party: string
  wo: number
  bill: number
  paid: number
  outstanding: number
  retention: number
}

export interface CategoryRow {
  category: string
  parties: PartyRow[]
  wo: number
  bill: number
  paid: number
}

export interface ReportSide {
  /** Sub-project names that were attributed to this project. */
  subProjects: string[]
  categories: CategoryRow[]
  wo: number
  bill: number
  paid: number
}

export interface ProjectReports {
  contractor: ReportSide
  supplier: ReportSide
  /** Money in the uploads that belongs to NO hub project — the holding list. */
  unattributed: { subProjects: number; bill: number }
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

interface RawParty { [k: string]: unknown }

function readSide(
  reports: unknown,
  mine: Set<string>,
  partyKey: 'contractors' | 'suppliers',
  partyName: 'contractor' | 'supplier',
): { side: ReportSide; otherBill: number; otherSubs: Set<string> } {
  const byCategory = new Map<string, Map<string, PartyRow>>()
  const subProjects = new Set<string>()
  const otherSubs = new Set<string>()
  let otherBill = 0

  for (const rep of (Array.isArray(reports) ? reports : []) as Array<Record<string, unknown>>) {
    for (const sp of (Array.isArray(rep.subprojects) ? rep.subprojects : []) as Array<Record<string, unknown>>) {
      const spName = clean(String(sp.name ?? ''))
      const isMine = mine.has(spName)
      if (isMine) subProjects.add(spName)

      for (const cat of (Array.isArray(sp.categories) ? sp.categories : []) as Array<Record<string, unknown>>) {
        const catName = clean(String(cat.category ?? '')) || '—'
        for (const p of (Array.isArray(cat[partyKey]) ? cat[partyKey] : []) as RawParty[]) {
          const bill = num(p.billValue)
          if (!isMine) {
            otherBill += bill
            if (spName) otherSubs.add(spName)
            continue
          }
          const name = clean(String(p[partyName] ?? '')) || '(unnamed)'
          let parties = byCategory.get(catName)
          if (!parties) { parties = new Map(); byCategory.set(catName, parties) }
          const row = parties.get(name) ?? { party: name, wo: 0, bill: 0, paid: 0, outstanding: 0, retention: 0 }
          row.wo += num(p.woValue)
          row.bill += bill
          row.paid += num(p.paidValue)
          row.outstanding += num(p.outstanding)
          row.retention += num(p.retentionHeld)
          parties.set(name, row)
        }
      }
    }
  }

  const categories: CategoryRow[] = [...byCategory.entries()]
    .map(([category, parties]) => {
      const list = [...parties.values()].sort((a, b) => b.bill - a.bill)
      return {
        category,
        parties: list,
        wo: list.reduce((s, p) => s + p.wo, 0),
        bill: list.reduce((s, p) => s + p.bill, 0),
        paid: list.reduce((s, p) => s + p.paid, 0),
      }
    })
    .sort((a, b) => b.bill - a.bill)

  return {
    side: {
      subProjects: [...subProjects].sort(),
      categories,
      wo: categories.reduce((s, c) => s + c.wo, 0),
      bill: categories.reduce((s, c) => s + c.bill, 0),
      paid: categories.reduce((s, c) => s + c.paid, 0),
    },
    otherBill,
    otherSubs,
  }
}

export async function loadProjectReports(projectId: string): Promise<ProjectReports> {
  const supabase = await createClient()
  const [cRes, sRes, pRes] = await Promise.all([
    supabase.from('contractor_report_state').select('state').limit(1).maybeSingle(),
    supabase.from('supplier_report_state').select('state').limit(1).maybeSingle(),
    supabase.from('projects').select('id, code, name').is('archived_at', null),
  ])

  const projects = (pRes.data ?? []) as HubProject[]
  const cReports = (cRes.data?.state as { reports?: unknown })?.reports
  const sReports = (sRes.data?.state as { reports?: unknown })?.reports

  // Collect every sub-project name across both reports, match once, then keep
  // only the ones belonging to THIS project.
  const names = new Set<string>()
  for (const reports of [cReports, sReports]) {
    for (const rep of (Array.isArray(reports) ? reports : []) as Array<Record<string, unknown>>) {
      for (const sp of (Array.isArray(rep.subprojects) ? rep.subprojects : []) as Array<Record<string, unknown>>) {
        const n = clean(String(sp.name ?? ''))
        if (n) names.add(n)
      }
    }
  }
  const matches = matchSubProjects([...names], projects, PROJECT_ALIASES)
  const mine = new Set(matches.filter(m => m.projectId === projectId).map(m => m.subProjectName))

  const c = readSide(cReports, mine, 'contractors', 'contractor')
  const s = readSide(sReports, mine, 'suppliers', 'supplier')

  // "Unattributed" = belongs to no hub project at all, not merely to another
  // one — otherwise every project would report the whole portfolio as missing.
  const unmatchedNames = new Set(matches.filter(m => !m.projectId).map(m => m.subProjectName))
  const unattributedBill = sumFor(cReports, unmatchedNames, 'contractors')
    + sumFor(sReports, unmatchedNames, 'suppliers')

  return {
    contractor: c.side,
    supplier: s.side,
    unattributed: { subProjects: unmatchedNames.size, bill: unattributedBill },
  }
}

function sumFor(reports: unknown, names: Set<string>, partyKey: 'contractors' | 'suppliers'): number {
  let total = 0
  for (const rep of (Array.isArray(reports) ? reports : []) as Array<Record<string, unknown>>) {
    for (const sp of (Array.isArray(rep.subprojects) ? rep.subprojects : []) as Array<Record<string, unknown>>) {
      if (!names.has(clean(String(sp.name ?? '')))) continue
      for (const cat of (Array.isArray(sp.categories) ? sp.categories : []) as Array<Record<string, unknown>>) {
        for (const p of (Array.isArray(cat[partyKey]) ? cat[partyKey] : []) as RawParty[]) {
          total += num(p.billValue)
        }
      }
    }
  }
  return total
}
