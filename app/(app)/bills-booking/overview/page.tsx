import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { QueryError } from '@/components/ui/query-error'
import { EmptyState } from '@/components/ui/empty-state'
import { ReceiptText } from 'lucide-react'
import { rollUpProjects, type CertRow, type ProjectRow } from '@/lib/bills-booking/overview'
import { formatINR } from '@/lib/utils'

const KIND_LABEL: Record<string, string> = { wo: 'work-order bills', advance: 'advances', misc: 'misc expenses' }

export const dynamic = 'force-dynamic'

/** Money that is still owed, by project, read from the IN4 mirror.
 *
 *  Admin only, deliberately. This is the management screen — it adds up every
 *  unpaid and part-paid certificate across every project, which is a number no
 *  desk user has any reason to see and nobody has ever been shown. */
export default async function BillsOverviewPage() {
  await requirePermission('bills-booking', 'admin')
  const supabase = await createClient()

  // PostgREST caps a plain select at 1,000 rows and there are ~4,700
  // certificates, so page through rather than silently truncating the total.
  const certs: CertRow[] = []
  const PAGE = 1000
  let from = 0
  let certErr: string | null = null
  for (;;) {
    const { data, error } = await supabase
      .from('in4_wo_certificates')
      .select('certificate_id, kind, display_no, project_id, wo_id, wo_no, status_name, outstanding_amt, creation_dt')
      .gt('outstanding_amt', 0)
      .range(from, from + PAGE - 1)
    if (error) { certErr = error.message; break }
    const page = (data ?? []) as CertRow[]
    certs.push(...page)
    if (page.length < PAGE) break
    from += PAGE
  }

  const { data: projData, error: projErr } = await supabase
    .from('in4_projects')
    .select('id, name')

  if (certErr || projErr) return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <PageHeader title="Money waiting" back="/bills-booking" />
      <QueryError message={certErr ?? projErr?.message ?? 'Could not read the IN4 mirror.'} />
    </div>
  )

  const { rows, totals, byKind } = rollUpProjects(certs, (projData ?? []) as ProjectRow[])

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <PageHeader
        title="Money waiting"
        subtitle="Every unpaid and part-paid certificate in IN4, by project. Admin only."
        back="/bills-booking"
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={<ReceiptText className="h-8 w-8" />}
          title="Nothing outstanding"
          description="Either every certificate is settled, or the IN4 mirror has not synced yet. Check /admin/in4."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-px rounded-xl overflow-hidden border border-gray-200 bg-gray-200">
            <Stat k="Money waiting" v={formatINR(totals.outstanding)} s={`${totals.bills} bills`} />
            <Stat k="Projects" v={String(rows.length)} s="with money open" />
            <Stat k="Work orders" v={String(totals.wos)} s="carrying a live bill" />
            <Stat k="Oldest" v={`${totals.oldest} d`} s="since the bill was raised" />
          </div>

          <p className="text-xs text-gray-500 -mt-1">
            Made up of {byKind.map(k => `${k.bills} ${KIND_LABEL[k.kind] ?? k.kind} (${formatINR(k.outstanding)})`).join(' · ')}.
            Work-order bills are the ones to check against IN4; advances and misc expenses are separate documents there.
          </p>

          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                  <th className="text-left font-semibold px-3 py-2">Project</th>
                  <th className="text-right font-semibold px-3 py-2">Bills open</th>
                  <th className="text-right font-semibold px-3 py-2">Work orders</th>
                  <th className="text-right font-semibold px-3 py-2">Money waiting</th>
                  <th className="text-right font-semibold px-3 py-2">Oldest</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.projectId} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                    <td className="px-3 py-2">{r.project}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.bills}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.wos}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">{formatINR(r.outstanding)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${r.oldest > 365 ? 'text-red-600 font-semibold' : r.oldest > 30 ? 'text-amber-600' : 'text-gray-500'}`}>
                      {r.oldest} d
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
                  <td className="px-3 py-2">{rows.length} projects</td>
                  <td className="px-3 py-2 text-right tabular-nums">{totals.bills}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{totals.wos}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatINR(totals.outstanding)}</td>
                  <td className="px-3 py-2 text-right">—</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="text-xs text-gray-500">
            Read from the IN4 mirror, not from CT Hub&apos;s own bills. Cancelled certificates are excluded;
            everything else with a balance is counted, including part-paid.{' '}
            <Link href="/admin/in4" className="text-blue-600 hover:underline">Sync status</Link>
          </p>
        </>
      )}
    </div>
  )
}

function Stat({ k, v, s }: { k: string; v: string; s: string }) {
  return (
    <div className="bg-white px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">{k}</div>
      <div className="text-xl font-medium tabular-nums mt-0.5">{v}</div>
      <div className="text-[11px] text-gray-500">{s}</div>
    </div>
  )
}
