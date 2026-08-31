import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { loadContacts } from '@/lib/revamp/masters'
import { MasterTable, type MasterRow } from '../MasterTable'

export const dynamic = 'force-dynamic'

/** One contact list, merged by name across the lists that hold contacts today,
 *  with what is MISSING made obvious — because the gap is the point. */
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

  const rows: MasterRow[] = contacts.map(c => ({
    id: c.name,
    tone: c.completeness <= 20 ? 'warn' : undefined,
    cells: {
      name: { text: c.name, tone: 'strong', sub: c.sources.join(' · ') },
      gstin: c.gstin ? { text: c.gstin, mono: true } : { text: 'missing', tone: 'missing' },
      phone: c.phone ? { text: c.phone } : { text: 'missing', tone: 'missing' },
      email: c.email ? { text: c.email, tone: 'muted' } : { text: 'missing', tone: 'missing' },
      completeness: {
        text: `${c.completeness}%`,
        tone: c.completeness >= 60 ? 'good' : c.completeness >= 40 ? 'warn' : 'missing',
      },
    },
  }))

  return (
    <div className="space-y-4">
      <PageHeader
        title="Contacts"
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

      <MasterTable
        columns={[
          { key: 'name', label: 'Name' },
          { key: 'gstin', label: 'GSTIN', width: 'w-40' },
          { key: 'phone', label: 'Phone', width: 'w-32' },
          { key: 'email', label: 'Email' },
          { key: 'completeness', label: 'Filled', align: 'right', width: 'w-24' },
        ]}
        sortableKeys={['name', 'completeness']}
        rows={rows}
        searchPlaceholder="Search a contractor or supplier by name, GSTIN, phone or email…"
        emptyMessage="No contacts yet."
      />
    </div>
  )
}
