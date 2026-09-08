import Link from 'next/link'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { loadContactMaster, type Party } from '@/lib/revamp/masters-in4'
import { MasterTable, type MasterRow, type MasterColumn } from '../MasterTable'

export const dynamic = 'force-dynamic'

const GROUPS = [
  { key: 'team', label: 'SRMD Team' },
  { key: 'consultants', label: 'Consultants' },
  { key: 'vendors', label: 'Vendors' },
  { key: 'contractors', label: 'Contractors' },
] as const
type GroupKey = (typeof GROUPS)[number]['key']

/**
 * Contact Master — the four groups of the mind map. Consultants, vendors and
 * contractors are IN4's registers with PAN, GST, address, phone, e-mail and
 * contact person (a consultant is a contractor under IN4's "Consultants
 * Cost" category; IN4 keeps no separate list). The SRMD team is CT Hub's
 * own users — IN4 has no staff list this login can read.
 */
export default async function ContactsMasterPage({ searchParams }: { searchParams: Promise<{ group?: string }> }) {
  await requirePermission('cost-control', 'view')
  const { group: raw } = await searchParams
  const group: GroupKey = GROUPS.some(g => g.key === raw) ? (raw as GroupKey) : 'team'
  const c = await loadContactMaster()
  const counts: Record<GroupKey, number> = { team: c.team.length, consultants: c.consultants.length, vendors: c.vendors.length, contractors: c.contractors.length }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Contact Master"
        subtitle={`${c.team.length} team · ${c.consultants.length} consultants · ${c.vendors.length} vendors · ${c.contractors.length} contractors.`}
      />

      <nav aria-label="Contact group" className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {GROUPS.map(g => (
          <Link
            key={g.key}
            href={g.key === 'team' ? '/masters/contacts' : `/masters/contacts?group=${g.key}`}
            aria-current={g.key === group ? 'page' : undefined}
            className={[
              'whitespace-nowrap rounded-full border px-3 py-1.5 text-[13px] min-h-[44px] inline-flex items-center gap-1.5',
              g.key === group ? 'border-indigo-300 bg-indigo-50 text-indigo-800 font-semibold' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50',
            ].join(' ')}
          >
            {g.label} <span className="tabular-nums text-[12px] opacity-70">{counts[g.key].toLocaleString('en-IN')}</span>
          </Link>
        ))}
      </nav>

      {group === 'team' ? (
        <MasterTable
          columns={[
            { key: 'name', label: 'Name' },
            { key: 'role', label: 'Role', width: 'w-44' },
            { key: 'email', label: 'E-mail' },
          ]}
          sortableKeys={['name', 'role']}
          rows={c.team.map(u => ({
            id: u.id,
            cells: {
              name: { text: u.name, tone: 'strong' },
              role: { text: u.roleLabel },
              email: u.email ? { text: u.email, tone: 'muted' } : { text: 'no e-mail on the account', tone: 'missing' },
            },
          }))}
          searchPlaceholder="Search the team by name, role or e-mail…"
          emptyMessage="No CT Hub users yet."
        />
      ) : (
        <PartyTable parties={c[group]} kind={group} />
      )}
    </div>
  )
}

function PartyTable({ parties, kind }: { parties: Party[]; kind: 'consultants' | 'vendors' | 'contractors' }) {
  const columns: MasterColumn[] = [
    { key: 'name', label: 'Name' },
    { key: 'pan', label: 'PAN', width: 'w-32' },
    { key: 'gstin', label: 'GST No', width: 'w-40' },
    { key: 'phone', label: 'Phone', width: 'w-32' },
    { key: 'email', label: 'E-mail' },
    { key: 'city', label: 'City', width: 'w-32' },
    ...(kind === 'vendors' ? [] : [{ key: 'skills', label: 'Categories', desktopOnly: true } as MasterColumn]),
  ]
  const rows: MasterRow[] = parties.map(p => ({
    id: `${p.kind}:${p.id}`,
    tone: p.isActive ? undefined : 'warn',
    cells: {
      name: { text: p.name, tone: p.isActive ? 'strong' : 'muted', sub: [p.contactPerson, p.isActive ? null : 'inactive in IN4'].filter(Boolean).join(' · ') || undefined },
      pan: p.pan ? { text: p.pan, mono: true } : { text: 'none in IN4', tone: 'missing' },
      gstin: p.gstin ? { text: p.gstin, mono: true } : { text: 'none in IN4', tone: 'missing' },
      phone: p.phone ? { text: p.phone } : { text: 'none in IN4', tone: 'missing' },
      email: p.email ? { text: p.email, tone: 'muted' } : { text: 'none in IN4', tone: 'missing' },
      city: { text: p.city ?? p.address ?? '', sub: [p.state, p.pin].filter(Boolean).join(' ') || undefined },
      skills: { text: p.skills.join(', '), tone: 'muted' },
    },
  }))
  const filled = (f: (p: Party) => unknown) => parties.filter(f).length
  const stats = [
    { label: 'PAN', n: filled(p => p.pan) },
    { label: 'GST No', n: filled(p => p.gstin) },
    { label: 'Phone', n: filled(p => p.phone) },
    { label: 'E-mail', n: filled(p => p.email) },
    { label: 'Address', n: filled(p => p.address) },
  ]
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
        {stats.map(s => (
          <div key={s.label} className="rounded-lg border border-gray-200 bg-white px-3 py-2">
            <p className="text-[12px] text-gray-500">{s.label} on record</p>
            <p className="text-[15px] font-semibold tabular-nums text-gray-900">{s.n.toLocaleString('en-IN')} <span className="text-[12px] font-normal text-gray-400">of {parties.length}</span></p>
          </div>
        ))}
      </div>
      <MasterTable
        columns={columns}
        rows={rows}
        sortableKeys={['name', 'city']}
        searchPlaceholder={`Search ${kind} by name, PAN, GST, phone, e-mail or city…`}
        emptyMessage={`No ${kind} in IN4.`}
      />
    </div>
  )
}
