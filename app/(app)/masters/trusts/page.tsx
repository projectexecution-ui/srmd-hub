import Link from 'next/link'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { RowDetailProvider, RowDetailToggle, RowDetail } from '@/components/cost-control/project-tree'
import { loadTrustMaster, type Trust } from '@/lib/revamp/masters-in4'
import { In4Note } from '../In4Note'

export const dynamic = 'force-dynamic'

/**
 * Trust Master — name, trust address, project addresses, GST and PAN for
 * each trust, exactly the five branches of the mind map, read from IN4's
 * company register. Nothing typed here: every field is IN4's own, and where
 * IN4 holds none (SRASSK has no GST registration anywhere in IN4) the screen
 * says that in words rather than leaving a hole.
 */
export default async function TrustsMasterPage() {
  await requirePermission('cost-control', 'view')
  const { trusts, in4, in4Error } = await loadTrustMaster()
  const projects = trusts.reduce((t, x) => t + x.projects.length, 0)
  const wos = trusts.reduce((t, x) => t + x.workOrders, 0)

  return (
    <RowDetailProvider>
      <div className="space-y-4">
        <PageHeader
          title="Trust Master"
          subtitle={`${trusts.length} trusts in IN4’s company register, paying for ${projects} projects and ${wos.toLocaleString('en-IN')} work orders.`}
        />
        <In4Note in4={in4} error={in4Error} what="addresses, GST and PAN" />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {trusts.map(t => <TrustCard key={t.id} t={t} />)}
        </div>
      </div>
    </RowDetailProvider>
  )
}

function TrustCard({ t }: { t: Trust }) {
  const place = [t.city, t.state, t.pin].filter(Boolean).join(' · ')
  return (
    <section className="rounded-xl border border-gray-200 bg-white">
      <div className="px-4 py-3 border-b border-gray-100 flex items-start gap-3">
        <span className="font-mono text-[12px] font-semibold text-indigo-800 bg-indigo-50 border border-indigo-100 rounded px-1.5 py-0.5 flex-shrink-0">{t.code}</span>
        <h2 className="text-[15px] font-bold text-gray-900 leading-snug">{t.name}</h2>
      </div>

      <dl className="px-4 py-3 grid grid-cols-1 sm:grid-cols-[9rem_1fr] gap-x-3 gap-y-2 text-[13px]">
        <Field label="Trust address">
          {t.address ?? <Missing>IN4 holds no address for this trust</Missing>}
          {t.printAddress && t.printAddress !== t.address && (
            <span className="block text-[12px] text-gray-500 mt-0.5">On printed orders: {t.printAddress}</span>
          )}
          {place && <span className="block text-[12px] text-gray-500 mt-0.5">{place}</span>}
        </Field>
        <Field label="GST No">
          {t.gst.length === 0
            ? <Missing>No GST registration on record in IN4</Missing>
            : t.gst.map(g => (
              <span key={g.gstin} className="block">
                <span className="font-mono">{g.gstin}</span>
                {(g.address || g.pin) && <span className="block text-[12px] text-gray-500">Registered at {[g.address, g.pin].filter(Boolean).join(' · ')}</span>}
              </span>
            ))}
        </Field>
        <Field label="PAN No">
          {t.pan && t.pan.toUpperCase() !== 'NA'
            ? <span className="font-mono">{t.pan}</span>
            : <Missing>{t.pan ? 'Recorded as “NA” in IN4' : 'IN4 holds no PAN for this trust'}</Missing>}
        </Field>
        <Field label="E-mail">{t.email ?? <Missing>None in IN4</Missing>}</Field>
        <Field label="Phone">{t.phone ?? <Missing>None in IN4</Missing>}</Field>
      </dl>

      <div className="border-t border-gray-100">
        <div className="px-3 py-2 flex items-center gap-1 text-[13px]">
          <RowDetailToggle id={`trust:${t.id}`} count={t.projects.length} />
          <span className="font-semibold text-gray-900">Project addresses</span>
          <span className="ml-auto text-[12px] text-gray-500 tabular-nums">{t.projects.length} project{t.projects.length === 1 ? '' : 's'} · {t.workOrders.toLocaleString('en-IN')} work orders</span>
        </div>
        <RowDetail id={`trust:${t.id}`}>
          <ul className="divide-y divide-gray-100 border-t border-gray-100 bg-slate-50/60">
            {t.projects.map(p => (
              <li key={p.id} className="px-4 py-2 text-[13px]">
                <p className="flex items-center gap-2 flex-wrap">
                  {p.code && <span className="font-mono text-[12px] text-gray-500">{p.code}</span>}
                  <Link href={`/masters/projects#p-${p.id}`} className="font-medium text-gray-900 hover:underline">{p.name}</Link>
                  {p.status && p.status !== 'Approved' && <span className="text-[11px] rounded border border-amber-200 bg-amber-50 text-amber-800 px-1">{p.status}</span>}
                  <span className="ml-auto text-[12px] text-gray-500 tabular-nums">{p.workOrders.toLocaleString('en-IN')} WO{p.workOrders === 1 ? '' : 's'}</span>
                </p>
                <p className="text-[12px] text-gray-600 mt-0.5">
                  {p.address
                    ? <>{p.address}{p.pin || p.city ? ` · ${[p.city, p.pin].filter(Boolean).join(' ')}` : ''}</>
                    : <Missing>IN4 holds no site address for this project</Missing>}
                </p>
              </li>
            ))}
          </ul>
        </RowDetail>
      </div>
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-[12px] uppercase tracking-wide text-gray-400 sm:pt-0.5">{label}</dt>
      <dd className="text-gray-800 break-words">{children}</dd>
    </>
  )
}

/** A stated absence — a fact about IN4, set apart from a value. */
function Missing({ children }: { children: React.ReactNode }) {
  return <span className="text-gray-500 italic">{children}</span>
}
