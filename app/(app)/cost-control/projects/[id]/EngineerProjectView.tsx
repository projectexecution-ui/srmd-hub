import { Fragment } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getMyUser } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { QueryError } from '@/components/ui/query-error'
import { formatINR } from '@/lib/utils'
import { isPendingStatus } from '@/lib/cost-control/chain'
import { TreeProvider, TreeToolbar, CatChevron, CatRows, SubRow } from '@/components/cost-control/project-tree'

// Engineer-safe project table. Deliberately a SEPARATE component from the
// management Internal Estimate page so a confidential figure can't leak: it
// never fetches or renders the Internal Estimate ([IB…]) baseline, the Paid
// column, or % Used. Engineers see the SAME category → sub-skill layout as
// management, with: Awaiting Approval, Budget (ERP), WO/PO, Working Sheets.
type ProjectLite = { id: string; code: string; name: string; built_up_sft: number | null }
type DRow = { id: string; code: string; name: string; display_order: number }
type SRow = { id: string; discipline_id: string; code: string; name: string }

export async function EngineerProjectTable({ projectId }: { projectId: string }) {
  const supabase = await createClient()
  const user = await getMyUser()

  const [pdRes, psRes, blRes, wsRes, ssaRes] = await Promise.all([
    supabase
      .from('cc_project_disciplines')
      .select('discipline_id, cc_disciplines(id, code, name, display_order)')
      .eq('project_id', projectId)
      .eq('is_enabled', true),
    supabase
      .from('cc_project_sub_skills')
      .select('sub_skill_id, cc_sub_skills(id, discipline_id, code, name)')
      .eq('project_id', projectId)
      .eq('is_enabled', true),
    // Budget + WO only — Paid (and % Used) are hidden from engineers, so Paid
    // is not even fetched over the wire.
    supabase
      .from('cc_budget_lines')
      .select('discipline_id, sub_skill_id, current_budget_amt, current_wo_committed_amt')
      .eq('project_id', projectId),
    // Working sheets for Awaiting-Approval + sheet counts. summary_notes lets
    // us drop the [IB] Internal Estimate baseline; chain fields let us count
    // each revision chain once; engineer_id scopes to the viewer's sheets.
    supabase
      .from('cc_ws_with_versions')
      .select('discipline_id, sub_skill_id, engineer_id, status, total_amount, approved_for_erp_amt, chain_anchor_id, version_no, summary_notes')
      .eq('project_id', projectId)
      .is('archived_at', null),
    // Sub-skills assigned to the viewer here — those sheets are visible too.
    user
      ? supabase
          .from('cc_subskill_assignments')
          .select('sub_skill_id')
          .eq('project_id', projectId)
          .eq('engineer_id', user.id)
      : Promise.resolve({ data: [] as Array<{ sub_skill_id: string }>, error: null }),
  ])
  const myAssignedSubs = new Set(((ssaRes.data ?? []) as Array<{ sub_skill_id: string }>).map(r => r.sub_skill_id))

  const disciplines: DRow[] = ((pdRes.data ?? []) as Array<{ cc_disciplines: DRow | DRow[] | null }>)
    .map(r => (Array.isArray(r.cc_disciplines) ? r.cc_disciplines[0] : r.cc_disciplines))
    .filter((d): d is DRow => !!d)
    .sort((a, b) => a.display_order - b.display_order)

  const subSkills: SRow[] = ((psRes.data ?? []) as Array<{ cc_sub_skills: SRow | SRow[] | null }>)
    .map(r => (Array.isArray(r.cc_sub_skills) ? r.cc_sub_skills[0] : r.cc_sub_skills))
    .filter((s): s is SRow => !!s)
    .sort((a, b) => a.code.localeCompare(b.code))

  // Budget (ERP) + WO per (discipline, sub-skill); root line = sub_skill_id null.
  type BL = { discipline_id: string; sub_skill_id: string | null; current_budget_amt: number | null; current_wo_committed_amt: number | null }
  const blMap = new Map<string, { budget: number; wo: number }>()
  for (const b of (blRes.data ?? []) as BL[]) {
    const k = `${b.discipline_id}::${b.sub_skill_id ?? '_root'}`
    const cur = blMap.get(k) ?? { budget: 0, wo: 0 }
    cur.budget += Number(b.current_budget_amt ?? 0)
    cur.wo += Number(b.current_wo_committed_amt ?? 0)
    blMap.set(k, cur)
  }

  // Awaiting-approval + sheet count per (discipline, sub-skill): only sheets
  // the viewer may see (their own, or in a sub-skill assigned to them) —
  // never the [IB] baseline — collapsed to each chain's latest version.
  type WSV = { discipline_id: string; sub_skill_id: string; engineer_id: string | null; status: string; total_amount: number | null; approved_for_erp_amt: number | null; chain_anchor_id: string; version_no: number | null; summary_notes: string | null }
  const latestByChain = new Map<string, WSV>()
  for (const w of (wsRes.data ?? []) as WSV[]) {
    if ((w.summary_notes ?? '').startsWith('[IB')) continue   // never expose the Internal Estimate baseline
    if (w.status === 'cancelled') continue
    if (w.engineer_id !== user?.id && !myAssignedSubs.has(w.sub_skill_id)) continue // not mine, not assigned to me
    const prev = latestByChain.get(w.chain_anchor_id)
    if (!prev || (w.version_no ?? 1) > (prev.version_no ?? 1)) latestByChain.set(w.chain_anchor_id, w)
  }
  const wsAgg = new Map<string, { pending: number; chains: number }>()
  for (const w of latestByChain.values()) {
    const k = `${w.discipline_id}::${w.sub_skill_id}`
    const cur = wsAgg.get(k) ?? { pending: 0, chains: 0 }
    cur.chains += 1
    if (isPendingStatus(w.status)) cur.pending += Math.max(Number(w.total_amount ?? 0) - Number(w.approved_for_erp_amt ?? 0), 0)
    wsAgg.set(k, cur)
  }

  const subsByDisc = new Map<string, SRow[]>()
  for (const s of subSkills) {
    const arr = subsByDisc.get(s.discipline_id) ?? []
    arr.push(s)
    subsByDisc.set(s.discipline_id, arr)
  }
  const discTotal = (dId: string) => {
    const subs = subsByDisc.get(dId) ?? []
    let budget = 0, wo = 0, pending = 0, hasSub = false
    for (const s of subs) {
      const bl = blMap.get(`${dId}::${s.id}`)
      if (bl && (bl.budget || bl.wo)) hasSub = true
      budget += bl?.budget ?? 0; wo += bl?.wo ?? 0
      pending += wsAgg.get(`${dId}::${s.id}`)?.pending ?? 0
    }
    if (!hasSub) {
      const root = blMap.get(`${dId}::_root`)
      if (root) { budget += root.budget; wo += root.wo }
    }
    return { budget, wo, pending }
  }
  let totBudget = 0, totWO = 0, totPending = 0
  for (const d of disciplines) { const t = discTotal(d.id); totBudget += t.budget; totWO += t.wo; totPending += t.pending }

  // A sub-skill is "empty" for the engineer only if there's nothing to act on:
  // no sheet, no ERP, no pending money — AND it isn't assigned to them (an
  // assigned sub-skill always shows so they can raise its first sheet).
  const isSubEmpty = (dId: string, s: SRow) => {
    const bl = blMap.get(`${dId}::${s.id}`)
    const ag = wsAgg.get(`${dId}::${s.id}`)
    return (ag?.chains ?? 0) === 0 && (ag?.pending ?? 0) === 0
      && (bl?.budget ?? 0) === 0 && (bl?.wo ?? 0) === 0
      && !myAssignedSubs.has(s.id)
  }
  let emptyCount = 0
  for (const d of disciplines) for (const s of (subsByDisc.get(d.id) ?? [])) if (isSubEmpty(d.id, s)) emptyCount++

  const errored = pdRes.error || psRes.error || blRes.error || wsRes.error

  return (
    <div className="space-y-4">
      {errored && <QueryError message={(pdRes.error ?? psRes.error ?? blRes.error ?? wsRes.error)?.message} what="this project's budget" />}

      {/* KPI strip — no Internal Estimate, no Paid. */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <KPI label="Awaiting Approval" value={totPending > 0 ? formatINR(totPending) : '—'} tone="amber" />
        <KPI label="Budget (ERP)" value={totBudget > 0 ? formatINR(totBudget) : '—'} tone="blue" />
        <KPI label="Committed (WO / PO)" value={totWO > 0 ? formatINR(totWO) : '—'} tone="purple" />
      </div>

      <TreeProvider allCatIds={disciplines.map(d => d.id)} emptyCount={emptyCount}>
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        {disciplines.length > 0 && (
          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 bg-gray-50/60">
            <span className="text-[11px] font-medium text-gray-500">Your work by category — click a row to collapse.</span>
            <TreeToolbar />
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-3 py-2 font-semibold text-gray-600 min-w-[260px]">Work Category / Sub-skill</th>
                <th className="px-3 py-2 font-semibold text-gray-600 text-right w-32">Awaiting Approval</th>
                <th className="px-3 py-2 font-semibold text-gray-600 text-right w-32">Budget (ERP)</th>
                <th className="px-3 py-2 font-semibold text-gray-600 text-right w-28">WO / PO</th>
                <th className="px-3 py-2 font-semibold text-gray-600 w-28">Working Sheets</th>
              </tr>
            </thead>
            <tbody>
              {disciplines.map(d => {
                const dt = discTotal(d.id)
                const subs = subsByDisc.get(d.id) ?? []
                return (
                  <Fragment key={d.id}>
                    <tr className="bg-gray-50/60 border-t border-gray-200">
                      <td className="px-3 py-2 font-semibold text-gray-800">
                        <CatChevron catId={d.id} />
                        <span className="font-mono text-[11px] text-gray-400 mr-2">{d.code}</span>{d.name}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-amber-700">{dt.pending > 0 ? formatINR(dt.pending) : '—'}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">{dt.budget > 0 ? formatINR(dt.budget) : '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-600">{dt.wo > 0 ? formatINR(dt.wo) : '—'}</td>
                      <td className="px-3 py-2"></td>
                    </tr>
                    <CatRows catId={d.id}>
                    {subs.map(s => {
                      const bl = blMap.get(`${d.id}::${s.id}`)
                      const ag = wsAgg.get(`${d.id}::${s.id}`)
                      const chains = ag?.chains ?? 0
                      return (
                        <SubRow key={s.id} empty={isSubEmpty(d.id, s)}>
                        <tr className="border-t border-gray-100 hover:bg-gray-50/60">
                          <td className="pl-9 pr-3 py-2 text-gray-700">
                            <span className="font-mono text-[11px] text-gray-400 mr-2">{s.code}</span>{s.name}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-amber-700">{ag?.pending ? formatINR(ag.pending) : '—'}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{bl?.budget ? formatINR(bl.budget) : '—'}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-gray-600">{bl?.wo ? formatINR(bl.wo) : '—'}</td>
                          <td className="px-3 py-2">
                            {chains > 0 ? (
                              <Link
                                href={`/cost-control/working-sheets?project=${projectId}&discipline=${d.id}&sub_skill=${s.id}`}
                                className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100"
                              >
                                {chains} sheet{chains === 1 ? '' : 's'}
                              </Link>
                            ) : (
                              <Link
                                href={`/cost-control/working-sheets/new-quick?project=${projectId}&discipline=${d.id}&sub_skill=${s.id}`}
                                className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100"
                              >
                                + Add
                              </Link>
                            )}
                          </td>
                        </tr>
                        </SubRow>
                      )
                    })}
                    </CatRows>
                  </Fragment>
                )
              })}
              {disciplines.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-gray-400">
                  No disciplines set up on this project yet.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      </TreeProvider>
    </div>
  )
}

// Page wrapper for the engineer project-detail route (/cost-control/projects/[id]).
export async function EngineerProjectView({ project }: { project: ProjectLite }) {
  const sft = Number(project.built_up_sft ?? 0)
  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center gap-2 text-xs">
        <Link href="/cost-control" className="text-blue-600 hover:underline">← Cost Control</Link>
      </div>
      <PageHeader
        title={project.name}
        subtitle={`${project.code}${sft > 0 ? ` · ${sft.toLocaleString('en-IN')} sft` : ''}`}
        className="mb-0"
      />
      <EngineerProjectTable projectId={project.id} />
    </div>
  )
}

function KPI({ label, value, tone }: { label: string; value: string; tone: 'blue' | 'purple' | 'amber' }) {
  const tones: Record<string, string> = {
    blue: 'border-blue-200 bg-blue-50 text-blue-900',
    purple: 'border-purple-200 bg-purple-50 text-purple-900',
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
  }
  return (
    <div className={`rounded-xl border p-4 ${tones[tone]}`}>
      <p className="text-xs uppercase tracking-wide opacity-70">{label}</p>
      <p className="text-lg font-bold tabular-nums mt-0.5">{value}</p>
    </div>
  )
}
