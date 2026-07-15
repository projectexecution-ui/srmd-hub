import { Fragment } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getMyUser } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { QueryError } from '@/components/ui/query-error'
import { formatINR } from '@/lib/utils'
import { FileText, ArrowRight, Info } from 'lucide-react'

// Engineer-safe project view. Deliberately a SEPARATE component from the
// management Internal Estimate page: it never fetches or renders the
// Internal Estimate ([IB…]) baseline, so there is no way a confidential
// figure can leak here. Engineers see the project's ERP budget (Budget /
// WO-PO committed / Paid) plus their OWN working sheets — nothing more.
type ProjectLite = { id: string; code: string; name: string; built_up_sft: number | null }
type DRow = { id: string; code: string; name: string; display_order: number }
type SRow = { id: string; discipline_id: string; code: string; name: string }

export async function EngineerProjectView({ project }: { project: ProjectLite }) {
  const supabase = await createClient()
  const user = await getMyUser()

  const [pdRes, psRes, blRes, mineRes] = await Promise.all([
    supabase
      .from('cc_project_disciplines')
      .select('discipline_id, cc_disciplines(id, code, name, display_order)')
      .eq('project_id', project.id)
      .eq('is_enabled', true),
    supabase
      .from('cc_project_sub_skills')
      .select('sub_skill_id, cc_sub_skills(id, discipline_id, code, name)')
      .eq('project_id', project.id)
      .eq('is_enabled', true),
    // ERP budget ONLY — internal_estimate_amt is never selected here.
    supabase
      .from('cc_budget_lines')
      .select('discipline_id, sub_skill_id, current_budget_amt, current_wo_committed_amt, current_paid_amt')
      .eq('project_id', project.id),
    user
      ? supabase
          .from('cc_working_sheets')
          .select('discipline_id, sub_skill_id, status')
          .eq('project_id', project.id)
          .eq('engineer_id', user.id)
          .is('archived_at', null)
          .neq('status', 'cancelled')
      : Promise.resolve({ data: [] as Array<{ discipline_id: string; sub_skill_id: string; status: string }>, error: null }),
  ])

  const disciplines: DRow[] = ((pdRes.data ?? []) as Array<{ cc_disciplines: DRow | DRow[] | null }>)
    .map(r => (Array.isArray(r.cc_disciplines) ? r.cc_disciplines[0] : r.cc_disciplines))
    .filter((d): d is DRow => !!d)
    .sort((a, b) => a.display_order - b.display_order)

  const subSkills: SRow[] = ((psRes.data ?? []) as Array<{ cc_sub_skills: SRow | SRow[] | null }>)
    .map(r => (Array.isArray(r.cc_sub_skills) ? r.cc_sub_skills[0] : r.cc_sub_skills))
    .filter((s): s is SRow => !!s)
    .sort((a, b) => a.code.localeCompare(b.code))

  // ERP budget per (discipline, sub-skill); root line = sub_skill_id null.
  type BL = { discipline_id: string; sub_skill_id: string | null; current_budget_amt: number | null; current_wo_committed_amt: number | null; current_paid_amt: number | null }
  const blMap = new Map<string, { budget: number; wo: number; paid: number }>()
  for (const b of (blRes.data ?? []) as BL[]) {
    const k = `${b.discipline_id}::${b.sub_skill_id ?? '_root'}`
    const cur = blMap.get(k) ?? { budget: 0, wo: 0, paid: 0 }
    cur.budget += Number(b.current_budget_amt ?? 0)
    cur.wo += Number(b.current_wo_committed_amt ?? 0)
    cur.paid += Number(b.current_paid_amt ?? 0)
    blMap.set(k, cur)
  }

  // My own sheet count per (discipline, sub-skill).
  const mineCount = new Map<string, number>()
  for (const w of (mineRes.data ?? []) as Array<{ discipline_id: string; sub_skill_id: string }>) {
    const k = `${w.discipline_id}::${w.sub_skill_id}`
    mineCount.set(k, (mineCount.get(k) ?? 0) + 1)
  }

  // Discipline + project rollups. Same rule as the management page: if a
  // discipline has any sub-skill budget line, use those and ignore its root
  // summary line (else the summary double-counts its own detail rows).
  const subsByDisc = new Map<string, SRow[]>()
  for (const s of subSkills) {
    const arr = subsByDisc.get(s.discipline_id) ?? []
    arr.push(s)
    subsByDisc.set(s.discipline_id, arr)
  }
  const discTotal = (dId: string) => {
    const subs = subsByDisc.get(dId) ?? []
    let budget = 0, wo = 0, paid = 0, hasSub = false
    for (const s of subs) {
      const bl = blMap.get(`${dId}::${s.id}`)
      if (bl && (bl.budget || bl.wo || bl.paid)) hasSub = true
      budget += bl?.budget ?? 0; wo += bl?.wo ?? 0; paid += bl?.paid ?? 0
    }
    if (!hasSub) {
      const root = blMap.get(`${dId}::_root`)
      if (root) { budget += root.budget; wo += root.wo; paid += root.paid }
    }
    return { budget, wo, paid }
  }
  let totBudget = 0, totWO = 0, totPaid = 0
  for (const d of disciplines) { const t = discTotal(d.id); totBudget += t.budget; totWO += t.wo; totPaid += t.paid }
  const myTotal = (mineRes.data ?? []).length

  const sft = Number(project.built_up_sft ?? 0)
  const errored = pdRes.error || psRes.error || blRes.error

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center gap-2 text-xs">
        <Link href="/cost-control/working-sheets" className="text-blue-600 hover:underline">← My Working Sheets</Link>
      </div>
      <PageHeader
        title={project.name}
        subtitle={`${project.code}${sft > 0 ? ` · ${sft.toLocaleString('en-IN')} sft` : ''}`}
        className="mb-0"
      />

      <div className="rounded-lg border border-indigo-100 bg-indigo-50/50 px-3 py-2 text-xs text-indigo-900 flex items-center gap-2">
        <Info className="h-3.5 w-3.5 flex-shrink-0" />
        Project budget (from ERP) and your own working sheets. The Internal Estimate is management-only and is not shown here.
      </div>

      {errored && <QueryError message={(pdRes.error ?? psRes.error ?? blRes.error)?.message} what="this project's budget" />}

      {/* ERP KPI strip — no Internal Estimate. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI label="Budget (ERP)" value={totBudget > 0 ? formatINR(totBudget) : '—'} tone="blue" />
        <KPI label="Committed (WO / PO)" value={totWO > 0 ? formatINR(totWO) : '—'} tone="purple" />
        <KPI label="Paid to Date" value={totPaid > 0 ? formatINR(totPaid) : '—'} tone="orange" />
        <KPI label="My sheets here" value={String(myTotal)} tone="indigo" />
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-3 py-2 font-semibold text-gray-600 min-w-[260px]">Work Category / Sub-skill</th>
                <th className="px-3 py-2 font-semibold text-gray-600 text-right">Budget (ERP)</th>
                <th className="px-3 py-2 font-semibold text-gray-600 text-right">WO / PO</th>
                <th className="px-3 py-2 font-semibold text-gray-600 text-right">Paid</th>
                <th className="px-3 py-2 font-semibold text-gray-600 w-28">My Sheets</th>
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
                        <span className="font-mono text-[11px] text-gray-400 mr-2">{d.code}</span>{d.name}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">{dt.budget > 0 ? formatINR(dt.budget) : '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-600">{dt.wo > 0 ? formatINR(dt.wo) : '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-600">{dt.paid > 0 ? formatINR(dt.paid) : '—'}</td>
                      <td className="px-3 py-2"></td>
                    </tr>
                    {subs.map(s => {
                      const bl = blMap.get(`${d.id}::${s.id}`)
                      const mc = mineCount.get(`${d.id}::${s.id}`) ?? 0
                      return (
                        <tr key={s.id} className="border-t border-gray-100 hover:bg-gray-50/60">
                          <td className="pl-9 pr-3 py-2 text-gray-700">
                            <span className="font-mono text-[11px] text-gray-400 mr-2">{s.code}</span>{s.name}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{bl?.budget ? formatINR(bl.budget) : '—'}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-gray-600">{bl?.wo ? formatINR(bl.wo) : '—'}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-gray-600">{bl?.paid ? formatINR(bl.paid) : '—'}</td>
                          <td className="px-3 py-2">
                            <Link
                              href={`/cost-control/working-sheets/new?project=${project.id}&discipline=${d.id}&sub_skill=${s.id}`}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100"
                            >
                              {mc > 0 ? `${mc} mine` : '+ Add'} <ArrowRight className="h-3 w-3" />
                            </Link>
                          </td>
                        </tr>
                      )
                    })}
                  </Fragment>
                )
              })}
              {disciplines.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-gray-400">
                  <FileText className="h-8 w-8 mx-auto mb-2 opacity-40" />
                  No disciplines set up on this project yet.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function KPI({ label, value, tone }: { label: string; value: string; tone: 'blue' | 'purple' | 'orange' | 'indigo' }) {
  const tones: Record<string, string> = {
    blue: 'border-blue-200 bg-blue-50 text-blue-900',
    purple: 'border-purple-200 bg-purple-50 text-purple-900',
    orange: 'border-orange-200 bg-orange-50 text-orange-900',
    indigo: 'border-indigo-200 bg-indigo-50 text-indigo-900',
  }
  return (
    <div className={`rounded-xl border p-4 ${tones[tone]}`}>
      <p className="text-xs uppercase tracking-wide opacity-70">{label}</p>
      <p className="text-lg font-bold tabular-nums mt-0.5">{value}</p>
    </div>
  )
}
