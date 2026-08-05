import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { QueryError } from '@/components/ui/query-error'
import { FileText, ArrowRight, LogIn, LogOut, ArrowLeftRight } from 'lucide-react'
import { istDateStr, istDayRange } from '@/lib/inventory/day-window'
import { CatalogueActions, type CatalogueClientRow } from './CatalogueActions'

export const dynamic = 'force-dynamic'

const ENTRY = new Set(['receipt', 'return_good'])
const EXIT = new Set(['issue', 'damage'])
const TRANSFER = new Set(['transfer_out']) // one row per move

export default async function InventoryReportsPage() {
  await requirePermission('inventory', 'view')
  const supabase = await createClient()

  // The in-app card is LIVE (today so far). Only the scheduled email reports
  // yesterday (sent the next morning).
  const today = istDateStr()
  const { startUtc, endUtc, label: todayLabel } = istDayRange(today)

  const [itemsRes, stockRes, movesRes] = await Promise.all([
    supabase.from('inv_items')
      .select('id, code, name, description, unit, category, subcategory, hsn_code, image_url')
      .is('deleted_at', null).eq('is_active', true)
      .order('category').order('subcategory').order('code'),
    supabase.from('inv_stock').select('item_id, physical_qty'),
    supabase.from('inv_stock_movements')
      .select('movement_type')
      .gte('created_at', startUtc).lt('created_at', endUtc),
  ])

  const error = itemsRes.error || stockRes.error || movesRes.error

  // in-hand per item = physical qty summed across every store.
  const stockByItem = new Map<string, number>()
  for (const s of stockRes.data ?? []) {
    const id = s.item_id as string
    stockByItem.set(id, (stockByItem.get(id) ?? 0) + Number(s.physical_qty || 0))
  }

  const rows: CatalogueClientRow[] = (itemsRes.data ?? []).map(it => ({
    code: it.code,
    name: it.name,
    description: it.description,
    unit: it.unit,
    category: it.category,
    subcategory: it.subcategory,
    hsn_code: it.hsn_code,
    image_url: it.image_url,
    in_hand: stockByItem.get(it.id as string) ?? 0,
  }))

  const moves = movesRes.data ?? []
  const entriesToday = moves.filter(m => ENTRY.has(m.movement_type as string)).length
  const exitsToday = moves.filter(m => EXIT.has(m.movement_type as string)).length
  const transfersToday = moves.filter(m => TRANSFER.has(m.movement_type as string)).length

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      <PageHeader title="Reports" back="/inventory" subtitle="Share stock and movement with management." />

      {error && <QueryError what="the reports data" message={error.message} />}

      {/* Daily movement report */}
      <Card className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Daily movement report</h2>
            <p className="text-sm text-gray-500 mt-0.5">Entry, exit and transfers for a day — one click, and it can be emailed to management every morning.</p>
          </div>
          <Link href="/inventory/reports/daily"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-700 hover:underline whitespace-nowrap">
            Open report <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <MiniStat icon={LogIn} tone="emerald" label="Entries" value={entriesToday} />
          <MiniStat icon={LogOut} tone="rose" label="Exits" value={exitsToday} />
          <MiniStat icon={ArrowLeftRight} tone="blue" label="Transfers" value={transfersToday} />
        </div>
        <p className="text-xs text-gray-400">Today · {todayLabel} · live so far · the emailed report covers the previous day.</p>
      </Card>

      {/* Catalogue */}
      <Card className="p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-green-50 text-green-700 flex-shrink-0">
            <FileText className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-gray-900">Item catalogue</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Every item with photo, category &amp; sub-category, name, description and stock-in-hand — as a print-ready PDF or an Excel register.
            </p>
          </div>
        </div>
        <CatalogueActions rows={rows} generatedAtLabel="" />
        <p className="text-xs text-gray-400">
          {rows.length.toLocaleString('en-IN')} live items · in-hand summed across all stores. Items without a photo show a coloured monogram.
        </p>
      </Card>
    </div>
  )
}

function MiniStat({ icon: Icon, tone, label, value }: {
  icon: React.ComponentType<{ className?: string }>
  tone: 'emerald' | 'rose' | 'blue'
  label: string
  value: number
}) {
  const tones = {
    emerald: 'bg-emerald-50 text-emerald-700',
    rose: 'bg-rose-50 text-rose-700',
    blue: 'bg-blue-50 text-blue-700',
  } as const
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/50 p-3 flex items-center gap-3">
      <div className={`inline-flex h-9 w-9 items-center justify-center rounded-lg flex-shrink-0 ${tones[tone]}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-lg font-bold text-gray-900 tabular-nums leading-none">{value.toLocaleString('en-IN')}</p>
        <p className="text-[11px] text-gray-500 mt-0.5">{label}</p>
      </div>
    </div>
  )
}
