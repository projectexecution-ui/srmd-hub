// Contractor + Supplier money for ONE project, pulled out of the uploaded
// report state and attributed through the sub-project matcher.
//
// Shape in the DB: reports[] → subprojects[] → categories[] → contractors[]
// (or suppliers[]). The report's own "projectName" is an IN4 GROUPING, never a
// project, so it is deliberately ignored — see subproject-match.ts.

import { createClient } from '@/lib/supabase/server'
import { matchSubProjects, clean, type HubProject } from './subproject-match'
import { PROJECT_ALIASES } from './alias-seed'
import { compareDisciplines } from '@/lib/cost-control/discipline-order'
import { descendantIds } from './hierarchy'

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

export interface BillRow {
  id: string
  invoiceNo: string
  vendor: string
  area: string
  amount: number
  billDate: string | null
  submittedOn: string | null
  /** Days since it was submitted to CT — the number that makes it chaseable. */
  ageDays: number
  section: string
}

export interface BillsSide {
  bills: BillRow[]
  total: number
  /** Bills in the report whose area matches no project in the hub at all. */
  unattributed: { count: number; amount: number }
  /** When the report was last generated. Everything here is only as fresh. */
  asOf: string | null
}

export interface ProjectReports {
  contractor: ReportSide
  supplier: ReportSide
  /** Bills sitting with CT for this project, from the daily bills report. */
  billsPipeline: BillsSide
  /** Money in the uploads that belongs to NO hub project — the holding list. */
  unattributed: { subProjects: number; bill: number }
  /** How many sub-projects were rolled up into these figures. 0 = a leaf.
   *  Shown on screen so a group's totals are never mistaken for its own. */
  rolledUpChildren: number
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
    // Same sequence as the Internal Estimate: by the category's own code
    // number — 01, 02, 03 … — NOT by value. The report categories carry that
    // code in their name (" 03 Civil", "03 (M) Civil"), which is exactly what
    // compareDisciplines reads, so the two screens list categories in the same
    // order and can be read side by side. Parties inside a category stay
    // biggest-first, since a contractor has no code to sequence by.
    .sort((a, b) => compareDisciplines(
      { code: a.category, display_order: null },
      { code: b.category, display_order: null },
    ))

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
  const [cRes, sRes, pRes, bRes] = await Promise.all([
    supabase.from('contractor_report_state').select('state').limit(1).maybeSingle(),
    supabase.from('supplier_report_state').select('state').limit(1).maybeSingle(),
    supabase.from('projects').select('id, code, name, parent_project_id').is('archived_at', null),
    supabase.from('app_settings').select('value').eq('key', 'bills_pipeline_report').maybeSingle(),
  ])

  const raw = (pRes.data ?? []) as Array<Record<string, unknown>>
  const projects = raw as unknown as HubProject[]

  // A GROUP shows its children's money too. IN4 uploads name the group
  // ("New Guest House"), the hub splits it into NGH A/B/C/Infra/Common — so
  // without this the group's cockpit reads as empty while its children hold
  // everything. Confirmed by Aksha: the group IS the project that contains them.
  const nodes = raw.map(p => ({
    id: p.id as string,
    parentId: (p.parent_project_id as string | null) ?? null,
  }))
  const covered = new Set(descendantIds(nodes, projectId))
  const rolledUpChildren = covered.size - 1
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
  const mine = new Set(
    matches.filter(m => m.projectId && covered.has(m.projectId)).map(m => m.subProjectName),
  )

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
    billsPipeline: readBills(bRes.data?.value, projects, covered),
    unattributed: { subProjects: unmatchedNames.size, bill: unattributedBill },
    rolledUpChildren,
  }
}

/**
 * Bills sitting with CT, from the daily bills report.
 *
 * The report names the building in its OWN shorthand — "NGH B", "VINAY
 * Building", "VV Common Expenses" — a third spelling on top of IN4's and the
 * hub's. Attribution is by that `area` through the same matcher and alias list,
 * NOT by the report's `projectCode`: the code "NGH" collides with the hub's
 * NGH Infra, so a code fallback would quietly file every NGH bill against Infra.
 * A bill whose area matches nothing is counted as unattributed rather than
 * guessed.
 */
function readBills(
  raw: unknown, projects: HubProject[], covered: Set<string>,
): BillsSide {
  let parsed: { asOf?: string; bills?: unknown } = {}
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : (raw as typeof parsed) ?? {}
  } catch { /* a malformed report must not take the tab down */ }

  const all = (Array.isArray(parsed.bills) ? parsed.bills : []) as Array<Record<string, unknown>>
  const areas = [...new Set(all.map(b => clean(String(b.area ?? ''))).filter(Boolean))]
  const areaMatch = new Map(
    matchSubProjects(areas, projects, PROJECT_ALIASES).map(m => [m.subProjectName, m.projectId]),
  )

  const today = Date.now()
  const bills: BillRow[] = []
  let unattributedCount = 0
  let unattributedAmount = 0

  for (const b of all) {
    const area = clean(String(b.area ?? ''))
    const projectId = areaMatch.get(area) ?? null
    const amount = num(b.amount)

    if (!projectId) { unattributedCount += 1; unattributedAmount += amount; continue }
    if (!covered.has(projectId)) continue

    const submittedOn = String(b.submittedOn ?? '') || null
    bills.push({
      id: String(b.id ?? ''),
      invoiceNo: clean(String(b.invoiceNo ?? '')),
      vendor: clean(String(b.vendor ?? '')),
      area,
      amount,
      billDate: String(b.billDate ?? '') || null,
      submittedOn,
      ageDays: submittedOn
        ? Math.max(0, Math.floor((today - new Date(submittedOn).getTime()) / 86_400_000))
        : 0,
      section: String(b.section ?? ''),
    })
  }

  // Oldest first — the ones that have been waiting longest are the ones to chase.
  bills.sort((a, b) => b.ageDays - a.ageDays)

  return {
    bills,
    total: bills.reduce((s, b) => s + b.amount, 0),
    unattributed: { count: unattributedCount, amount: unattributedAmount },
    asOf: (parsed.asOf as string) ?? null,
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
