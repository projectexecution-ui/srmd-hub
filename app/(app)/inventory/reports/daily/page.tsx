import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { QueryError } from '@/components/ui/query-error'
import { ChevronLeft, ChevronRight, LogIn, LogOut, ArrowLeftRight, PackageSearch } from 'lucide-react'
import { istDateStr, istShiftDate, istDayRange } from '@/lib/inventory/day-window'
import {
  bucketMovements, istTime, type RawMovement, type MovementLine, type TransferLine,
} from '@/lib/inventory/daily-movement'
import { DailyReportActions } from './DailyReportActions'

export const dynamic = 'force-dynamic'

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v)
const nf = (n: number) => Number(n || 0).toLocaleString('en-IN')

export default async function DailyMovementPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  await requirePermission('inventory', 'view')
  const supabase = await createClient()

  const sp = await searchParams
  const today = istDateStr()
  // Default to TODAY (live). Yesterday is only what the morning email reports.
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? '') ? sp.date! : today
  const { startUtc, endUtc, label } = istDayRange(date)
  const prev = istShiftDate(date, -1)
  const next = istShiftDate(date, 1)
  const isToday = date === today
  const isFuture = date > today
  const rel = isToday ? 'Today · ' : (date === istShiftDate(today, -1) ? 'Yesterday · ' : '')

  const { data: moves, error } = await supabase
    .from('inv_stock_movements')
    .select('movement_type, qty, remarks, created_at, item_id, warehouse_id, actor_id, inv_items(code, name, unit), inv_warehouses(code, name)')
    .gte('created_at', startUtc).lt('created_at', endUtc)
    .order('created_at')

  // Resolve actor display names in one round-trip.
  const actorIds = [...new Set((moves ?? []).map(m => m.actor_id as string | null).filter(Boolean) as string[])]
  const { data: actors } = actorIds.length
    ? await supabase.from('profiles').select('id, full_name, name').in('id', actorIds)
    : { data: [] as Array<{ id: string; full_name: string | null; name: string | null }> }
  const nameById = new Map((actors ?? []).map(a => [a.id as string, (a.full_name ?? a.name ?? 'Someone') as string]))

  const rows: RawMovement[] = (moves ?? []).map(m => {
    const it = one(m.inv_items as never) as { code?: string; name?: string; unit?: string } | null
    const wh = one(m.inv_warehouses as never) as { code?: string; name?: string } | null
    return {
      movement_type: m.movement_type as string,
      qty: Number(m.qty || 0),
      remarks: (m.remarks as string) ?? null,
      created_at: m.created_at as string,
      item_id: m.item_id as string,
      warehouse_id: m.warehouse_id as string,
      item_code: it?.code ?? '',
      item_name: it?.name ?? 'Item',
      unit: it?.unit ?? '',
      store_code: wh?.code ?? '',
      store_name: wh?.name ?? '',
      actor_name: (m.actor_id ? nameById.get(m.actor_id as string) : null) ?? 'Someone',
    }
  })

  const report = bucketMovements(rows)
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
            <MoveSection title="Stock corrections" tone="violet" lines={report.adjustments} showNote />
          )}
        </div>
      )}
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

function MoveSection({ title, tone, lines, showNote }: {
  title: string; tone: keyof typeof HEAD_TONE; lines: MovementLine[]; showNote?: boolean
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
              <th className="text-left font-medium px-3 py-2">Item</th>
              <th className="text-left font-medium px-3 py-2">Type</th>
              <th className="text-left font-medium px-3 py-2">Store</th>
              {showNote && <th className="text-left font-medium px-3 py-2">Note</th>}
              <th className="text-left font-medium px-3 py-2">By</th>
              <th className="text-right font-medium px-3 py-2">Qty</th>
              <th className="text-right font-medium px-3 py-2 whitespace-nowrap">Time</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="border-t border-gray-100">
                <td className="px-3 py-2">
                  <span className="font-medium text-gray-900">{l.itemName}</span>
                  {l.itemCode && <span className="ml-1.5 font-mono text-[11px] text-gray-400">{l.itemCode}</span>}
                </td>
                <td className="px-3 py-2 text-gray-600">{l.type}</td>
                <td className="px-3 py-2 text-gray-600">{l.store}</td>
                {showNote && <td className="px-3 py-2 text-gray-500">{l.remarks || '—'}</td>}
                <td className="px-3 py-2 text-gray-600">{l.actor}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums whitespace-nowrap">{nf(l.qty)} {l.unit}</td>
                <td className="px-3 py-2 text-right text-gray-400 tabular-nums whitespace-nowrap">{istTime(l.at)}</td>
              </tr>
            ))}
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
              <tr key={i} className="border-t border-gray-100">
                <td className="px-3 py-2">
                  <span className="font-medium text-gray-900">{t.itemName}</span>
                  {t.itemCode && <span className="ml-1.5 font-mono text-[11px] text-gray-400">{t.itemCode}</span>}
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
