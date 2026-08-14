import Link from 'next/link'
import { requirePermission, getMyPermissions, can } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { QueryError } from '@/components/ui/query-error'
import { getSyncPreview } from '@/lib/warehouse/in4-sync-data'
import { getShowValues } from '@/lib/warehouse/data'
import { SyncClient } from './sync-client'
import { ChevronLeft } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function SyncPage() {
  await requirePermission('warehouse', 'view')
  const perms = await getMyPermissions()
  const canAdmin = can(perms, 'warehouse', 'admin')

  const [preview, showValues] = await Promise.all([getSyncPreview(), getShowValues()])

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
      <Link href="/warehouse/settings" className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-700">
        <ChevronLeft className="h-3.5 w-3.5" /> Warehouse settings
      </Link>
      <PageHeader
        title="Bring across from the IN4 uploads"
        subtitle="Everything below already comes in with the weekly Indent → PO upload. Nothing is written until you press the button at the bottom — this page only shows you what would change."
      />

      {preview.error && <QueryError message={preview.error} what="the uploaded IN4 data" />}

      {!canAdmin && (
        <Card className="p-3 shadow-sm text-[12.5px] text-amber-900 bg-amber-50 border-amber-200">
          You can see what would come across but not apply it — this adds items and purchase orders for
          everybody, so it is admin-only.
        </Card>
      )}

      {preview.lineCount === 0 && !preview.error && (
        <Card className="p-6 text-center shadow-sm">
          <p className="text-sm font-bold text-slate-800">Nothing has been uploaded yet.</p>
          <p className="text-[12.5px] text-slate-500 mt-1">
            Upload an IN4 report on the{' '}
            <Link href="/procurement-tracker" className="font-semibold text-emerald-700 hover:underline">
              Indent → PO Tracker
            </Link>{' '}
            first, then come back here.
          </p>
        </Card>
      )}

      {preview.lineCount > 0 && (
        <SyncClient
          plan={preview.plan}
          slots={preview.slots}
          lineCount={preview.lineCount}
          canAdmin={canAdmin}
          showValues={showValues}
        />
      )}
    </div>
  )
}
