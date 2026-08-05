import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requirePermission, can, getMyProfile, getMyUser } from '@/lib/auth'
import { getInvSettings } from '@/lib/inventory/settings'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import {
  Boxes, ClipboardList, Truck, FileText, Undo2,
  Building2, Tag, PackagePlus, ShieldCheck, SlidersHorizontal, Store,
} from 'lucide-react'
import type { Role } from '@/lib/types'

export const dynamic = 'force-dynamic'

// Statuses by stage — single source of truth so the counts on tiles
// match exactly what the inbox pages show when you click them.
const PENDING_HOP        = 'PENDING_HOP'
const TO_ISSUE           = ['APPROVED', 'EMERGENCY_ISSUED']
const ENGINEER_ACTIONABLE = ['ISSUED', 'EMERGENCY_ISSUED']  // need receipt confirmation
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

  const [
    hopCount,
    storeCount,
    myAwaitingReceiptCount,
    myRejectedCount,
    myOutstandingReturnsCount,
  ] = await Promise.all([
    // Atm Head queue (only when the dial actually routes through approval)
    (approvalsActive && (role === 'head' || role === 'hop' || canAdmin))
      ? supabase.from('inv_requests').select('id', { count: 'exact', head: true }).eq('status', PENDING_HOP).then(r => r.count ?? 0)
      : Promise.resolve(null),
    // Store queue (ready to issue)
    (role === 'store_manager' || canAdmin)
      ? supabase.from('inv_requests').select('id', { count: 'exact', head: true }).in('status', TO_ISSUE).then(r => r.count ?? 0)
      : Promise.resolve(null),
    // My requests awaiting receipt confirmation (engineer only)
    myUid
      ? supabase.from('inv_requests')
          .select('id', { count: 'exact', head: true })
          .eq('engineer_id', myUid)
          .in('status', ENGINEER_ACTIONABLE)
          .is('engineer_acknowledged_at', null)
          .then(r => r.count ?? 0)
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
          .select('id, requested_qty, returned_good_qty, returned_damaged_qty, inv_requests!inner(engineer_id, status)', { count: 'exact', head: false })
          .eq('is_returnable', true)
          .in('inv_requests.status', ['ISSUED', 'EMERGENCY_ISSUED', 'CLOSED'])
          .then(r => {
            const rows = (r.data ?? []) as Array<{
              id: string; requested_qty: number; returned_good_qty: number; returned_damaged_qty: number;
              inv_requests: { engineer_id: string; status: string } | Array<{ engineer_id: string; status: string }>
            }>
            return rows.filter(row => {
              const req = Array.isArray(row.inv_requests) ? row.inv_requests[0] : row.inv_requests
              if (!canAdmin && req?.engineer_id !== myUid) return false
              const outstanding = Number(row.requested_qty) - Number(row.returned_good_qty) - Number(row.returned_damaged_qty)
              return outstanding > 0
            }).length
          })
      : Promise.resolve(0),
  ])

  // ─── Section tiles — show what's enabled + relevant; badge with
  //     live count when queue applies. ──────────────────────────────
  type BadgeStyle = 'amber' | 'rose' | 'emerald' | 'blue'
  type Section = {
    slug: string; href: string; title: string; subtitle?: string
    icon: React.ComponentType<{ className?: string }>; show: boolean
    badge?: number | null
    badgeStyle?: BadgeStyle
  }
  const main: Section[] = ([
    { slug: 'inv-stock',            href: '/inventory/stock',            title: 'Stock',          subtitle: 'Live warehouse levels', icon: Boxes,         show: true },
    { slug: 'inv-request-new',      href: '/inventory/requests/new',     title: 'Raise request',  subtitle: 'New material need',  icon: ClipboardList, show: role === 'engineer' || canEdit || canAdmin },
    { slug: 'inv-requests',         href: '/inventory/requests',         title: 'My requests',    subtitle: 'Everything I raised', icon: FileText,     show: true,
      badge: myAwaitingReceiptCount + myRejectedCount, badgeStyle: (myRejectedCount > 0 ? 'rose' : 'emerald') as BadgeStyle },
    { slug: 'inv-inbox-hop',        href: '/inventory/inbox/hop',        title: 'Approvals',      subtitle: 'Requests to OK', icon: ShieldCheck, show: approvalsActive && (role === 'head' || role === 'hop' || canAdmin),
      badge: hopCount, badgeStyle: 'amber' as BadgeStyle },
    { slug: 'inv-inbox-store',      href: '/inventory/inbox/store',      title: 'To issue',       subtitle: 'Hand over material', icon: Truck,     show: role === 'store_manager' || canAdmin,
      badge: storeCount, badgeStyle: 'blue' as BadgeStyle },
    { slug: 'inv-receipt',          href: '/inventory/receipt',          title: 'Stock receipt',  subtitle: 'Record vendor delivery', icon: PackagePlus,   show: role === 'store_manager' || canAdmin },
    { slug: 'inv-returns',          href: '/inventory/returns/new',      title: 'Returns',        subtitle: 'Log returnable items', icon: Undo2,         show: canEdit || canAdmin,
      badge: myOutstandingReturnsCount, badgeStyle: 'amber' as BadgeStyle },
  ] as Section[]).filter(s => s.show)

  const adminSections: Section[] = [
    { slug: 'inv-admin-warehouses', href: '/inventory/admin/warehouses', title: 'Warehouses',    icon: Building2,         show: canAdmin },
    { slug: 'inv-admin-projects',   href: '/inventory/admin/projects',   title: 'Project stores', icon: Store,            show: canAdmin },
    { slug: 'inv-admin-items',      href: '/inventory/admin/items',      title: 'Item master',   icon: Tag,               show: canAdmin },
    { slug: 'inv-admin-settings',   href: '/inventory/admin/settings',   title: 'Settings',      icon: SlidersHorizontal, show: canAdmin },
  ].filter(s => s.show)

  // Top callout — the SINGLE most urgent thing waiting on this user.
  const calloutQueue: { count: number; href: string; label: string } | null = (() => {
    if (hopCount && hopCount > 0)                  return { count: hopCount,        href: '/inventory/inbox/hop',        label: 'Approvals' }
    if (storeCount && storeCount > 0)              return { count: storeCount,      href: '/inventory/inbox/store',      label: 'To issue' }
    if (myAwaitingReceiptCount > 0)                return { count: myAwaitingReceiptCount, href: '/inventory/requests', label: 'Confirm receipt' }
    return null
  })()

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      <PageHeader title="Inventory" subtitle="Request material, issue it from the store, track it." />

      {calloutQueue && (
        <Card className="p-4 bg-amber-50 border-amber-200 text-sm flex items-center justify-between">
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

function Tile({ section }: {
  section: {
    href: string; title: string; subtitle?: string
    icon: React.ComponentType<{ className?: string }>
    badge?: number | null
    badgeStyle?: keyof typeof BADGE_STYLES
  }
}) {
  const { href, title, subtitle, icon: Icon, badge, badgeStyle = 'amber' } = section
  const showBadge = typeof badge === 'number' && badge > 0
  return (
    <Link href={href}>
      <Card className="p-4 h-full hover:shadow-md hover:-translate-y-0.5 transition-all flex flex-col items-start gap-2 relative">
        {showBadge && (
          <span className={`absolute top-2 right-2 inline-flex items-center justify-center min-w-[1.5rem] h-5 px-1.5 rounded-full border text-[11px] font-bold tabular-nums ${BADGE_STYLES[badgeStyle]}`}>
            {badge! > 99 ? '99+' : badge}
          </span>
        )}
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-green-50 text-green-700">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-900 leading-tight">{title}</h3>
          {subtitle && <p className="text-[11px] text-gray-500 leading-tight mt-0.5">{subtitle}</p>}
        </div>
      </Card>
    </Link>
  )
}
