import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requirePermission, can, getMyProfile, getDisabledModuleSlugs, isPortalOwner } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { StatPill } from '@/components/ui/stat-pill'
import {
  Boxes, ClipboardList, Inbox, Truck, FileText, Undo2,
  Building2, Tag, PackagePlus, ShieldCheck,
} from 'lucide-react'
import type { Role } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function InventoryLandingPage() {
  const perms = await requirePermission('inventory', 'view')
  const [profile, disabledSlugs, portalOwner] = await Promise.all([
    getMyProfile(),
    getDisabledModuleSlugs(),
    isPortalOwner(),
  ])
  const role: Role | null = profile?.role ?? null
  const canEdit  = can(perms, 'inventory', 'edit')
  const canAdmin = can(perms, 'inventory', 'admin')
  // True iff the section is actually enabled (ignores portal-owner override).
  const isEnabled = (slug: string) => !disabledSlugs.has(slug)

  const supabase = await createClient()

  // Headline counts (everyone with view gets these)
  const [warehouses, items, stockRows, pendingBackoffice, pendingHop, approved] = await Promise.all([
    supabase.from('inv_warehouses').select('id', { count: 'exact', head: true }),
    supabase.from('inv_items').select('id', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('inv_stock').select('id', { count: 'exact', head: true }),
    supabase.from('inv_requests').select('id', { count: 'exact', head: true }).eq('status', 'PENDING_BACKOFFICE'),
    supabase.from('inv_requests').select('id', { count: 'exact', head: true }).eq('status', 'PENDING_HOP'),
    supabase.from('inv_requests').select('id', { count: 'exact', head: true }).eq('status', 'APPROVED'),
  ])

  // Role-based section tiles. Each carries a Portal-Owner-toggleable
  // slug (see lib/modules.ts → INVENTORY_SECTIONS) so the Portal Owner
  // can hide any of these from /admin/dashboard-modules.
  const sections: Array<{
    slug: string; href: string; title: string; sub: string;
    icon: React.ComponentType<{ className?: string }>;
    show: boolean; dimmed?: boolean;
  }> = [
    { slug: 'inv-stock',            href: '/inventory/stock',            title: 'Stock at warehouses', icon: Boxes,        sub: 'See available qty per item at your assigned warehouse.', show: true },
    { slug: 'inv-request-new',      href: '/inventory/requests/new',     title: 'Raise a request',     icon: ClipboardList, sub: 'Engineer raises a material request for site work.',        show: role === 'engineer' || canEdit || canAdmin },
    { slug: 'inv-requests',         href: '/inventory/requests',         title: 'My requests',         icon: FileText,      sub: 'Track status of requests you have raised.',                show: true },
    { slug: 'inv-inbox-backoffice', href: '/inventory/inbox/backoffice', title: 'Backoffice inbox',    icon: Inbox,         sub: 'Approve / reject pending requests, reserve stock.',        show: role === 'backoffice' || role === 'backoffice_backup' || canAdmin },
    { slug: 'inv-inbox-hop',        href: '/inventory/inbox/hop',        title: 'HoP inbox',           icon: ShieldCheck,   sub: 'Final approval. Emergency bypass authority.',              show: role === 'hop' || canAdmin },
    { slug: 'inv-inbox-store',      href: '/inventory/inbox/store',      title: 'Store inbox',         icon: Truck,         sub: 'Issue approved requests, log actual qty handed over.',     show: role === 'store_manager' || canAdmin },
    { slug: 'inv-receipt',          href: '/inventory/receipt',          title: 'Stock receipt',       icon: PackagePlus,   sub: 'Record vendor delivery into a warehouse.',                 show: role === 'store_manager' || canAdmin },
    { slug: 'inv-returns',          href: '/inventory/returns/new',      title: 'Log a return',        icon: Undo2,         sub: 'Return surplus / damaged material back to store.',         show: canEdit || canAdmin },
    { slug: 'inv-admin-warehouses', href: '/inventory/admin/warehouses', title: 'Warehouses',          icon: Building2,     sub: 'Master list of physical stores.',                          show: canAdmin },
    { slug: 'inv-admin-items',      href: '/inventory/admin/items',      title: 'Item master',         icon: Tag,           sub: 'Catalog of materials with codes, units, images.',          show: canAdmin },
  ]
    .filter(t => t.show)
    .filter(t => portalOwner || isEnabled(t.slug))
    .map(t => ({ ...t, dimmed: portalOwner && !isEnabled(t.slug) }))

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      <PageHeader
        title="Inventory"
        subtitle="Warehouses, items, stock & material requests"
      />

      {/* Headline stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatPill label="Warehouses"        value={warehouses.count ?? 0} icon={<Building2 className="h-5 w-5" />} />
        <StatPill label="Active items"      value={items.count ?? 0}      icon={<Tag className="h-5 w-5" />} />
        <StatPill label="Stock rows"        value={stockRows.count ?? 0}  icon={<Boxes className="h-5 w-5" />} />
        <StatPill label="Pending approval"  value={(pendingBackoffice.count ?? 0) + (pendingHop.count ?? 0)} icon={<Inbox className="h-5 w-5" />} />
      </div>

      {/* Approval state strip — only useful if user can act on requests */}
      {(role === 'backoffice' || role === 'backoffice_backup' || role === 'hop' || role === 'store_manager' || canAdmin) && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <StatPill label="Backoffice queue" value={pendingBackoffice.count ?? 0} icon={<Inbox className="h-5 w-5" />} />
          <StatPill label="HoP queue"        value={pendingHop.count ?? 0}        icon={<ShieldCheck className="h-5 w-5" />} />
          <StatPill label="Store to issue"   value={approved.count ?? 0}          icon={<Truck className="h-5 w-5" />} />
        </div>
      )}

      {/* Section tiles */}
      <section>
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500 mb-3">Sections</h2>
        {sections.length === 0 ? (
          <Card className="p-6 text-sm text-gray-500 text-center">
            You don&apos;t have access to any inventory sections yet.
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {sections.map(s => (
              <SectionTile key={s.href} href={s.href} title={s.title} sub={s.sub} icon={s.icon} dimmed={s.dimmed} />
            ))}
          </div>
        )}
      </section>

    </div>
  )
}

function SectionTile({
  href, title, sub, icon: Icon, dimmed,
}: {
  href: string; title: string; sub: string;
  icon: React.ComponentType<{ className?: string }>; dimmed?: boolean;
}) {
  const inner = (
    <Card className={`relative p-4 md:p-5 h-full hover:shadow-md hover:-translate-y-0.5 transition-all ${dimmed ? 'opacity-60' : ''}`}>
      <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-green-50 text-green-700 mb-3">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="text-sm md:text-base font-semibold text-gray-900 leading-tight">{title}</h3>
      <p className="text-xs text-gray-500 mt-1 line-clamp-2">{sub}</p>
      {dimmed && (
        <span className="absolute top-3 right-3 text-[10px] uppercase tracking-wide font-bold text-rose-500">
          Hidden
        </span>
      )}
    </Card>
  )
  return <Link href={href}>{inner}</Link>
}
