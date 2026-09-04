import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { loadContacts } from '@/lib/masters'
import { MasterTable, type MasterRow } from '../MasterTable'
import { LinkPicker } from '../LinkPicker'

export const dynamic = 'force-dynamic'

/** One contact list: IN4's contractor and supplier registers (with PAN, GSTIN,
 *  address — the fields the hub never had), and the hub's own Vendors and JMR
 *  contractors matched onto them. A hub entry with no IN4 party behind it is
 *  the row to look at: either IN4 spells it differently (pin it), or it was
 *  typed into the hub and never registered in IN4. */
export default async function ContactsMasterPage() {
  await requirePermission('admin-settings', 'view', '/admin')
  const { rows: contacts, in4Count, hubOnly, matched, synced } = await loadContacts()

  const filled = (f: (c: typeof contacts[number]) => unknown) => contacts.filter(c => f(c)).length
  const pct = (n: number) => contacts.length ? Math.round((n / contacts.length) * 100) : 0
  const stats = [
    { label: 'GSTIN', n: filled(c => c.gstin) },
    { label: 'PAN', n: filled(c => c.pan) },
    { label: 'Phone', n: filled(c => c.phone) },
    { label: 'Email', n: filled(c => c.email) },
  ]
  const in4Options = contacts.filter(c => c.kind !== 'hub-only').map(c => ({ key: c.key, label: `${c.name}${c.pan ? ` · ${c.pan}` : ''}` }))

  const miss = { text: 'missing', tone: 'missing' as const }
  const rows: MasterRow[] = contacts.map(c => ({
    id: c.key,
    tone: c.kind === 'hub-only' ? 'warn' : undefined,
    cells: {
      name: { text: c.name, tone: 'strong', sub: [c.code, c.hubSources.length ? `also in ${c.hubSources.join(', ')}` : c.kind === 'hub-only' ? 'hub only — no IN4 party' : 'IN4 only'].filter(Boolean).join(' · ') },
      kind: { text: c.kind === 'both' ? 'Contractor + Supplier' : c.kind === 'hub-only' ? 'Hub only' : c.kind === 'contractor' ? 'Contractor' : 'Supplier', tone: c.kind === 'hub-only' ? 'warn' : 'muted' },
      pan: c.pan ? { text: c.pan, mono: true } : miss,
      gstin: c.gstin ? { text: c.gstin, mono: true } : miss,
      phone: c.phone ? { text: c.phone } : miss,
      email: c.email ? { text: c.email, tone: 'muted' } : miss,
      city: c.city ? { text: c.city, tone: 'muted' } : { text: '' },
      skills: { text: c.skills.slice(0, 3).join(', ') + (c.skills.length > 3 ? ` +${c.skills.length - 3}` : ''), tone: 'muted' },
      active: { text: c.isActive ? '' : 'inactive', tone: 'warn' },
    },
    action: c.kind === 'hub-only' && c.hubRefs[0]
      ? <LinkPicker kind="party" hubTable={c.hubRefs[0].table} hubId={c.hubRefs[0].id} current={null} options={in4Options} />
      : undefined,
  }))

  return (
    <div className="space-y-4">
      <PageHeader title="Contacts" subtitle={synced ? `${in4Count.toLocaleString('en-IN')} parties on IN4's register · ${matched} hub entries matched · ${hubOnly} hub entries without an IN4 party.` : 'IN4 has not been mirrored yet — showing the hub lists only.'} />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {stats.map(s => (
          <div key={s.label} className="rounded-lg border border-gray-200 bg-white px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide font-semibold text-gray-500">{s.label}</p>
            <p className={`text-base font-bold tabular-nums mt-0.5 ${pct(s.n) < 50 ? 'text-rose-700' : 'text-gray-900'}`}>{pct(s.n)}%</p>
            <p className="text-[11px] text-gray-400">{s.n} of {contacts.length}</p>
          </div>
        ))}
      </div>

      <MasterTable
        columns={[
          { key: 'name', label: 'Name' },
          { key: 'kind', label: 'Kind', width: 'w-40' },
          { key: 'pan', label: 'PAN', width: 'w-32' },
          { key: 'gstin', label: 'GSTIN', width: 'w-40' },
          { key: 'phone', label: 'Phone', width: 'w-32' },
          { key: 'email', label: 'Email', desktopOnly: true },
          { key: 'city', label: 'City', width: 'w-28', desktopOnly: true },
          { key: 'skills', label: 'Trades', desktopOnly: true },
          { key: 'active', label: '', width: 'w-16' },
        ]}
        sortableKeys={['name', 'kind', 'city']}
        rows={rows}
        filters={[
          { key: 'hub-only', label: 'No IN4 party', test: r => r.tone === 'warn' },
          { key: 'contractor', label: 'Contractors', test: r => r.cells.kind.text.startsWith('Contractor') },
          { key: 'supplier', label: 'Suppliers', test: r => r.cells.kind.text.includes('Supplier') },
          { key: 'in-hub', label: 'Also in hub lists', test: r => (r.cells.name.sub ?? '').includes('also in') },
        ]}
        searchPlaceholder="Search by name, PAN, GSTIN, phone, city or trade…"
        emptyMessage="No contacts yet."
      />
    </div>
  )
}
