import Link from 'next/link'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { loadContactMaster, type Party } from '@/lib/revamp/masters-in4'
import { loadContacts as loadHubContacts } from '@/lib/masters'
import { MasterTable, type MasterRow, type MasterColumn } from '../MasterTable'
import { LinkPicker } from '../LinkPicker'
import { canEditMasters } from '../admin'

export const dynamic = 'force-dynamic'

const GROUPS = [
  { key: 'team', label: 'SRMD Team' },
  { key: 'consultants', label: 'Consultants' },
  { key: 'vendors', label: 'Vendors' },
  { key: 'contractors', label: 'Contractors' },
  { key: 'hub-only', label: 'In CT Hub only' },
] as const
type GroupKey = (typeof GROUPS)[number]['key']

/**
 * Contact Master — the four groups of the mind map. Consultants, vendors and
 * contractors are IN4's registers with PAN, GST, address, phone, e-mail and
 * contact person (a consultant is a contractor under IN4's "Consultants
 * Cost" category; IN4 keeps no separate list). The SRMD team is CT Hub's
 * own users — IN4 has no staff list this login can read. What IN4 itself
 * gets wrong is shown, not smoothed over: the same firm entered twice, a
 * GSTIN that cannot be right.
 */
export default async function ContactsMasterPage({ searchParams }: { searchParams: Promise<{ group?: string; q?: string }> }) {
  await requirePermission('cost-control', 'view')
  const { group: raw, q = '' } = await searchParams
  const group: GroupKey = GROUPS.some(g => g.key === raw) ? (raw as GroupKey) : 'team'
  // The hub's own Vendors and JMR-contractor lists, measured against IN4: a
  // name with no IN4 party behind it was typed here and never registered, or
  // IN4 spells it differently — an admin pins it.
  const [c, hubList] = await Promise.all([loadContactMaster(), loadHubContacts()])
  const hubOnly = hubList.rows.filter(r => r.kind === 'hub-only')
  const counts: Record<GroupKey, number> = { team: c.team.length, consultants: c.consultants.length, vendors: c.vendors.length, contractors: c.contractors.length, 'hub-only': hubOnly.length }
  const qs = q ? `&q=${encodeURIComponent(q)}` : ''

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
            href={g.key === 'team' ? `/masters/contacts${q ? `?q=${encodeURIComponent(q)}` : ''}` : `/masters/contacts?group=${g.key}${qs}`}
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
      <p className="text-[12px] text-gray-500">
        {group === 'team' && 'CT Hub’s own users, without contractor logins (those are under Contractors, from IN4).'}
        {group === 'consultants' && 'IN4 keeps no consultant list: these are the contractors IN4 files under its “Consultants Cost” category.'}
        {group === 'vendors' && 'IN4’s supplier register — PAN, GST, address, phone, e-mail and contact person as entered there.'}
        {group === 'contractors' && 'IN4’s service-provider register, without the consultants.'}
        {group === 'hub-only' && `Names typed into CT Hub (Vendors, JMR contractors) that match no party in IN4 — ${hubList.matched} others matched. Either IN4 spells it differently (pin it) or it was never registered in IN4.`}
      </p>

      {group === 'hub-only' ? (
        <HubOnly rows={hubOnly} in4Options={hubList.rows.filter(r => r.kind !== 'hub-only').map(r => ({ key: r.key, label: `${r.name}${r.pan ? ` · ${r.pan}` : ''}` }))} q={q} />
      ) : group === 'team' ? (
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
              email: u.email ? { text: u.email, tone: 'muted' } : { text: '—', tone: 'muted' },
            },
          }))}
          initialQuery={q}
          exportName="srmd-team"
          searchPlaceholder="Search the team by name, role or e-mail…"
          emptyMessage="No CT Hub users yet."
          emptyHint={<Link href={`/masters/search?q=${encodeURIComponent(q)}`} className="text-indigo-700 hover:underline">Search all masters instead</Link>}
        />
      ) : (
        <PartyTable parties={c[group]} kind={group} q={q} />
      )}
    </div>
  )
}

function PartyTable({ parties, kind, q }: { parties: Party[]; kind: 'consultants' | 'vendors' | 'contractors'; q: string }) {
  const columns: MasterColumn[] = [
    { key: 'name', label: 'Name' },
    { key: 'pan', label: 'PAN', width: 'w-32' },
    { key: 'gstin', label: 'GST No', width: 'w-40' },
    { key: 'phone', label: 'Phone', width: 'w-32' },
    { key: 'email', label: 'E-mail' },
    { key: 'city', label: 'City · address', width: 'w-56' },
    ...(kind === 'vendors' ? [] : [{ key: 'skills', label: 'Categories', desktopOnly: true } as MasterColumn]),
  ]
  const dash = { text: '—', tone: 'muted' as const }
  const rows: MasterRow[] = parties.map(p => {
    const notes = [
      p.contactPerson,
      p.isActive ? null : 'inactive in IN4',
      p.duplicateOf.length ? `duplicate of #${p.duplicateOf.join(', #')} in IN4` : null,
    ].filter(Boolean).join(' · ')
    return {
      id: `${p.kind}:${p.id}`,
      tone: !p.isActive || p.duplicateOf.length > 0 ? 'warn' : undefined,
      cells: {
        name: { text: p.name, tone: p.isActive ? 'strong' : 'muted', sub: notes || undefined },
        pan: p.pan ? { text: p.pan, mono: true, tone: p.panLooksWrong ? 'missing' : 'default', sub: p.panLooksWrong ? 'looks wrong' : undefined } : dash,
        gstin: p.gstin ? { text: p.gstin, mono: true, tone: p.gstinLooksWrong ? 'missing' : 'default', sub: p.gstinLooksWrong ? 'looks wrong' : undefined } : dash,
        phone: p.phone ? { text: p.phone } : dash,
        email: p.email ? { text: p.email, tone: 'muted' } : dash,
        city: { text: p.city ?? (p.address ? '' : '—'), sub: [p.address, p.pin].filter(Boolean).join(' · ') || undefined },
        skills: { text: p.skills.join(', '), tone: 'muted' },
      },
    }
  })
  const filled = (f: (p: Party) => unknown) => parties.filter(f).length
  const dupes = parties.filter(p => p.duplicateOf.length > 0).length
  const wrong = parties.filter(p => p.gstinLooksWrong || p.panLooksWrong).length
  const stats = [
    { label: 'PAN on record', n: filled(p => p.pan) },
    { label: 'GST No on record', n: filled(p => p.gstin) },
    { label: 'Phone on record', n: filled(p => p.phone) },
    { label: 'E-mail on record', n: filled(p => p.email) },
    { label: 'Entered twice in IN4', n: dupes, tone: dupes > 0 ? 'amber' as const : undefined },
    { label: 'PAN/GST looks wrong', n: wrong, tone: wrong > 0 ? 'rose' as const : undefined },
  ]
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {stats.map(s => (
          <div key={s.label} className="rounded-lg border border-gray-200 bg-white px-3 py-2">
            <p className="text-[12px] text-gray-500">{s.label}</p>
            <p className={`text-[15px] font-semibold tabular-nums ${s.tone === 'amber' ? 'text-amber-700' : s.tone === 'rose' ? 'text-rose-700' : 'text-gray-900'}`}>
              {s.n.toLocaleString('en-IN')}{s.tone ? '' : <span className="text-[12px] font-normal text-gray-400"> of {parties.length}</span>}
            </p>
          </div>
        ))}
      </div>
      <MasterTable
        columns={columns}
        rows={rows}
        sortableKeys={['name', 'city']}
        initialQuery={q}
        exportName={kind}
        searchPlaceholder={`Search ${kind} by name, PAN, GST, phone, e-mail or city…`}
        emptyMessage={`No ${kind} in IN4.`}
        emptyHint={<span>Not here? It may be in another group — <Link href={`/masters/search?q=${encodeURIComponent(q)}`} className="text-indigo-700 hover:underline">search all masters</Link>.</span>}
      />
    </div>
  )
}

/** CT Hub names with no IN4 party behind them — the scattering, measured. */
async function HubOnly({ rows, in4Options, q }: { rows: Awaited<ReturnType<typeof loadHubContacts>>['rows']; in4Options: Array<{ key: string; label: string }>; q: string }) {
  const canEdit = await canEditMasters()
  const table: MasterRow[] = rows.map(r => ({
    id: r.key,
    tone: 'warn',
    cells: {
      name: { text: r.name, tone: 'strong', sub: r.hubSources.join(', ') || undefined },
      gstin: r.gstin ? { text: r.gstin, mono: true } : { text: '—', tone: 'muted' },
      phone: r.phone ? { text: r.phone } : { text: '—', tone: 'muted' },
      email: r.email ? { text: r.email, tone: 'muted' } : { text: '—', tone: 'muted' },
    },
    action: canEdit && r.hubRefs[0] ? <LinkPicker kind="party" hubTable={r.hubRefs[0].table} hubId={r.hubRefs[0].id} current={null} options={in4Options} /> : undefined,
  }))
  return (
    <MasterTable
      columns={[
        { key: 'name', label: 'CT Hub name' },
        { key: 'gstin', label: 'GST No', width: 'w-40' },
        { key: 'phone', label: 'Phone', width: 'w-32' },
        { key: 'email', label: 'E-mail' },
      ]}
      sortableKeys={['name']}
      rows={table}
      initialQuery={q}
      exportName="contacts-ct-hub-only"
      searchPlaceholder="Search a CT Hub-only name…"
      emptyMessage="Every CT Hub contact matches a party in IN4."
    />
  )
}
