import { createClient } from '@/lib/supabase/server'
import { requireBillsAccess } from '@/lib/bills-booking/access'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { loadUnpaidCerts } from '@/lib/bills-booking/load-money'
import { moneyAtRest, restByDesk, type Bucket, type Side } from '@/lib/bills-booking/money'
import type { BbStage } from '@/lib/bills-booking/stages'
import { formatINR, formatINRCompact } from '@/lib/utils'

export const dynamic = 'force-dynamic'

/** Where the money stands.
 *
 *  Aksha, 16 Sep 2026, screen E of the look-and-feel preview: "Build it". Not
 *  a list of bills — money at rest: by age, by project, by where it is in IN4,
 *  and by which CT desk holds it now that bills flow through the hub. The
 *  figures are all in the mirror; they were simply never added up this way.
 *
 *  The contractor and supplier sides are kept apart on purpose. A contractor
 *  bill is "not yet paid" when IN4 has not marked it Paid and nothing has been
 *  paid against it. A supplier bill's status comes over as a bare code with no
 *  name behind it, so that side says only "not marked paid". */
export default async function MoneyPage() {
  await requireBillsAccess()
  const sb = await createClient()

  const [certs, { data: bills }] = await Promise.all([
    loadUnpaidCerts(sb),
    sb.from('bb_bills').select('current_stage, claimed_amount, net_amount, is_example'),
  ])
  const m = moneyAtRest(certs)
  const byDesk = restByDesk((bills ?? []).map(b => ({
    stage: b.current_stage as BbStage,
    amount: Number(b.net_amount ?? b.claimed_amount ?? 0),
    isExample: !!b.is_example,
  })))
  const liveBills = (bills ?? []).filter(b => !b.is_example).length

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      <PageHeader title="Where the money stands" back="/bills-booking"
        subtitle="Bills raised in IN4 and not yet paid — read live from the mirror. Contractor and supplier sides kept apart." />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Tile label="Contractor bills not yet paid" value={formatINRCompact(m.wo.value)}
              sub={`${m.wo.bills} ${m.wo.bills === 1 ? 'bill' : 'bills'} · IN4 has not marked them Paid`} />
        <Tile label="Older than 90 days" value={formatINRCompact(m.wo.over90.value)} tone="rose"
              sub={`${m.wo.over90.bills} contractor ${m.wo.over90.bills === 1 ? 'bill' : 'bills'} — the ones to ask about first`} />
        <Tile label="Supplier bills, not marked paid" value={formatINRCompact(m.po.value)}
              sub={`${m.po.bills} ${m.po.bills === 1 ? 'bill' : 'bills'} · IN4 gives their status as a bare code`} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Bars title="Contractor · by age" buckets={m.wo.byAge} tones={['bg-emerald-500', 'bg-amber-500', 'bg-amber-600', 'bg-rose-400', 'bg-rose-600']} />
        <Bars title="Contractor · by project" buckets={m.wo.byProject} />
      </div>

      <Card className="p-4">
        <p className="mb-3 text-xs font-bold uppercase tracking-wide text-gray-400">Contractor · by where it is in IN4</p>
        <StatusGrid side={m.wo} />
      </Card>

      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-xs font-bold uppercase tracking-wide text-gray-400">By CT desk — bills in the hub</p>
          <p className="text-[11px] text-gray-500">{liveBills} live {liveBills === 1 ? 'bill' : 'bills'} · examples left out</p>
        </div>
        {byDesk.length === 0 ? (
          <p className="text-sm text-gray-500">
            No live bill is in the hub yet. As bills arrive from IN4 this fills in — what IN4 says and who at CT is
            holding it, read together.
          </p>
        ) : (
          <BarList buckets={byDesk} />
        )}
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Bars title="Supplier · by age" buckets={m.po.byAge} tones={['bg-emerald-500', 'bg-amber-500', 'bg-amber-600', 'bg-rose-400', 'bg-rose-600']} />
        <Bars title="Supplier · by project" buckets={m.po.byProject} />
      </div>

      <p className="text-[12px] text-gray-500">
        &ldquo;Not yet paid&rdquo; on the contractor side means a live certificate IN4 has not marked Paid and with nothing
        paid against it — both are read, because the mirror&apos;s paid-amount is empty on 419 certificates IN4 calls Paid.
        The supplier side reads nothing-paid alone; its status codes are shown as they arrive.
      </p>
    </div>
  )
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: 'rose' }) {
  return (
    <Card className={`p-4 ${tone === 'rose' ? 'border-rose-200' : ''}`}>
      <p className={`text-[11px] font-bold uppercase tracking-wide ${tone === 'rose' ? 'text-rose-700' : 'text-gray-500'}`}>{label}</p>
      <p className={`mt-1 text-2xl font-extrabold tabular-nums ${tone === 'rose' ? 'text-rose-700' : 'text-gray-900'}`}>{value}</p>
      <p className="mt-1 text-[12px] text-gray-600">{sub}</p>
    </Card>
  )
}

function Bars({ title, buckets, tones }: { title: string; buckets: Bucket[]; tones?: string[] }) {
  return (
    <Card className="p-4">
      <p className="mb-3 text-xs font-bold uppercase tracking-wide text-gray-400">{title}</p>
      <BarList buckets={buckets} tones={tones} />
    </Card>
  )
}

function BarList({ buckets, tones }: { buckets: Bucket[]; tones?: string[] }) {
  const max = Math.max(1, ...buckets.map(b => b.value))
  if (buckets.every(b => b.bills === 0)) return <p className="text-sm text-gray-400">Nothing here.</p>
  return (
    <div className="space-y-2.5 text-[12.5px]">
      {buckets.map((b, i) => (
        <div key={b.key}>
          <div className="flex justify-between gap-3">
            <span className="min-w-0 truncate text-gray-700">{b.label} <span className="text-gray-400">· {b.bills}</span></span>
            <b className="shrink-0 tabular-nums">{formatINR(b.value)}</b>
          </div>
          <div className={`mt-1 h-2.5 rounded-md ${tones?.[i] ?? 'bg-indigo-600'}`}
               style={{ width: `${Math.max(b.value > 0 ? 1 : 0, Math.round((b.value / max) * 100))}%` }} />
        </div>
      ))}
    </div>
  )
}

function StatusGrid({ side }: { side: Side }) {
  if (side.byStatus.length === 0) return <p className="text-sm text-gray-400">Nothing here.</p>
  return (
    <div className="grid grid-cols-2 gap-2 text-[12.5px] md:grid-cols-5">
      {side.byStatus.map(s => (
        <div key={s.key} className="rounded-lg border border-gray-200 p-3">
          <p className="text-gray-500">{s.label}</p>
          <p className="text-base font-bold tabular-nums">{formatINRCompact(s.value)}</p>
          <p className="text-[11px] text-gray-400">{s.bills} {s.bills === 1 ? 'bill' : 'bills'}</p>
        </div>
      ))}
    </div>
  )
}
