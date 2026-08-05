import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { QueryError } from '@/components/ui/query-error'
import { ChevronLeft, ChevronRight, LogIn, LogOut, ArrowLeftRight, PackageSearch } from 'lucide-react'
import { istDateStr, istShiftDate, istDayRange } from '@/lib/inventory/day-window'
import {
  bucketMovements, summarizeDigest, istTime, movementDetail,
  type MovementLine, type TransferLine, type DigestSummary,
} from '@/lib/inventory/daily-movement'
import { fetchDayRawMovements } from '@/lib/inventory/fetch-movements'
import { DailyReportActions } from './DailyReportActions'

export const dynamic = 'force-dynamic'

const nf = (n: number) => Number(n || 0).toLocaleString('en-IN')

export default async function DailyMovementPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  await requirePermission('inventory', 'view')
  const supabase = await createClient()

  const sp = await searchParams
  const today = istDateStr()
  // Default to TODAY (live). Yesterday is only what the morning email reports.
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? '') ? sp.date! : today
  const { label } = istDayRange(date)
  const prev = istShiftDate(date, -1)
  const next = istShiftDate(date, 1)
  const isToday = date === today
  const isFuture = date > today
  const rel = isToday ? 'Today · ' : (date === istShiftDate(today, -1) ? 'Yesterday · ' : '')

  const { rows, error } = await fetchDayRawMovements(supabase, date)
  const report = bucketMovements(rows)
  const digest = summarizeDigest(report)
  const nothing = report.entries.length + report.exits.length + report.transfers.length + report.adjustments.length === 0

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      <PageHeader title="Daily movement" back="/inventory/reports" subtitle="Entry, exit and transfers for a single day." >
        <DailyReportActions report={report} dayLabel={label} date={date} />
      </PageHeader>

      {/* Date navigation */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <Link href={`/inventory/reports/daily?date=${prev}`}
            className="inline-flex items-center gap-1 h-9 px-3 rounded-lg border border-gray-200 bg-white text-sm hover:bg-gray-50">
            <ChevronLeft className="h-4 w-4" /> Prev
          </Link>
          {!isToday && (
            <Link href={`/inventory/reports/daily?date=${next}`}
              className={`inline-flex items-center gap-1 h-9 px-3 rounded-lg border border-gray-200 bg-white text-sm hover:bg-gray-50 ${isFuture ? 'pointer-events-none opacity-40' : ''}`}>
              Next <ChevronRight className="h-4 w-4" />
            </Link>
          )}
          <span className="ml-2 text-sm font-semibold text-gray-900">{rel}{label}</span>
        </div>
        <form className="flex items-center gap-2">
          <input type="date" name="date" defaultValue={date} max={today}
            className="h-9 rounded-lg border border-gray-200 bg-white px-2 text-sm" />
          <button type="submit" className="h-9 px-3 rounded-lg border border-gray-200 bg-white text-sm hover:bg-gray-50">Go</button>
        </form>
      </div>

      {error && <QueryError what="the day's movements" message={error.message} />}

      {/* Exceptions first — the few things worth a manager's eye */}
      <AttentionStrip digest={digest} />

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi icon={LogIn} tone="emerald" label="Entries" value={report.kpi.entries} />
        <Kpi icon={LogOut} tone="rose" label="Exits" value={report.kpi.exits} />
        <Kpi icon={ArrowLeftRight} tone="blue" label="Transfers" value={report.kpi.transfers} />
        <Kpi icon={PackageSearch} tone="gray" label="Items touched" value={report.kpi.itemsTouched} />
      </div>

      {nothing ? (
        <Card className="p-8 text-center text-sm text-gray-500">
          No stock movement was recorded on {label}.
        </Card>
      ) : (
        <div className="space-y-5">
          <MoveSection title="Entries — into store" tone="emerald" lines={report.entries} />
          <MoveSection title="Exits — out of store" tone="rose" lines={report.exits} />
          <TransferSection lines={report.transfers} />
          {report.adjustments.length > 0 && (
            <MoveSection title="Stock corrections" tone="violet" lines={report.adjustments} />
          )}
        </div>
      )}
    </div>
  )
}

// Exception-first: the few movements a manager should actually eyeball —
// emergencies, damage write-offs, and stock corrections — before the volume.
function AttentionStrip({ digest }: { digest: DigestSummary }) {
  const { emergencies, damage, corrections } = digest
  if (emergencies.length + damage.length + corrections.length === 0) return null
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 sm:p-4">
      <p className="text-[11px] font-bold uppercase tracking-wide text-amber-800 mb-2">Needs attention</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <ExcGroup title="Emergency issues" tone="rose" lines={emergencies} />
        <ExcGroup title="Damage / write-offs" tone="amber" lines={damage} />
        <ExcGroup title="Stock corrections" tone="violet" lines={corrections} />
      </div>
    </div>
  )
}

function ExcGroup({ title, tone, lines }: { title: string; tone: 'rose' | 'amber' | 'violet'; lines: MovementLine[] }) {
  if (lines.length === 0) return null
  const tones = { rose: 'text-rose-700', amber: 'text-amber-700', violet: 'text-violet-700' } as const
  const cap = 6
  const shown = lines.slice(0, cap)
  const more = lines.length - shown.length
  return (
    <div>
      <p className={`text-xs font-semibold ${tones[tone]} mb-1`}>{title} · {lines.length}</p>
      <ul className="space-y-1">
        {shown.map((l, i) => {
          const d = movementDetail(l)
          return (
            <li key={i} className="text-[11px] text-gray-700 leading-snug">
              <span className="font-medium text-gray-900">{l.itemName}</span> — {nf(l.qty)} {l.unit}
              <span className="text-gray-500"> · {l.store}</span>
              {d && <span className="text-gray-500"> · {d}</span>}
            </li>
          )
        })}
        {more > 0 && <li className="text-[11px] text-gray-400 italic">+ {more} more</li>}
      </ul>
    </div>
  )
}

function Kpi({ icon: Icon, tone, label, value }: {
  icon: React.ComponentType<{ className?: string }>
  tone: 'emerald' | 'rose' | 'blue' | 'gray'; label: string; value: number
}) {
  const tones = {
    emerald: 'bg-emerald-50 text-emerald-700',
    rose: 'bg-rose-50 text-rose-700',
    blue: 'bg-blue-50 text-blue-700',
    gray: 'bg-gray-100 text-gray-600',
  } as const
  return (
    <Card className="p-3 flex items-center gap-3">
      <div className={`inline-flex h-9 w-9 items-center justify-center rounded-lg flex-shrink-0 ${tones[tone]}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-xl font-bold text-gray-900 tabular-nums leading-none">{value.toLocaleString('en-IN')}</p>
        <p className="text-[11px] text-gray-500 mt-1">{label}</p>
      </div>
    </Card>
  )
}

const HEAD_TONE = {
  emerald: 'text-emerald-800 bg-emerald-50',
  rose: 'text-rose-800 bg-rose-50',
  blue: 'text-blue-800 bg-blue-50',
  violet: 'text-violet-800 bg-violet-50',
} as const

function MoveSection({ title, tone, lines }: {
  title: string; tone: keyof typeof HEAD_TONE; lines: MovementLine[]
}) {
  if (lines.length === 0) return null
  return (
    <div>
      <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold ${HEAD_TONE[tone]}`}>
        {title} · {lines.length}
      </div>
      <div className="mt-2 overflow-x-auto rounded-xl border border-gray-100">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-gray-500 text-xs">
              <th className="text-left font-medium px-3 py-2">Item &amp; details</th>
              <th className="text-left font-medium px-3 py-2">Type</th>
              <th className="text-left font-medium px-3 py-2">Store</th>
              <th className="text-left font-medium px-3 py-2">By</th>
              <th className="text-right font-medium px-3 py-2">Qty</th>
              <th className="text-right font-medium px-3 py-2 whitespace-nowrap">Time</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const detail = movementDetail(l)
              return (
                <tr key={i} className="border-t border-gray-100 align-top">
                  <td className="px-3 py-2 max-w-sm">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-medium text-gray-900">{l.itemName}</span>
                      {l.itemCode && <span className="font-mono text-[11px] text-gray-400">{l.itemCode}</span>}
                      {l.isEmergency && <span className="text-[10px] font-semibold uppercase tracking-wide text-rose-700 bg-rose-100 rounded px-1.5 py-0.5">emergency</span>}
                    </div>
                    {detail && <div className="text-[11px] text-gray-500 mt-0.5 leading-snug">{detail}</div>}
                  </td>
                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{l.type}</td>
                  <td className="px-3 py-2 text-gray-600">{l.store}</td>
                  <td className="px-3 py-2 text-gray-600">{l.actor}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums whitespace-nowrap">{nf(l.qty)} {l.unit}</td>
                  <td className="px-3 py-2 text-right text-gray-400 tabular-nums whitespace-nowrap">{istTime(l.at)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function TransferSection({ lines }: { lines: TransferLine[] }) {
  if (lines.length === 0) return null
  return (
    <div>
      <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold ${HEAD_TONE.blue}`}>
        Transfers — store to store · {lines.length}
      </div>
      <div className="mt-2 overflow-x-auto rounded-xl border border-gray-100">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-gray-500 text-xs">
              <th className="text-left font-medium px-3 py-2">Item</th>
              <th className="text-left font-medium px-3 py-2">From</th>
              <th className="text-left font-medium px-3 py-2">To</th>
              <th className="text-left font-medium px-3 py-2">By</th>
              <th className="text-right font-medium px-3 py-2">Qty</th>
              <th className="text-right font-medium px-3 py-2 whitespace-nowrap">Time</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((t, i) => (
              <tr key={i} className="border-t border-gray-100 align-top">
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-medium text-gray-900">{t.itemName}</span>
                    {t.itemCode && <span className="font-mono text-[11px] text-gray-400">{t.itemCode}</span>}
                  </div>
                  {t.remarks && <div className="text-[11px] text-gray-500 mt-0.5 leading-snug">{t.remarks}</div>}
                </td>
                <td className="px-3 py-2 text-gray-600">{t.fromStore}</td>
                <td className="px-3 py-2 text-gray-600">{t.toStore}</td>
                <td className="px-3 py-2 text-gray-600">{t.actor}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums whitespace-nowrap">{nf(t.qty)} {t.unit}</td>
                <td className="px-3 py-2 text-right text-gray-400 tabular-nums whitespace-nowrap">{istTime(t.at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
