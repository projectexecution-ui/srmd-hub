import Link from 'next/link'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { QueryError } from '@/components/ui/query-error'
import { getRequestLanes } from '@/lib/warehouse/request-data'
import { getSettings, getShowValues } from '@/lib/warehouse/data'
import { isOn, approvalConfig } from '@/lib/warehouse/settings'
import { RULE_LABEL } from '@/lib/warehouse/requests'
import { formatINR } from '@/lib/warehouse/format'
import { RequestsClient } from './requests-client'
import { ChevronLeft, Plus } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function WarehouseRequestsPage() {
  await requirePermission('warehouse', 'view')
  const values = await getSettings()
  const on = isOn(values, 'wh_requests_on')
  const cfg = approvalConfig(values)

  // Never a blank screen with a disabled button and no explanation: if the
  // feature is off, say so and say who turns it on.
  if (!on) {
    return (
      <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4">
        <Link href="/warehouse" className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-700">
          <ChevronLeft className="h-3.5 w-3.5" /> Warehouse
        </Link>
        <PageHeader title="Requests" subtitle="Asking a store for material" />
        <Card className="p-4 shadow-sm bg-amber-50 border-amber-200 space-y-2">
          <p className="text-[13px] font-bold text-amber-900">Requests are switched off</p>
          <p className="text-[12.5px] text-amber-900">
            Material still moves — the storekeeper records an OUT entry when he hands it over. What is not
            being captured is <b>who asked, for what, and how long they waited</b>.
          </p>
          <p className="text-[12.5px] text-amber-900">
            An admin turns it on in{' '}
            <Link href="/warehouse/settings" className="font-bold underline">Settings ▸ The rules</Link>,
            under “Let engineers ask a store for material”.
          </p>
        </Card>
      </div>
    )
  }

  const [lanes, showValues] = await Promise.all([getRequestLanes(), getShowValues()])

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <Link href="/warehouse" className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-700">
        <ChevronLeft className="h-3.5 w-3.5" /> Warehouse
      </Link>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <PageHeader
          title="Requests"
          subtitle="What each site has asked a store for — sorted by whose move it is next, and how long it has waited."
        />
        <Link href="/warehouse/requests/new"
          className="rounded-lg bg-emerald-600 px-3 py-2 min-h-[40px] text-[12.5px] font-bold text-white
                     hover:bg-emerald-700 inline-flex items-center gap-1.5 flex-shrink-0">
          <Plus className="h-3.5 w-3.5" /> Ask for material
        </Link>
      </div>

      <p className="text-[11.5px] text-slate-500 px-0.5">
        <b>Approval rule:</b> {RULE_LABEL[cfg.rule].toLowerCase()}
        {cfg.rule === 'above_value' ? ` — over ${formatINR(cfg.threshold)}` : ''}
        {cfg.rule !== 'off' ? `, ${cfg.stages === 2 ? 'two approvals' : 'one approval'}` : ''}.
      </p>

      {lanes.error && <QueryError message={lanes.error} what="the requests" />}
      <RequestsClient lanes={lanes} showValues={showValues} />
    </div>
  )
}
