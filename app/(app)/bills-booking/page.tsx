import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requirePermission, getMyPermissions, can } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { QueryError } from '@/components/ui/query-error'
import { EmptyState } from '@/components/ui/empty-state'
import { Plus, ArrowRight, ReceiptText } from 'lucide-react'
import { PIPELINE, stageDef, type BbStage } from '@/lib/bills-booking/stages'
import { StagePill } from './StagePill'

export const dynamic = 'force-dynamic'

const cr = (n: number) => {
  const v = Number(n || 0)
  if (v >= 1e7) return '₹' + (v / 1e7).toFixed(2) + ' Cr'
  if (v >= 1e5) return '₹' + (v / 1e5).toFixed(1).replace(/\.0$/, '') + ' L'
  return '₹' + v.toLocaleString('en-IN')
}
const daysSince = (iso: string | null) =>
  iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)) : 0

type Row = {
  id: string; order_type: string; order_no: string | null; bill_no: string | null; ra_no: string | null
  claimed_amount: number; net_amount: number | null; current_stage: BbStage; stage_since: string
  discipline: string | null; trust: string | null
  projects: { code: string } | { code: string }[] | null
  vendors: { name: string } | { name: string }[] | null
  vendor_text: string | null
}
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v)

export default async function BillsBookingPage() {
  const perms = await requirePermission('bills-booking', 'view')
  const canEdit = can(await getMyPermissions(), 'bills-booking', 'edit')
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('bb_bills')
    .select('id, order_type, order_no, bill_no, ra_no, claimed_amount, net_amount, current_stage, stage_since, discipline, trust, projects(code), vendors(name), vendor_text')
    .order('stage_since', { ascending: true })
  const rows = (data ?? []) as Row[]

  // Stage scoreboard (pipeline stages only)
  const board = PIPELINE.map(s => {
    const g = rows.filter(r => r.current_stage === s.key)
    return { s, n: g.length, v: g.reduce((a, r) => a + Number(r.net_amount ?? r.claimed_amount ?? 0), 0) }
  })

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-5">
      <PageHeader title="Bills Booking" back="/" subtitle="Contractor & vendor bills — entry to payment, one platform.">
        {canEdit && (
          <Link href="/bills-booking/new" className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
            <Plus className="h-4 w-4" /> New bill
          </Link>
        )}
      </PageHeader>

      {error ? (
        <QueryError what="the bills" message={error.message} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<ReceiptText className="h-8 w-8" />} title="No bills yet"
          description={canEdit ? 'Enter the first contractor or vendor bill to start the flow.' : 'Bills entered by the ERP team will appear here.'} />
      ) : (
        <>
          {/* Stage scoreboard */}
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">
            {board.map(({ s, n, v }) => (
              <div key={s.key} className="rounded-xl border border-gray-200 bg-white p-2.5">
                <div className="text-[10px] font-bold uppercase tracking-wide text-gray-400 truncate">{s.label}</div>
                <div className="mt-1 text-xl font-bold tabular-nums text-gray-900">{n}</div>
                <div className="text-[10.5px] text-gray-500 truncate">{cr(v)}</div>
              </div>
            ))}
          </div>

          {/* Bills */}
          <div className="space-y-2">
            {rows.map(r => {
              const vendor = one(r.vendors)?.name || r.vendor_text || '—'
              const project = one(r.projects)?.code || '—'
              const amt = Number(r.net_amount ?? r.claimed_amount ?? 0)
              return (
                <Link key={r.id} href={`/bills-booking/${r.id}`}
                  className="flex items-center gap-3 rounded-xl border border-gray-100 bg-white p-3.5 hover:border-gray-200 hover:bg-gray-50/50">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-gray-900 truncate">{vendor}</span>
                      <span className="rounded bg-slate-800 px-1.5 py-px text-[11px] font-bold text-white">{project}</span>
                      <span className="rounded border border-gray-200 px-1.5 py-px text-[11px] font-semibold text-gray-600">{r.order_type} {r.order_no || ''}</span>
                      {r.discipline && <span className="rounded bg-indigo-50 px-1.5 py-px text-[11px] font-semibold text-indigo-700">{r.discipline}</span>}
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      Bill {r.bill_no || '—'}{r.ra_no ? ` · RA ${r.ra_no}` : ''} · in stage {daysSince(r.stage_since)}d{r.trust ? ` · ${r.trust}` : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold tabular-nums text-gray-900">₹{amt.toLocaleString('en-IN')}</div>
                    <div className="mt-1"><StagePill stage={r.current_stage} /></div>
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0 text-gray-300" />
                </Link>
              )
            })}
          </div>
          <p className="text-center text-[11px] text-gray-400">
            {rows.length} live bills · Phase 1: entry → stage flow + audit. Desk-owner routing, IN4 reconciliation and reports come next. {stageDef('paid').label} bills drop off once the paid entry is done.
          </p>
        </>
      )}
    </div>
  )
}
