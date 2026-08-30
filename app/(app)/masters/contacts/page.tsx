import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { loadContacts } from '@/lib/revamp/masters'

export const dynamic = 'force-dynamic'

/** One contact list, merged by name across the lists that hold contacts today,
 *  with what is MISSING made obvious — because the gap is the point. The hub's
 *  90 vendors have no phone, email, GSTIN or address at all. */
export default async function ContactsMasterPage() {
  await requirePermission('cost-control', 'view')
  const contacts = await loadContacts()

  const filled = (f: (c: typeof contacts[number]) => unknown) => contacts.filter(c => f(c)).length
  const pct = (n: number) => contacts.length ? Math.round((n / contacts.length) * 100) : 0

  const stats = [
    { label: 'GSTIN', n: filled(c => c.gstin) },
    { label: 'Phone', n: filled(c => c.phone) },
    { label: 'Email', n: filled(c => c.email) },
    { label: 'Address', n: filled(c => c.address) },
  ]

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <PageHeader
        title="Contacts"
        back="/masters"
        subtitle={`${contacts.length} names, merged from the lists that hold contacts today.`}
      />

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
        <p className="text-sm font-semibold text-amber-900">This is names only — almost nothing else is filled in</p>
        <p className="text-xs text-amber-800 mt-1">
          The IN4 Contractor Master export has 349 contractors with address, PAN, email and GSTIN.
          Loading it, plus the Supplier Master, is what turns this from a list of names into a real master.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {stats.map(s => (
          <div key={s.label} className="rounded-lg border border-gray-200 bg-white px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide font-semibold text-gray-500">{s.label}</p>
            <p className={`text-base font-bold tabular-nums mt-0.5 ${pct(s.n) < 50 ? 'text-rose-700' : 'text-gray-900'}`}>
              {pct(s.n)}%
            </p>
            <p className="text-[11px] text-gray-400">{s.n} of {contacts.length}</p>
          </div>
        ))}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block rounded-lg border border-gray-200 bg-white overflow-hidden">
        <div className="overflow-auto max-h-[70vh]">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 font-semibold text-gray-600 min-w-[240px]">Name</th>
                <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 font-semibold text-gray-600 w-40">GSTIN</th>
                <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 font-semibold text-gray-600 w-32">Phone</th>
                <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 font-semibold text-gray-600 min-w-[200px]">Email</th>
                <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 font-semibold text-gray-600 w-36">In which list</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map(c => (
                <tr key={c.name} className="border-t border-gray-100 hover:bg-gray-50/60">
                  <td className="px-3 py-2 text-gray-900">{c.name}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-gray-600">{c.gstin ?? <Missing />}</td>
                  <td className="px-3 py-2 tabular-nums text-gray-600">{c.phone ?? <Missing />}</td>
                  <td className="px-3 py-2 text-gray-600 truncate">{c.email ?? <Missing />}</td>
                  <td className="px-3 py-2">
                    {c.sources.map(s => (
                      <span key={s} className="inline-block rounded bg-gray-100 text-gray-600 text-[10px] px-1.5 py-0.5 mr-1">{s}</span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden rounded-lg border border-gray-200 bg-white divide-y divide-gray-100 overflow-auto max-h-[70vh]">
        {contacts.map(c => (
          <div key={c.name} className="px-4 py-3">
            <p className="text-sm font-medium text-gray-900">{c.name}</p>
            <p className="text-[11px] text-gray-500 mt-0.5">
              {c.gstin ?? '—'} · {c.phone ?? '—'}
            </p>
            <p className="text-[11px] text-gray-500 truncate">{c.email ?? '—'}</p>
            <div className="mt-1">
              {c.sources.map(s => (
                <span key={s} className="inline-block rounded bg-gray-100 text-gray-600 text-[10px] px-1.5 py-0.5 mr-1">{s}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Missing() {
  return <span className="text-rose-300">— missing</span>
}
