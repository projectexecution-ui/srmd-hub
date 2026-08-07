import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requirePermission, can, getMyProfile, getMyUser } from '@/lib/auth'
import { getInvSettings } from '@/lib/inventory/settings'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import {
  Boxes, ClipboardList, Truck, FileText, Undo2,
  Building2, Tag, PackagePlus, ShieldCheck, SlidersHorizontal, Store, Wrench, Users, FileBarChart, ClipboardCheck,
} from 'lucide-react'
import type { Role } from '@/lib/types'

export const dynamic = 'force-dynamic'

// Statuses by stage — single source of truth so the counts on tiles
// match exactly what the inbox pages show when you click them.
const PENDING_HOP        = 'PENDING_HOP'
const TO_ISSUE           = ['APPROVED', 'EMERGENCY_ISSUED']
const REJECTED            = ['REJECTED_BACKOFFICE', 'REJECTED_HOP']

export default async function InventoryLandingPage() {
  const perms = await requirePermission('inventory', 'view')
  const [profile, user, invSettings] = await Promise.all([getMyProfile(), getMyUser(), getInvSettings()])
  const role: Role | null = profile?.role ?? null
  const canEdit  = can(perms, 'inventory', 'edit')
  const canAdmin = can(perms, 'inventory', 'admin')
  // When the approval dial is 'off', there is no Atm Head step — a request goes
  // straight to the storekeeper. So the Approvals tile/queue only makes sense in
  // 'always' mode; hide it otherwise so heads don't stare at an always-empty box.
  const approvalsActive = invSettings.approval_mode === 'always'

  // ─── Live counts for every tile so the user knows what's queued
  //     where without opening each inbox. Each `count` is null when
  //     the user can't see that queue (so we hide the badge). ──────
  const supabase = await createClient()
  const myUid = user?.id ?? null

  // Warehouses this user keeps (store_manager_id). Anyone named a store's keeper
  // gets the storekeeper tiles + can issue, whatever their base role. Admins too.
  const { data: keptWh } = myUid
    ? await supabase.from('inv_warehouses').select('id').eq('store_manager_id', myUid)
    : { data: [] }
  const myWarehouseIds = (keptWh ?? []).map(w => w.id as string)
  const canStore = myWarehouseIds.length > 0 || role === 'store_manager' || canAdmin
  const NIL_UUID = '00000000-0000-0000-0000-000000000000'

  const [
    hopCount,
    storeCount,
    gatePassPendingCount,
    myRejectedCount,
    myOutstandingReturnsCount,
    lowStockCount,
    itemCount,
    myOpenCount,
  ] = await Promise.all([
    // Atm Head queue (only when the dial actually routes through approval)
    (approvalsActive && (role === 'head' || role === 'hop' || canAdmin))
      ? supabase.from('inv_requests').select('id', { count: 'exact', head: true }).eq('status', PENDING_HOP).then(r => r.count ?? 0)
      : Promise.resolve(null),
    // Store queue (ready to issue) — the keeper's own store(s); admin sees all.
    canStore
      ? (canAdmin
          ? supabase.from('inv_requests').select('id', { count: 'exact', head: true }).in('status', TO_ISSUE).then(r => r.count ?? 0)
          : supabase.from('inv_requests').select('id', { count: 'exact', head: true }).in('status', TO_ISSUE).in('warehouse_id', myWarehouseIds.length > 0 ? myWarehouseIds : [NIL_UUID]).then(r => r.count ?? 0))
      : Promise.resolve(null),
    // Issued requests still awaiting the signed gate pass (keeper's stores;
    // admin sees all). This is the keeper's follow-up queue now that the gate
    // pass — not an engineer tap — closes a request.
    canStore
      ? (canAdmin
          ? supabase.from('inv_requests').select('id', { count: 'exact', head: true }).eq('status', 'ISSUED').is('engineer_acknowledged_at', null).then(r => r.count ?? 0)
          : supabase.from('inv_requests').select('id', { count: 'exact', head: true }).eq('status', 'ISSUED').is('engineer_acknowledged_at', null).in('warehouse_id', myWarehouseIds.length > 0 ? myWarehouseIds : [NIL_UUID]).then(r => r.count ?? 0))
      : Promise.resolve(0),
    // My rejected requests (engineer only)
    myUid
      ? supabase.from('inv_requests')
          .select('id', { count: 'exact', head: true })
          .eq('engineer_id', myUid)
          .in('status', REJECTED)
          .then(r => r.count ?? 0)
      : Promise.resolve(0),
    // Outstanding returnable lines (engineer's own; admins see all)
    (myUid || canAdmin)
      ? supabase.from('inv_request_items')
          .select('id, issued_qty, returned_good_qty, returned_damaged_qty, inv_requests!inner(engineer_id, status)', { count: 'exact', head: false })
          .eq('is_returnable', true)
          .in('inv_requests.status', ['ISSUED', 'EMERGENCY_ISSUED', 'CLOSED'])
          .then(r => {
            const rows = (r.data ?? []) as Array<{
              id: string; issued_qty: number; returned_good_qty: number; returned_damaged_qty: number;
              inv_requests: { engineer_id: string; status: string } | Array<{ engineer_id: string; status: string }>
            }>
            return rows.filter(row => {
              const req = Array.isArray(row.inv_requests) ? row.inv_requests[0] : row.inv_requests
              if (!canAdmin && req?.engineer_id !== myUid) return false
              // Only what was actually handed over can be returned.
              const outstanding = Number(row.issued_qty) - Number(row.returned_good_qty) - Number(row.returned_damaged_qty)
              return outstanding > 0
            }).length
          })
      : Promise.resolve(0),
    // Low-stock items across all stores — badges the Stock tile.
    supabase.from('inv_stock_available').select('id', { count: 'exact', head: true }).eq('is_low_stock', true).then(r => r.count ?? 0),
    // Total live catalogue size — the Stock tile's headline stat.
    supabase.from('inv_items').select('id', { count: 'exact', head: true }).is('deleted_at', null).eq('is_active', true).then(r => r.count ?? 0),
    // My open requests (anything I raised that isn't finished/cancelled) — the
    // "My requests" tile's at-a-glance stat.
    myUid
      ? supabase.from('inv_requests')
          .select('id', { count: 'exact', head: true })
          .eq('engineer_id', myUid)
          .not('status', 'in', '(CLOSED,CANCELLED_BY_ENGINEER)')
          .then(r => r.count ?? 0)
      : Promise.resolve(0),
  ])

  // ─── Section tiles — each carries a LIVE one-line stat so the landing
  //     reads like a status board (not just buttons); an accent fires only
  //     when something is actually waiting on this user, so it never gets
  //     noisy. Pure-action tiles stay quiet. ─────────────────────────────
  type BadgeStyle = 'amber' | 'rose' | 'emerald' | 'blue'
  type Accent = 'danger' | 'warning' | 'none'
  type Section = {
    slug: string; href: string; title: string; subtitle?: string
    icon: React.ComponentType<{ className?: string }>; show: boolean
    badge?: number | null
    badgeStyle?: BadgeStyle
    stat?: string          // live status line (overrides subtitle when present)
    accent?: Accent        // colours the icon + edge when action is pending
  }
  const nf = (n: number) => n.toLocaleString('en-IN')
  const openReqStat = myOpenCount > 0
    ? `${nf(myOpenCount)} open${myRejectedCount > 0 ? ` · ${nf(myRejectedCount)} rejected` : ''}`
    : undefined
  const main: Section[] = ([
    { slug: 'inv-stock',            href: '/inventory/stock',            title: 'Stock',          icon: Boxes,         show: true,
      stat: `${nf(itemCount)} items${lowStockCount > 0 ? ` · ${nf(lowStockCount)} low` : ''}`,
      subtitle: 'Live warehouse levels',
      badge: lowStockCount, badgeStyle: 'rose', accent: lowStockCount > 0 ? 'danger' : 'none' },
    { slug: 'inv-request-new',      href: '/inventory/requests/new',     title: 'Raise request',  subtitle: 'New material need',  icon: ClipboardList, show: role === 'engineer' || canEdit || canAdmin },
    { slug: 'inv-requests',         href: '/inventory/requests',         title: 'My requests',    icon: FileText,     show: true,
      stat: openReqStat, subtitle: 'Everything I raised',
      badge: myRejectedCount, badgeStyle: 'rose',
      accent: myRejectedCount > 0 ? 'danger' : 'none' },
    { slug: 'inv-inbox-hop',        href: '/inventory/inbox/hop',        title: 'Approvals',      icon: ShieldCheck, show: approvalsActive && (role === 'head' || role === 'hop' || canAdmin),
      stat: (hopCount ?? 0) > 0 ? `${nf(hopCount ?? 0)} to approve` : undefined, subtitle: 'Requests to OK',
      badge: hopCount, badgeStyle: 'amber', accent: (hopCount ?? 0) > 0 ? 'warning' : 'none' },
    { slug: 'inv-inbox-store',      href: '/inventory/inbox/store',      title: 'To issue',       icon: Truck,     show: canStore,
      stat: [ (storeCount ?? 0) > 0 ? `${nf(storeCount ?? 0)} to issue` : null, gatePassPendingCount > 0 ? `${nf(gatePassPendingCount)} gate pass` : null ].filter(Boolean).join(' · ') || undefined,
      subtitle: 'Hand over · upload gate pass',
      badge: (storeCount ?? 0) + gatePassPendingCount, badgeStyle: 'blue',
      accent: ((storeCount ?? 0) > 0 || gatePassPendingCount > 0) ? 'warning' : 'none' },
    { slug: 'inv-site-stock',       href: '/inventory/site-stock',       title: 'Site stock check', subtitle: 'Weekly count of what’s on site', icon: ClipboardCheck, show: true },
    { slug: 'inv-receipt',          href: '/inventory/receipt',          title: 'Stock receipt',  subtitle: 'Record vendor delivery', icon: PackagePlus,   show: canStore },
    { slug: 'inv-stock-ops',        href: '/inventory/stock-ops',        title: 'Stock corrections', subtitle: 'Count · transfer · damage', icon: Wrench,   show: canStore },
    // Reports are management-facing: storekeepers + admin, and also view-only
    // management (Founder/Viewer) — the reports are built for them. Hidden from
    // engineers/heads (canEdit && not a keeper), who don't need it.
    { slug: 'inv-reports',          href: '/inventory/reports',          title: 'Reports',        subtitle: 'Daily movement · catalogue', icon: FileBarChart, show: canStore || canAdmin || !canEdit },
    { slug: 'inv-returns',          href: '/inventory/returns/new',      title: 'Returns',        icon: Undo2,         show: canEdit || canAdmin,
      stat: myOutstandingReturnsCount > 0 ? `${nf(myOutstandingReturnsCount)} to return` : undefined, subtitle: 'Log returnable items',
      badge: myOutstandingReturnsCount, badgeStyle: 'amber', accent: myOutstandingReturnsCount > 0 ? 'warning' : 'none' },
  ] as Section[]).filter(s => s.show)

  const adminSections: Section[] = [
    { slug: 'inv-admin-warehouses', href: '/inventory/admin/warehouses', title: 'Warehouses',    icon: Building2,         show: canAdmin },
    { slug: 'inv-admin-projects',   href: '/inventory/admin/projects',   title: 'Project stores', icon: Store,            show: canAdmin },
    { slug: 'inv-admin-engineers',  href: '/inventory/admin/engineers',  title: 'Engineer projects', icon: Users,         show: canAdmin },
    { slug: 'inv-admin-items',      href: '/inventory/admin/items',      title: 'Item master',   icon: Tag,               show: canAdmin },
    { slug: 'inv-admin-settings',   href: '/inventory/admin/settings',   title: 'Settings',      icon: SlidersHorizontal, show: canAdmin },
  ].filter(s => s.show)

  // Top callout — the SINGLE most urgent thing waiting on this user.
  const calloutQueue: { count: number; href: string; label: string } | null = (() => {
    if (hopCount && hopCount > 0)                  return { count: hopCount,        href: '/inventory/inbox/hop',        label: 'Approvals' }
    if (storeCount && storeCount > 0)              return { count: storeCount,      href: '/inventory/inbox/store',      label: 'To issue' }
    if (gatePassPendingCount > 0)                  return { count: gatePassPendingCount, href: '/inventory/inbox/store', label: 'Gate pass pending' }
    return null
  })()

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      <PageHeader title="Inventory" subtitle="Request material, issue it from the store, track it." />

      {calloutQueue && (
        <Card className="p-4 bg-amber-50 border-amber-200 text-sm flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <span className="text-amber-900">
            <b>{calloutQueue.count}</b> request{calloutQueue.count === 1 ? '' : 's'} waiting on you in <b>{calloutQueue.label}</b>.
          </span>
          <Link href={calloutQueue.href} className="text-amber-900 font-semibold underline-offset-2 hover:underline whitespace-nowrap">
            Open queue →
          </Link>
        </Card>
      )}

      {/* Main actions — live badges on every tile that has a queue */}
      {main.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {main.map(s => <Tile key={s.slug} section={s} />)}
        </div>
      ) : (
        <Card className="p-6 text-center text-sm text-gray-500">
          Nothing to show. Ask your admin to enable inventory sections you need.
        </Card>
      )}

      {/* Admin (only for admins). Promoted to full tiles in their own
          row so "Add new item" and "Add new warehouse" are obvious —
          the previous chip-link styling was too easy to miss. */}
      {adminSections.length > 0 && (
        <div className="pt-2 border-t border-gray-100 space-y-2">
          <p className="text-[11px] uppercase tracking-wide text-gray-500">Admin · setup</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {adminSections.map(s => (
              <Link key={s.slug} href={s.href}>
                <Card className="p-4 h-full hover:shadow-md hover:-translate-y-0.5 transition-all flex flex-col items-start gap-2 border-dashed bg-gray-50/40">
                  <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-orange-50 text-orange-700">
                    <s.icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-gray-900 leading-tight">{s.title}</h3>
                    <p className="text-[11px] text-gray-500 leading-tight mt-0.5">
                      {s.slug === 'inv-admin-items'      ? 'Add / edit materials catalogue' :
                       s.slug === 'inv-admin-warehouses' ? 'Add / edit physical stores' :
                       s.slug === 'inv-admin-projects'   ? "Each project's store + Atm Head" :
                       s.slug === 'inv-admin-engineers'  ? 'Assign engineers to sites' :
                       s.slug === 'inv-admin-settings'   ? 'Approval flow & options' : ''}
                    </p>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const BADGE_STYLES = {
  amber:   'bg-amber-100 text-amber-900 border-amber-200',
  rose:    'bg-rose-100 text-rose-900 border-rose-200',
  emerald: 'bg-emerald-100 text-emerald-900 border-emerald-200',
  blue:    'bg-blue-100 text-blue-900 border-blue-200',
} as const

// Icon-chip + left-edge + stat colour, keyed to whether the tile needs
// attention. 'none' keeps the calm green module look; 'warning'/'danger'
// light up only when a real queue is waiting.
const ACCENT_STYLES = {
  none:    { chip: 'bg-green-50 text-green-700', edge: 'border-l-transparent', stat: 'text-gray-500' },
  warning: { chip: 'bg-amber-50 text-amber-700', edge: 'border-l-amber-400',  stat: 'text-amber-700 font-medium' },
  danger:  { chip: 'bg-rose-50 text-rose-700',   edge: 'border-l-rose-400',   stat: 'text-rose-700 font-medium' },
} as const

function Tile({ section }: {
  section: {
    href: string; title: string; subtitle?: string; stat?: string
    icon: React.ComponentType<{ className?: string }>
    badge?: number | null
    badgeStyle?: keyof typeof BADGE_STYLES
    accent?: keyof typeof ACCENT_STYLES
  }
}) {
  const { href, title, subtitle, stat, icon: Icon, badge, badgeStyle = 'amber', accent = 'none' } = section
  const showBadge = typeof badge === 'number' && badge > 0
  const a = ACCENT_STYLES[accent]
  const line = stat ?? subtitle
  return (
    <Link href={href} className="group">
      <Card className={`relative h-full p-4 pl-[15px] flex flex-col items-start gap-3 border-l-[3px] ${a.edge} transition-all hover:shadow-md hover:-translate-y-0.5`}>
        {showBadge && (
          <span className={`absolute top-2.5 right-2.5 inline-flex items-center justify-center min-w-[1.5rem] h-5 px-1.5 rounded-full border text-[11px] font-bold tabular-nums ${BADGE_STYLES[badgeStyle]}`}>
            {badge! > 99 ? '99+' : badge}
          </span>
        )}
        <div className={`inline-flex h-11 w-11 items-center justify-center rounded-xl transition-colors ${a.chip}`}>
          <Icon className="h-[22px] w-[22px]" />
        </div>
        <div className="min-w-0 w-full">
          <h3 className="text-sm font-semibold text-gray-900 leading-tight">{title}</h3>
          {line && <p className={`text-xs leading-tight mt-1 tabular-nums truncate ${stat ? a.stat : 'text-gray-500'}`}>{line}</p>}
        </div>
      </Card>
    </Link>
  )
}
