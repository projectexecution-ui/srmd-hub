import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requirePermission, getMyPermissions, getMyProfile, can } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { QueryError } from '@/components/ui/query-error'
import { getControlReport } from '@/lib/warehouse/exception-data'
import { reportMeta } from '@/lib/warehouse/exceptions'
import type { ReportKey } from '@/lib/warehouse/exceptions'
import { todayIST } from '@/lib/warehouse/ledger'
import { ReportClient } from './report-client'
import { ChevronLeft } from 'lucide-react'

export const dynamic = 'force-dynamic'

function monthStart(day: string): string {
  return `${day.slice(0, 7)}-01`
}

export default async function ControlReportPage({
  params, searchParams,
}: {
  params: Promise<{ key: string }>
  searchParams: Promise<{ from?: string; to?: string }>
}) {
  const { key } = await params
  const sp = await searchParams
  await requirePermission('warehouse', 'view')

  const meta = reportMeta(key)
  if (!meta) notFound()

  const [perms, profile] = await Promise.all([getMyPermissions(), getMyProfile()])
  const showValues = can(perms, 'warehouse', 'admin') || !isValuesHiddenRole(profile?.role)

  const today = todayIST()
  // A position-as-at-today report ignores the period entirely, so it is not
  // given one — a filter that changes nothing is worse than no filter.
  const from = meta.usesPeriod ? (sp.from ?? monthStart(today)) : null
  const to = meta.usesPeriod ? (sp.to ?? today) : null

  const view = await getControlReport(key as ReportKey, { from, to, showValues })

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <Link href="/warehouse/reports" className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-700">
        <ChevronLeft className="h-3.5 w-3.5" /> Registers &amp; reports
      </Link>
      <PageHeader title={view.title} subtitle={view.blurb} />

      {view.error && <QueryError message={view.error} what={`the ${view.title} report`} />}

      <ReportClient
        view={view}
        usesPeriod={meta.usesPeriod}
        from={from}
        to={to}
        today={today}
        showValues={showValues}
        moneyLed={Boolean(meta.moneyLed)}
      />
    </div>
  )
}

/** Roles that see quantities but never money. Read from the module setting once
 *  Settings ships (S8). */
function isValuesHiddenRole(role: string | null | undefined): boolean {
  return role === 'security' || role === 'site_staff' || role === 'contractor'
}
