// Groups the Cost Control budget approvals that are ALREADY waiting on a user
// (the my_approval_inbox RPC did that filtering) into project → sub-discipline,
// and attaches the "approved so far → after" money via the same rollup the
// project / approvals pages use. Powers the home "Needs you now" widget so it
// reads exactly like My Approvals. No Internal Estimate — only approved amounts.

import type { SupabaseClient } from '@supabase/supabase-js'
import { computeMoneyRollup, type RollupWSRow, type RollupVersionRow } from './project-rollup'

interface SheetRow extends RollupWSRow, RollupVersionRow { project_id: string }

interface JoinRow { code: string | null; name: string | null }
interface SheetJoined {
  id: string
  ws_code: string | null
  project_id: string | null
  discipline_id: string | null
  sub_skill_id: string | null
  total_amount: number | null
  approved_for_erp_amt: number | null
  projects: JoinRow | JoinRow[] | null
  cc_disciplines: JoinRow | JoinRow[] | null
  cc_sub_skills: JoinRow | JoinRow[] | null
}

export interface HomeBudgetItem {
  id: string
  wsCode: string | null
  subName: string | null
  amount: number
  docUrl: string
  createdAt: string
  urgency: string | null
}
export interface HomeBudgetDiscipline {
  disciplineId: string
  name: string | null
  before: number
  after: number
  items: HomeBudgetItem[]
}
export interface HomeBudgetProject {
  projectId: string
  code: string | null
  name: string | null
  before: number
  after: number
  increment: number
  count: number
  disciplines: HomeBudgetDiscipline[]
}

/** The bits of an inbox item this needs — the caller maps them from InboxItem. */
export interface InboxBudgetRef {
  docId: string
  docUrl: string
  urgency: string | null
  createdAt: string
}

function pickJoin(v: JoinRow | JoinRow[] | null): JoinRow | null {
  if (!v) return null
  return Array.isArray(v) ? v[0] ?? null : v
}

export async function getHomeBudgetGroups(
  supabase: SupabaseClient,
  refs: InboxBudgetRef[],
): Promise<HomeBudgetProject[]> {
  const ids = refs.map(r => r.docId).filter(Boolean)
  if (ids.length === 0) return []

  // The pending sheets themselves — for names, project/discipline/sub, and the
  // ask vs already-released (so we know what this sign-off actually adds).
  const { data: sheetsData } = await supabase
    .from('cc_ws_with_versions')
    .select('id, ws_code, project_id, discipline_id, sub_skill_id, total_amount, approved_for_erp_amt, projects(code, name), cc_disciplines(code, name), cc_sub_skills(code, name)')
    .in('id', ids)
  const sheets = (sheetsData ?? []) as unknown as SheetJoined[]
  const byId = new Map<string, SheetJoined>()
  for (const s of sheets) byId.set(s.id, s)

  const projectIds = [...new Set(sheets.map(s => s.project_id).filter((p): p is string => !!p))]
  if (projectIds.length === 0) return []

  // "Before" — approved so far per project and per (project, discipline), via
  // the same rollup as the project page.
  const { data: allSheets } = await supabase
    .from('cc_ws_with_versions')
    .select('id, project_id, discipline_id, sub_skill_id, status, total_amount, approved_for_erp_amt, summary_notes, entry_mode, chain_anchor_id, version_no')
    .in('project_id', projectIds)

  const approvedByProject = new Map<string, number>()
  const approvedByDisc = new Map<string, number>()
  {
    const byProj = new Map<string, SheetRow[]>()
    for (const s of (allSheets ?? []) as SheetRow[]) {
      const a = byProj.get(s.project_id)
      if (a) a.push(s); else byProj.set(s.project_id, [s])
    }
    for (const [pid, arr] of byProj) {
      const roll = computeMoneyRollup({ wsRows: arr, versionRows: arr, budgetLines: [], subSkills: [], disciplines: [] })
      let total = 0
      for (const [key, agg] of roll.wsAgg) {
        const disc = key.slice(0, key.indexOf('::'))
        approvedByDisc.set(`${pid}::${disc}`, (approvedByDisc.get(`${pid}::${disc}`) ?? 0) + agg.approvedTotal)
        total += agg.approvedTotal
      }
      approvedByProject.set(pid, total)
    }
  }

  const increment = (s: SheetJoined) =>
    Math.max(0, Number(s.total_amount ?? 0) - Number(s.approved_for_erp_amt ?? 0))

  // Group the waiting items by project → discipline, in the inbox's order.
  const projMap = new Map<string, HomeBudgetProject>()
  const order: string[] = []
  for (const ref of refs) {
    const s = byId.get(ref.docId)
    if (!s || !s.project_id) continue
    const pid = s.project_id
    let proj = projMap.get(pid)
    if (!proj) {
      const p = pickJoin(s.projects)
      const before = approvedByProject.get(pid) ?? 0
      proj = { projectId: pid, code: p?.code ?? null, name: p?.name ?? null, before, after: before, increment: 0, count: 0, disciplines: [] }
      projMap.set(pid, proj); order.push(pid)
    }
    const did = s.discipline_id ?? '_none'
    let disc = proj.disciplines.find(d => d.disciplineId === did)
    if (!disc) {
      const d = pickJoin(s.cc_disciplines)
      const dBefore = approvedByDisc.get(`${pid}::${s.discipline_id}`) ?? 0
      disc = { disciplineId: did, name: d?.name ?? null, before: dBefore, after: dBefore, items: [] }
      proj.disciplines.push(disc)
    }
    const inc = increment(s)
    const sub = pickJoin(s.cc_sub_skills)
    disc.items.push({
      id: s.id,
      wsCode: s.ws_code ?? null,
      subName: sub?.name ?? null,
      amount: Number(s.total_amount ?? 0),
      docUrl: ref.docUrl,
      createdAt: ref.createdAt,
      urgency: ref.urgency,
    })
    disc.after += inc
    proj.after += inc
    proj.increment += inc
    proj.count += 1
  }

  // Biggest add first.
  return order.map(pid => projMap.get(pid)!).sort((a, b) => b.increment - a.increment)
}
