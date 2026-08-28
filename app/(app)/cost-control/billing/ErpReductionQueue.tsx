// "Money still sitting in IN4" — the list the ERP person works from.
//
// A closed sub-category leaves its unspent budget in IN4 until somebody takes
// it out by hand. The tick that records it lives on each project screen, but
// nobody is going to open 42 projects looking for them, so the same rows are
// gathered here next to the IN4 entry queue — the one place this person
// already works.
//
// Read through cc_erp_reduction_queue(), which is gated to the same two roles
// as this page, so it works for a Coordinator who has no project membership.

import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { QueryError } from '@/components/ui/query-error'
import { ErpReducedControl } from '@/app/(app)/cost-control/projects/[id]/ErpReducedControl'
import { createClient } from '@/lib/supabase/server'
import { formatINR, formatDate } from '@/lib/utils'
import { Landmark } from 'lucide-react'

interface QueueRow {
  project_id: string
  project_code: string
  project_name: string
  discipline_id: string
  disc_code: string
  disc_name: string
  sub_skill_id: string
  sub_code: string
  sub_name: string
  completed_at: string
  savings: number
}

export async function ErpReductionQueue() {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('cc_erp_reduction_queue')
  const rows = (data ?? []) as QueueRow[]

  if (error) {
    return <QueryError message={error.message} what="the ERP budget-reduction queue" />
  }
  // Nothing outstanding is a good state, not an error — say so in one line
  // rather than showing an empty table.
  if (rows.length === 0) {
    return (
      <Card className="p-4">
        <p className="text-sm font-semibold text-gray-900 inline-flex items-center gap-2">
          <Landmark className="h-4 w-4 text-teal-600" /> ERP budget reductions
        </p>
        <p className="text-xs text-gray-500 mt-1">
          Nothing outstanding — every closed sub-category has had its leftover budget removed from IN4.
        </p>
      </Card>
    )
  }

  const total = rows.reduce((s, r) => s + Number(r.savings ?? 0), 0)

  return (
    <Card className="overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100">
        <p className="text-sm font-bold text-gray-900 inline-flex items-center gap-2">
          <Landmark className="h-4 w-4 text-amber-600" /> Budget to remove from IN4
        </p>
        <p className="text-xs text-gray-500 mt-0.5">
          {rows.length} closed sub-categor{rows.length === 1 ? 'y' : 'ies'} · <b className="text-amber-800">{formatINR(total)}</b> of
          unspent budget is still in the ERP. Take it out there, then tick it here.
        </p>
      </div>

      {/* Desktop */}
      <div className="overflow-x-auto hidden md:block">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-2 font-semibold">Project</th>
              <th className="px-4 py-2 font-semibold">Category · Sub-category</th>
              <th className="px-4 py-2 font-semibold text-right">To remove</th>
              <th className="px-4 py-2 font-semibold">Closed on</th>
              <th className="px-4 py-2 font-semibold text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={`${r.project_id}-${r.sub_skill_id}`} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-2.5">
                  <Link href={`/cost-control/projects/${r.project_id}`} className="font-semibold text-blue-700 hover:underline">
                    {r.project_code}
                  </Link>
                </td>
                <td className="px-4 py-2.5 text-gray-700">
                  <span className="text-gray-500">{r.disc_code} {r.disc_name}</span>
                  <span className="mx-1.5 text-gray-300">›</span>
                  {r.sub_code} {r.sub_name}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums font-bold text-amber-800">
                  {formatINR(Number(r.savings))}
                </td>
                <td className="px-4 py-2.5 text-xs text-gray-500">{formatDate(r.completed_at)}</td>
                <td className="px-4 py-2.5 text-right">
                  <ErpReducedControl
                    projectId={r.project_id}
                    disciplineId={r.discipline_id}
                    subSkillId={r.sub_skill_id}
                    label={`${r.sub_code} ${r.sub_name}`}
                    savings={Number(r.savings)}
                    reducedAt={null}
                    reducedAmt={null}
                    reducedByName={null}
                    canTick
                    variant="row"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phone — five columns will not survive 375px, so each row is a card. */}
      <div className="md:hidden divide-y divide-gray-100">
        {rows.map(r => (
          <div key={`${r.project_id}-${r.sub_skill_id}`} className="px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <Link href={`/cost-control/projects/${r.project_id}`} className="text-[13px] font-semibold text-blue-700">
                {r.project_code}
              </Link>
              <span className="text-[13px] font-bold tabular-nums text-amber-800 flex-shrink-0">
                {formatINR(Number(r.savings))}
              </span>
            </div>
            <p className="text-[12px] text-gray-700 mt-0.5">
              <span className="text-gray-500">{r.disc_code} {r.disc_name}</span> › {r.sub_code} {r.sub_name}
            </p>
            <p className="text-[11px] text-gray-400 mt-0.5">Closed {formatDate(r.completed_at)}</p>
            <ErpReducedControl
              projectId={r.project_id}
              disciplineId={r.discipline_id}
              subSkillId={r.sub_skill_id}
              label={`${r.sub_code} ${r.sub_name}`}
              savings={Number(r.savings)}
              reducedAt={null}
              reducedAmt={null}
              reducedByName={null}
              canTick
              variant="card"
            />
          </div>
        ))}
      </div>
    </Card>
  )
}
