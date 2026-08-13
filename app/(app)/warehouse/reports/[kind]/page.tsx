import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { QueryError } from '@/components/ui/query-error'
import { getRegister } from '@/lib/warehouse/report-data'
import { getShowValues } from '@/lib/warehouse/data'
import { REGISTER_META } from '@/lib/warehouse/registers'
import type { GroupBy, RegisterKind } from '@/lib/warehouse/registers'
import { todayIST } from '@/lib/warehouse/ledger'
import { RegisterClient } from './register-client'
import { ChevronLeft } from 'lucide-react'

export const dynamic = 'force-dynamic'

const KINDS: RegisterKind[] = ['vendor-in', 'vendor-out', 'srm-in', 'srm-out']

/** Default period: this month so far. A register that opens on "all time" is
 *  slow and answers nothing; one that opens on "today" usually looks empty. */
function monthStart(day: string): string {
  return `${day.slice(0, 7)}-01`
}

export default async function RegisterPage({
  params, searchParams,
}: {
  params: Promise<{ kind: string }>
  searchParams: Promise<{ from?: string; to?: string; group?: string }>
}) {
  const { kind: raw } = await params
  const sp = await searchParams
  await requirePermission('warehouse', 'view')

  if (!KINDS.includes(raw as RegisterKind)) notFound()
  const kind = raw as RegisterKind
  const meta = REGISTER_META[kind]

  const showValues = await getShowValues()

  const today = todayIST()
  const from = sp.from || monthStart(today)
  const to = sp.to || today
  const group: GroupBy = meta.groupOptions.includes(sp.group as GroupBy)
    ? (sp.group as GroupBy)
    : meta.defaultGroup

  const { rows, error } = await getRegister(kind, from, to)

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <Link href="/warehouse/reports" className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-700">
        <ChevronLeft className="h-3.5 w-3.5" /> Registers &amp; reports
      </Link>
      <PageHeader title={meta.title} subtitle={meta.blurb} />

      {error && <QueryError message={error} what={`the ${meta.title} register`} />}

      <RegisterClient
        kind={kind}
        rows={rows}
        from={from}
        to={to}
        today={today}
        group={group}
        showValues={showValues}
        failed={Boolean(error)}
      />
    </div>
  )
}

