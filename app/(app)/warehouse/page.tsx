import Link from 'next/link'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { createClient } from '@/lib/supabase/server'
import { ArrowDownToLine, ArrowUpFromLine, ClipboardList, Boxes, BarChart3, Settings2, ChevronRight, FileText } from 'lucide-react'

export const dynamic = 'force-dynamic'

const LANES = [
  { href: '/warehouse/in',       icon: ArrowDownToLine,  label: 'Gate IN',        blurb: 'Record a truck arriving — challan vs received, damage, PO balance' },
  { href: '/warehouse/po',       icon: FileText,         label: 'Purchase Orders', blurb: 'Pull a PO from IN4 so the gate screen can show what is still to come' },
  { href: '/warehouse/out',      icon: ArrowUpFromLine,  label: 'OUT to site',    blurb: 'Issue to a site for use, or move stock to another store' },
  { href: '/warehouse/count',    icon: ClipboardList,    label: 'Physical count', blurb: 'Walk a store and count what is actually there — the difference is named, witnessed and approved' },
  { href: '/warehouse/stock',    icon: Boxes,            label: 'Stock',          blurb: 'What lies where, as on a date',                            soon: true },
  { href: '/warehouse/reports',  icon: BarChart3,        label: 'Reports',        blurb: 'Registers, PO pending, vendor balance, exceptions',        soon: true },
  { href: '/warehouse/settings', icon: Settings2,        label: 'Settings',       blurb: 'Your lists, who works where, the control switches',        soon: true },
]

export default async function WarehouseHomePage() {
  await requirePermission('warehouse', 'view')
  const sb = await createClient()

  const [items, spots, todayIn] = await Promise.all([
    sb.from('wh_items').select('id', { count: 'exact', head: true }).is('deleted_at', null),
    sb.from('wh_locations').select('id', { count: 'exact', head: true }).not('parent_id', 'is', null).is('deleted_at', null),
    sb.from('wh_gate_in').select('id', { count: 'exact', head: true })
      .eq('entry_date', new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }))
      .is('deleted_at', null),
  ])

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
      <PageHeader
        title="Warehouse V2"
        subtitle="The main-gate material in-out register. Every truck in, every issue out, and the reports that show what went missing."
      />

      <div className="grid grid-cols-3 gap-2">
        {[
          { n: todayIn.count ?? 0, l: 'entries today' },
          { n: items.count ?? 0,   l: 'items in the master' },
          { n: spots.count ?? 0,   l: 'storage locations' },
        ].map(k => (
          <Card key={k.l} className="p-3 text-center shadow-sm">
            <div className="text-xl font-extrabold text-slate-800 tabular-nums">{k.n}</div>
            <div className="text-[11px] text-slate-500 mt-0.5">{k.l}</div>
          </Card>
        ))}
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        {LANES.map(lane => {
          const Icon = lane.icon
          const body = (
            <Card className={`p-4 shadow-sm h-full flex items-start gap-3 ${lane.soon ? 'opacity-55' : 'hover:border-emerald-300 hover:shadow transition'}`}>
              <span className="rounded-lg bg-emerald-50 p-2 flex-shrink-0">
                <Icon className="h-5 w-5 text-emerald-600" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="font-bold text-slate-800 text-sm flex items-center gap-1.5">
                  {lane.label}
                  {lane.soon
                    ? <span className="text-[9.5px] font-extrabold uppercase tracking-wide bg-slate-100 text-slate-500 rounded-full px-2 py-0.5">next</span>
                    : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
                </span>
                <span className="block text-[11.5px] text-slate-500 mt-1 leading-snug">{lane.blurb}</span>
              </span>
            </Card>
          )
          return lane.soon
            ? <div key={lane.href}>{body}</div>
            : <Link key={lane.href} href={lane.href} className="block">{body}</Link>
        })}
      </div>
    </div>
  )
}
