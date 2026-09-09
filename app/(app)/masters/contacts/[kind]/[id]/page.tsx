import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, FileText } from 'lucide-react'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { loadPartyCard } from '@/lib/revamp/party-card'
import { formatINR, formatDate } from '@/lib/utils'
import { MasterTable, type MasterRow } from '../../../MasterTable'
import { In4Note } from '../../../In4Note'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const rate = (v: number) => `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

/**
 * One contractor or supplier, the way a Head sizes them up: what they were
 * given, what they were paid, what is held back, where they worked, how they
 * deliver, whether their prices are competitive — every figure IN4's own,
 * every order opening in IN4's format or as its ledger.
 */
export default async function PartyPage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  await requirePermission('cost-control', 'view')
  const { kind: k, id: rawId } = await params
  const kind = k === 'supplier' ? 'supplier' : k === 'contractor' ? 'contractor' : null
  const id = Number(rawId)
  if (!kind || !Number.isInteger(id) || id <= 0) notFound()
  const { card, in4, in4Error } = await loadPartyCard(kind, id)
  if (!card) notFound()
  const { party: p, totals: t, orders, delivery, prices } = card
  const isPo = kind === 'supplier'
  const base = isPo ? '/api/in4/purchase-order' : '/api/in4/work-order'

  const rows: MasterRow[] = orders.map(o => ({
    id: String(o.id),
    tone: o.status === 'Cancelled' || o.status === 'Terminated' ? 'warn' : undefined,
    cells: {
      ref: { text: o.ref, mono: true, tone: 'strong', sub: o.date ? formatDate(o.date) : undefined },
      project: { text: o.project ?? '', sub: o.category ?? undefined },
      status: { text: o.status ?? '', tone: o.status === 'Approved' ? 'muted' : 'warn', sub: isPo ? (o.grnStatus === 'Fullfilled' ? 'received in full' : o.grnStatus === 'Partial' ? 'partly received' : 'nothing received') : undefined },
      gross: { text: formatINR(o.gross) },
      paid: { text: formatINR(o.paid), tone: 'muted' },
      ...(isPo ? {} : { retention: { text: o.retention ? formatINR(o.retention) : '—', tone: 'muted' as const } }),
    },
    action: (
      <span className="inline-flex gap-3 text-[12px] font-semibold text-indigo-700">
        <a href={`${base}/${o.id}/ledger`} target="_blank" rel="noopener" className="inline-flex items-center gap-1 hover:underline"><FileText className="h-3 w-3" /> Ledger</a>
        <a href={`${base}/${o.id}/print`} target="_blank" rel="noopener" className="inline-flex items-center gap-1 hover:underline"><FileText className="h-3 w-3" /> Print</a>
      </span>
    ),
  }))

  return (
    <div className="space-y-4">
      <Link href={`/masters/contacts?group=${isPo ? 'vendors' : 'contractors'}`} className="inline-flex items-center gap-1 text-[13px] font-semibold text-indigo-700 hover:underline min-h-[44px]">
        <ArrowLeft className="h-3.5 w-3.5" /> All {isPo ? 'vendors' : 'contractors'}
      </Link>
      <PageHeader title={p.name} subtitle={`${isPo ? 'Supplier' : 'Contractor'} #${p.id} in IN4${p.isActive ? '' : ' · inactive'}${p.contactPerson ? ` · ${p.contactPerson}` : ''}`} />
      <In4Note in4={in4} error={in4Error} what="orders and payments" />

      <dl className="rounded-lg border border-gray-200 bg-white px-4 py-3 grid grid-cols-1 sm:grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-[13px]">
        <Field label="Address">{[p.address, p.city, p.state, p.pin].filter(Boolean).join(', ') || <Muted>none in IN4</Muted>}</Field>
        <Field label="PAN · GST">{p.pan ? <span className="font-mono">{p.pan}</span> : <Muted>no PAN</Muted>} · {p.gstin ? <span className="font-mono">{p.gstin}</span> : <Muted>no GSTIN</Muted>}</Field>
        <Field label="Phone · e-mail">{p.phone ?? <Muted>no phone</Muted>} · {p.email ?? <Muted>no e-mail</Muted>}</Field>
        {p.skills.length > 0 && <Field label="Categories">{p.skills.join(', ')}</Field>}
      </dl>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <Kpi label={isPo ? 'Purchase orders' : 'Work orders'} value={String(t.orders)} />
        <Kpi label="Ordered (with GST)" value={formatINR(t.gross)} />
        <Kpi label="Paid" value={formatINR(t.paid)} />
        {!isPo && <Kpi label="Retention held" value={formatINR(t.retention)} />}
        <Kpi label="Projects · categories" value={`${t.projects} · ${t.categories}`} />
        <Kpi label="First → last order" value={t.first ? `${formatDate(t.first)} → ${t.last ? formatDate(t.last) : ''}` : '—'} small />
        {isPo && delivery && <Kpi label="PO → first delivery" value={delivery.avgLeadDays != null ? `${delivery.avgLeadDays} days avg` : '—'} sub={`${delivery.fulfilled} in full · ${delivery.partial} partial · ${delivery.open} nothing yet`} />}
      </div>

      {isPo && prices.length > 0 && (
        <section className="rounded-lg border border-gray-200 bg-white">
          <h2 className="px-3 py-2 text-[13px] font-semibold text-gray-900 border-b border-gray-100">Prices against other suppliers <span className="font-normal text-gray-500 text-[12px]">— materials SRMD has also bought elsewhere</span></h2>
          <ul className="divide-y divide-gray-100">
            {prices.map(x => {
              const over = x.marketMin > 0 ? x.myRate / x.marketMin - 1 : 0
              return (
                <li key={x.material} className="px-3 py-1.5 text-[12px] flex flex-wrap gap-x-3 items-baseline">
                  <Link href={`/masters/rates?q=${encodeURIComponent(x.material)}`} className="text-gray-900 hover:underline">{x.material}</Link>
                  <span className="tabular-nums text-gray-700">theirs {rate(x.myRate)}</span>
                  <span className="tabular-nums text-gray-500">lowest paid {rate(x.marketMin)} ({x.suppliers} suppliers)</span>
                  <span className={`ml-auto tabular-nums font-semibold ${over > 0.05 ? 'text-amber-700' : 'text-emerald-700'}`}>{over > 0.005 ? `+${Math.round(over * 100)}%` : 'lowest'}</span>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <MasterTable
        columns={[
          { key: 'ref', label: isPo ? 'PO' : 'Work order', width: 'w-56' },
          { key: 'project', label: 'Project · category' },
          { key: 'status', label: 'Status', width: 'w-36' },
          { key: 'gross', label: 'Ordered', align: 'right', width: 'w-32' },
          { key: 'paid', label: 'Paid', align: 'right', width: 'w-32' },
          ...(isPo ? [] : [{ key: 'retention', label: 'Retention', align: 'right' as const, width: 'w-28' }]),
        ]}
        sortableKeys={['ref', 'project', 'gross', 'paid']}
        rows={rows}
        filters={[
          { key: 'open', label: isPo ? 'Not fully received' : 'Not fully paid', test: r => isPo ? r.cells.status.sub !== 'received in full' : r.cells.gross.text !== r.cells.paid.text },
        ]}
        exportName={`${kind}-${id}-orders`}
        searchPlaceholder={`Search this ${isPo ? 'supplier' : 'contractor'}’s orders by number, project or category…`}
        emptyMessage={`IN4 holds no ${isPo ? 'purchase orders' : 'work orders'} for this ${isPo ? 'supplier' : 'contractor'}.`}
      />
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <><dt className="text-[12px] uppercase tracking-wide text-gray-400">{label}</dt><dd className="text-gray-800 break-words">{children}</dd></>
}
function Muted({ children }: { children: React.ReactNode }) { return <span className="text-gray-500 italic">{children}</span> }
function Kpi({ label, value, sub, small }: { label: string; value: string; sub?: string; small?: boolean }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
      <p className="text-[12px] text-gray-500">{label}</p>
      <p className={`${small ? 'text-[13px]' : 'text-[15px]'} font-semibold tabular-nums text-gray-900`}>{value}</p>
      {sub && <p className="text-[12px] text-gray-400">{sub}</p>}
    </div>
  )
}
