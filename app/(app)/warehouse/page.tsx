import Link from 'next/link'
import { requirePermission, can, getMyProfile, getMyUser } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { QueryError } from '@/components/ui/query-error'
import { createClient } from '@/lib/supabase/server'
import { getSettings } from '@/lib/warehouse/data'
import { isOn } from '@/lib/warehouse/settings'
import { getRequestLanes } from '@/lib/warehouse/request-data'
import { todayIST } from '@/lib/warehouse/ledger'
import { homeTiles, homeCallout } from '@/lib/warehouse/home'
import type { HomeTile, TileKey } from '@/lib/warehouse/home'
import { formatNumber } from '@/lib/utils'
import {
  ArrowDownToLine, ArrowUpFromLine, ClipboardList, Boxes, BarChart3, Settings2,
  FileText, ScrollText, Package, ClipboardCheck, ShieldCheck, Truck,
} from 'lucide-react'

export const dynamic = 'force-dynamic'

/** Which picture goes with which tile. The only thing this page decides — WHAT
 *  to show and to whom is decided in lib/warehouse/home.ts, where a test can
 *  reach it. Every bug this module has shipped was role-dependent behaviour
 *  that compiled cleanly, so that decision does not live in a component. */
const ICONS: Record<TileKey, React.ComponentType<{ className?: string }>> = {
  stock: Boxes,
  raise: ClipboardList,
  mine: FileText,
  approvals: ShieldCheck,
  'to-issue': Truck,
  'gate-in': ArrowDownToLine,
  'gate-out': ArrowUpFromLine,
  count: ClipboardCheck,
  register: ScrollText,
  reports: BarChart3,
  po: FileText,
  items: Package,
  settings: Settings2,
}

export default async function WarehouseHomePage() {
  const perms = await requirePermission('warehouse', 'view')
  const [values, profile, me] = await Promise.all([getSettings(), getMyProfile(), getMyUser()])

  const canEdit = can(perms, 'warehouse', 'edit')
  const canAdmin = can(perms, 'warehouse', 'admin')
  const requestsOn = isOn(values, 'wh_requests_on')

  const sb = await createClient()
  const [itemsRes, stockRes, spotsRes, todayInRes, keptRes, lanes] = await Promise.all([
    sb.from('wh_items').select('id', { count: 'exact', head: true }).is('deleted_at', null),
    // What is actually ON A SHELF. Fetched as rows rather than a count because
    // one item can sit in several stores and the honest figure is how many
    // DIFFERENT items we hold, not how many store-and-item pairs exist.
    sb.from('wh_stock').select('item_id').gt('qty', 0),
    sb.from('wh_locations').select('id', { count: 'exact', head: true })
      .not('parent_id', 'is', null).is('deleted_at', null),
    sb.from('wh_gate_in').select('id', { count: 'exact', head: true })
      .eq('entry_date', todayIST()).is('deleted_at', null),
    // Which stores do I keep? Being named a store's keeper counts whatever the
    // base role is — that is how the stores are actually set up.
    me?.id
      ? sb.from('wh_locations').select('id').eq('keeper_id', me.id).is('deleted_at', null)
      : Promise.resolve({ data: [] as Array<{ id: string }>, error: null }),
    // Only worth the query when the feature is switched on at all.
    requestsOn ? getRequestLanes(200) : Promise.resolve(null),
  ])

  const shape = {
    canEdit, canAdmin, requestsOn,
    role: profile?.role ?? null,
    keepsAStore: (keptRes.data ?? []).length > 0,
    itemsInStock: new Set((stockRes.data ?? []).map(r => r.item_id)).size,
    catalogueItems: itemsRes.count ?? 0,
    spots: spotsRes.count ?? 0,
    todayIn: todayInRes.count ?? 0,
    toApprove: lanes?.toApprove.length ?? 0,
    toIssue: lanes?.toIssue.length ?? 0,
    mine: lanes?.mine.length ?? 0,
    canApprove: lanes?.canApprove ?? false,
  }

  const tiles = homeTiles(shape)
  const main = tiles.filter(t => t.section === 'main')
  const setup = tiles.filter(t => t.section === 'setup')
  const callout = homeCallout(shape)

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      <PageHeader
        title="Warehouse"
        subtitle="Request material, receive it at the gate, issue it out, and see where it went."
      />

      {lanes?.error && <QueryError what="the request queues" message={lanes.error} />}

      {callout && (
        <Card className="p-4 bg-amber-50 border-amber-200 text-sm flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <span className="text-amber-900">
            <b>{formatNumber(callout.count, 0)}</b> request{callout.count === 1 ? '' : 's'} waiting
            on you in <b>{callout.label}</b>.
          </span>
          <Link href={callout.href}
            className="text-amber-900 font-semibold underline-offset-2 hover:underline whitespace-nowrap">
            Open queue →
          </Link>
        </Card>
      )}

      {main.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {main.map(t => <HomeTileCard key={t.key} tile={t} />)}
        </div>
      ) : (
        <Card className="p-6 text-center text-sm text-slate-500">
          Nothing to show yet. Ask your admin to give you warehouse access.
        </Card>
      )}

      {setup.length > 0 && (
        <div className="pt-2 border-t border-slate-100 space-y-2">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">Setup</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {setup.map(t => <HomeTileCard key={t.key} tile={t} dashed />)}
          </div>
        </div>
      )}
    </div>
  )
}

const BADGE_STYLES = {
  amber: 'bg-amber-100 text-amber-900 border-amber-200',
  rose: 'bg-rose-100 text-rose-900 border-rose-200',
  blue: 'bg-blue-100 text-blue-900 border-blue-200',
} as const

// The icon chip, the left edge and the stat colour all key off whether
// something is actually waiting. Calm green when nothing is.
const ACCENT_STYLES = {
  none: { chip: 'bg-emerald-50 text-emerald-600', edge: 'border-l-transparent', stat: 'text-slate-500' },
  warning: { chip: 'bg-amber-50 text-amber-700', edge: 'border-l-amber-400', stat: 'text-amber-700 font-medium' },
  danger: { chip: 'bg-rose-50 text-rose-700', edge: 'border-l-rose-400', stat: 'text-rose-700 font-medium' },
} as const

function HomeTileCard({ tile, dashed = false }: { tile: HomeTile; dashed?: boolean }) {
  const { key, href, title, subtitle, stat, badge, badgeStyle = 'amber', accent } = tile
  const Icon = ICONS[key]
  const showBadge = typeof badge === 'number' && badge > 0
  const a = ACCENT_STYLES[accent]
  const line = stat ?? subtitle
  return (
    <Link href={href} className="group">
      <Card className={`relative h-full p-4 pl-[15px] flex flex-col items-start gap-3 border-l-[3px] ${a.edge} ${
        dashed ? 'border-dashed bg-slate-50/40' : ''
      } transition-all hover:shadow-md hover:-translate-y-0.5`}>
        {showBadge && (
          <span className={`absolute top-2.5 right-2.5 inline-flex items-center justify-center min-w-[1.5rem] h-5 px-1.5 rounded-full border text-[11px] font-bold tabular-nums ${BADGE_STYLES[badgeStyle]}`}>
            {badge > 99 ? '99+' : badge}
          </span>
        )}
        <div className={`inline-flex h-11 w-11 items-center justify-center rounded-xl transition-colors ${a.chip}`}>
          <Icon className="h-[22px] w-[22px]" />
        </div>
        <div className="min-w-0 w-full">
          <h3 className="text-sm font-semibold text-slate-900 leading-tight">{title}</h3>
          <p className={`text-xs leading-tight mt-1 tabular-nums truncate ${stat ? a.stat : 'text-slate-500'}`}>
            {line}
          </p>
        </div>
      </Card>
    </Link>
  )
}
