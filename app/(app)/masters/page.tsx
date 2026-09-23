import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { MastersBody } from './body'

export const dynamic = 'force-dynamic'

/** Masters landing. Since 23 Sep 2026 (Aksha, E1) Masters lives under
 *  Admin › Data rather than in the sidebar; this address still works for the
 *  sub-lists' Back links and old bookmarks. */
export default async function MastersPage() {
  await requirePermission('cost-control', 'view')
  return (
    <div className="space-y-4">
      <PageHeader
        title="Masters"
        back="/admin/data?tab=masters"
        subtitle="The lists everything else points at — read from IN4, the system that already holds them."
      />
      <MastersBody />
    </div>
  )
}
