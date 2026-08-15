// TEMPORARY admin diagnostic — dumps the RAW Zoho fields of one live
// "Submitted to Trust A/c" bill and one recently-paid bill, so we can see which
// report columns (courier/submission date, trust account, adjust-against-
// advance, payment mode / remarks) already exist as Zoho custom fields vs need
// a config/manual input. Writes the field list to app_settings 'bp_inspect_dump'
// (so it can be read back) and shows it on screen. Delete after review.

import { requirePermission } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { getZohoToken, fetchAllTasks } from '@/lib/bills-pipeline/zoho'
import { getSelectedProjects } from '@/lib/bills-pipeline/projects'
import { normalizeStage } from '@/lib/bills-pipeline/transform'
import { BP_CONFIG } from '@/lib/bills-pipeline/config'

export const dynamic = 'force-dynamic'

type Row = Record<string, unknown>

function flatten(task: Row): Array<[string, string]> {
  return Object.entries(task)
    .map(([k, v]) => [k, v && typeof v === 'object' ? JSON.stringify(v) : String(v)] as [string, string])
    .sort((a, b) => a[0].localeCompare(b[0]))
}

export default async function BillInspectPage() {
  await requirePermission('bills-pipeline', 'view') // module is admin-only
  const supabase = await createClient()

  let trustTask: Row | null = null
  let paidTask: Row | null = null
  const stagesSeen = new Set<string>()
  const billTypeCounts: Record<string, number> = {}
  const accountFromAbstract: Record<string, number> = {}
  let trustTotal = 0, trustWithAbstract = 0
  let err: string | null = null

  try {
    const token = await getZohoToken(supabase)
    const projects = await getSelectedProjects(supabase)
    const results = await fetchAllTasks(token, projects)
    for (const r of results) {
      for (const t of r.tasks as unknown as Row[]) {
        const stage = normalizeStage((t.status as { name?: string })?.name ?? '')
        stagesSeen.add(stage)
        const closed = (t.is_completed === true) || ((t.status as { is_closed_type?: boolean })?.is_closed_type === true) || stage === BP_CONFIG.DONE_STAGE
        if (!trustTask && stage === BP_CONFIG.TRUST_STAGE) trustTask = t
        if (!paidTask && closed) paidTask = t
        // aggregates
        const bt = String(t.bill_type ?? '(none)')
        billTypeCounts[bt] = (billTypeCounts[bt] ?? 0) + 1
        if (stage === BP_CONFIG.TRUST_STAGE) {
          trustTotal++
          const abs = String(t.abstract_number_of_in4 ?? '')
          if (abs && abs !== 'null') {
            trustWithAbstract++
            const seg = (abs.split('/')[1] ?? '(?)').toUpperCase()
            accountFromAbstract[seg] = (accountFromAbstract[seg] ?? 0) + 1
          }
        }
      }
    }
    // Persist so it can be read back precisely (deleted after review).
    await supabase.from('app_settings').upsert({
      key: 'bp_inspect_dump',
      value: JSON.stringify({
        at: BP_CONFIG.DONE_STAGE, // marker only
        stagesSeen: [...stagesSeen],
        billTypeCounts,
        trustTotal,
        trustWithAbstract,
        accountFromAbstract,
        trustKeys: trustTask ? Object.keys(trustTask).sort() : [],
        paidKeys: paidTask ? Object.keys(paidTask).sort() : [],
        trust: trustTask ?? null,
        paid: paidTask ?? null,
      }),
    }, { onConflict: 'key' })
  } catch (e) {
    err = e instanceof Error ? e.message : String(e)
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-lg font-bold text-gray-900">Zoho bill — raw fields (diagnostic)</h1>
        <p className="text-sm text-gray-500 mt-0.5">One live &ldquo;Submitted to Trust A/c&rdquo; bill + one paid bill, every field exactly as Zoho returns it. Temporary — used to finalise the auto-report.</p>
      </div>

      {err && <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">Zoho error: {err}</div>}

      <div className="rounded-lg border border-gray-200 bg-white p-3 text-xs">
        <span className="font-semibold">Stages seen:</span> {[...stagesSeen].join('  ·  ') || '—'}
      </div>

      {([['Submitted to Trust A/c', trustTask], ['Paid / closed', paidTask]] as Array<[string, Row | null]>).map(([label, task]) => (
        <div key={label} className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 text-sm font-semibold text-gray-800">{label}{task ? '' : ' — none found'}</div>
          {task && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-gray-500"><th className="px-3 py-1.5 font-medium">Field</th><th className="px-3 py-1.5 font-medium">Value</th></tr></thead>
                <tbody>
                  {flatten(task).map(([k, v]) => (
                    <tr key={k} className="border-t border-gray-50">
                      <td className="px-3 py-1.5 font-mono text-gray-700 align-top whitespace-nowrap">{k}</td>
                      <td className="px-3 py-1.5 text-gray-600 break-all">{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
