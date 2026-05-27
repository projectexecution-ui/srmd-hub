import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requirePermission, can, getMyProfile, getDisabledModuleSlugs } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import {
  Boxes, ClipboardList, Inbox, Truck, FileText, Undo2,
  Building2, Tag, PackagePlus, ShieldCheck,
} from 'lucide-react'
import type { Role } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function InventoryLandingPage() {
  const perms = await requirePermission('inventory', 'view')
  const [profile, disabledSlugs] = await Promise.all([getMyProfile(), getDisabledModuleSlugs()])
  const role: Role | null = profile?.role ?? null
  const canEdit  = can(perms, 'inventory', 'edit')
  const canAdmin = can(perms, 'inventory', 'admin')
  const isEnabled = (slug: string) => !disabledSlugs.has(slug)

  // Just the count that's actually actionable for THIS user — nothing else
  // on the landing. Everything else lives on its own page.
  const supabase = await createClient()
  let myPendingCount = 0
  if (role === 'backoffice' || role === 'backoffice_backup' || role === 'store_manager') {
    const { count } = await supabase.from('inv_requests').select('id', { count: 'exact', head: true }).eq('status', 'PENDING_BACKOFFICE')
    myPendingCount = count ?? 0
  } else if (role === 'head' || role === 'hop') {
    const { count } = await supabase.from('inv_requests').select('id', { count: 'exact', head: true }).eq('status', 'PENDING_HOP')
    myPendingCount = count ?? 0
  }

  // ─── Section tiles — only show what's enabled AND relevant ─────
  type Section = { slug: string; href: string; title: string; icon: React.ComponentType<{ className?: string }>; show: boolean }
  const main: Section[] = [
    { slug: 'inv-stock',            href: '/inventory/stock',            title: 'Stock',          icon: Boxes,         show: true },
    { slug: 'inv-request-new',      href: '/inventory/requests/new',     title: 'Raise request',  icon: ClipboardList, show: role === 'engineer' || canEdit || canAdmin },
    { slug: 'inv-requests',         href: '/inventory/requests',         title: 'My requests',    icon: FileText,      show: true },
    { slug: 'inv-inbox-backoffice', href: '/inventory/inbox/backoffice', title: 'Availability check', icon: Inbox,    show: role === 'backoffice' || role === 'backoffice_backup' || role === 'store_manager' || canAdmin },
    { slug: 'inv-inbox-hop',        href: '/inventory/inbox/hop',        title: 'Atm Head approval',  icon: ShieldCheck, show: role === 'head' || role === 'hop' || canAdmin },
    { slug: 'inv-inbox-store',      href: '/inventory/inbox/store',      title: 'To issue',       icon: Truck,         show: role === 'store_manager' || canAdmin },
    { slug: 'inv-receipt',          href: '/inventory/receipt',          title: 'Stock receipt',  icon: PackagePlus,   show: role === 'store_manager' || canAdmin },
    { slug: 'inv-returns',          href: '/inventory/returns/new',      title: 'Returns',        icon: Undo2,         show: canEdit || canAdmin },
  ].filter(s => s.show && isEnabled(s.slug))

  const adminSections: Section[] = [
    { slug: 'inv-admin-warehouses', href: '/inventory/admin/warehouses', title: 'Warehouses',  icon: Building2, show: canAdmin },
    { slug: 'inv-admin-items',      href: '/inventory/admin/items',      title: 'Item master', icon: Tag,       show: canAdmin },
  ].filter(s => s.show && isEnabled(s.slug))

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      <PageHeader title="Inventory" />

      {myPendingCount > 0 && (
        <Card className="p-4 bg-amber-50 border-amber-200 text-sm flex items-center justify-between">
          <span className="text-amber-900">
            <b>{myPendingCount}</b> request{myPendingCount === 1 ? '' : 's'} waiting on you.
          </span>
          <Link
            href={role === 'head' || role === 'hop' ? '/inventory/inbox/hop' : '/inventory/inbox/backoffice'}
            className="text-amber-900 font-semibold underline-offset-2 hover:underline"
          >
            Open queue →
          </Link>
        </Card>
      )}

      {/* Main actions */}
      {main.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {main.map(s => <Tile key={s.slug} href={s.href} title={s.title} icon={s.icon} />)}
        </div>
      ) : (
        <Card className="p-6 text-center text-sm text-gray-500">
          Nothing to show. Ask your admin to enable inventory sections you need.
        </Card>
      )}

      {/* Admin (only for admins) — tucked at the bottom in a smaller row */}
      {adminSections.length > 0 && (
        <div className="pt-2 border-t border-gray-100">
          <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-2">Admin</p>
          <div className="flex flex-wrap gap-2">
            {adminSections.map(s => (
              <Link key={s.slug} href={s.href}
                className="inline-flex items-center gap-1.5 text-sm border border-gray-200 hover:border-gray-300 hover:bg-gray-50 rounded-lg px-3 py-1.5 text-gray-700">
                <s.icon className="h-4 w-4 text-gray-400" />
                {s.title}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Tile({ href, title, icon: Icon }: {
  href: string; title: string; icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Link href={href}>
      <Card className="p-4 h-full hover:shadow-md hover:-translate-y-0.5 transition-all flex flex-col items-start gap-2">
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-green-50 text-green-700">
          <Icon className="h-5 w-5" />
        </div>
        <h3 className="text-sm font-semibold text-gray-900 leading-tight">{title}</h3>
      </Card>
    </Link>
  )
}
