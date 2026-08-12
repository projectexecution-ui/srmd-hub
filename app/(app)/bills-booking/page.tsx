import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requirePermission, getMyPermissions, can } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { QueryError } from '@/components/ui/query-error'
import { EmptyState } from '@/components/ui/empty-state'
import { Plus, ReceiptText, AlertTriangle, Clock } from 'lucide-react'
import { PIPELINE, slaFor, isTerminal, type BbStage } from '@/lib/bills-booking/stages'
import { BillingTree, type TrustNode, type Leaf } from './BillingTree'

export const dynamic = 'force-dynamic'
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v)
const cr = (n: number) => {
  const v = Number(n || 0)
  if (v >= 1e7) return '₹' + (v / 1e7).toFixed(2) + ' Cr'
  if (v >= 1e5) return '₹' + (v / 1e5).toFixed(1).replace(/\.0$/, '') + ' L'
  return '₹' + v.toLocaleString('en-IN')
}
const daysIn = (iso: string | null) => (iso ? (Date.now() - new Date(iso).getTime()) / 86_400_000 : 0)

type Row = {
  id: string; order_type: string; bill_type: string | null; bill_no: string | null
  claimed_amount: number; net_amount: number | null; current_stage: BbStage; stage_since: string
  discipline: string | null; trust: string | null; project_id: string | null
  wo_pending: boolean; amendment_flag: boolean
  vendors: { name: string } | { name: string }[] | null; vendor_text: string | null
}

export default async function BillsBookingPage() {
  await requirePermission('bills-booking', 'view')
  const canEdit = can(await getMyPermissions(), 'bills-booking', 'edit')
  const supabase = await createClient()

  const [{ data: billData, error }, { data: projData }] = await Promise.all([
    supabase.from('bb_bills')
      .select('id, order_type, bill_type, bill_no, claimed_amount, net_amount, current_stage, stage_since, discipline, trust, project_id, wo_pending, amendment_flag, vendors(name), vendor_text')
      .order('created_at', { ascending: false }),
    supabase.from('projects').select('id, code, name, parent_project_id'),
  ])
  const rows = (billData ?? []) as Row[]
  type Proj = { code: string; name: string; parent: string | null }
  const proj = new Map<string, Proj>(
    (projData ?? []).map(p => [p.id as string, { code: p.code as string, name: p.name as string, parent: p.parent_project_id as string | null }]),
  )
  const amt = (r: Row) => Number(r.net_amount ?? r.claimed_amount ?? 0)
  const vendorOf = (r: Row) => one(r.vendors)?.name || r.vendor_text || '—'
  const projCode = (r: Row) => (r.project_id ? proj.get(r.project_id)?.code : '') || '—'

  // ── Insights ──
  const live = rows.filter(r => !isTerminal(r.current_stage))
  const overSla = (r: Row) => { const s = slaFor(r.current_stage); return s != null && daysIn(r.stage_since) > s }
  const lateBills = live.filter(overSla)
  const woIssues = live.filter(r => r.wo_pending || r.amendment_flag)
  const paidCount = rows.filter(r => r.current_stage === 'paid').length
  const pipelineValue = live.reduce((a, r) => a + amt(r), 0)

  // Attention list (flagged), biggest money first
  const attention = live
    .filter(r => r.wo_pending || r.amendment_flag || overSla(r))
    .map(r => {
      const reason = r.amendment_flag ? { t: 'IN4 amendment', c: 'bg-rose-100 text-rose-700' }
        : r.wo_pending ? { t: 'No WO', c: 'bg-amber-100 text-amber-800' }
          : { t: `Over SLA ${Math.round(daysIn(r.stage_since))}d`, c: 'bg-orange-100 text-orange-800' }
      return { r, reason }
    })
    .sort((a, b) => amt(b.r) - amt(a.r))

  // Stage strip
  const stageStrip = PIPELINE.map(s => {
    const g = rows.filter(r => r.current_stage === s.key)
    return { s, n: g.length, v: g.reduce((a, r) => a + amt(r), 0) }
  }).filter(x => x.n > 0)

  // Tree
  const trusts = new Map<string, TrustNode>()
  const bump = (n: { n: number; value: number }, v: number) => { n.n += 1; n.value += v }
  for (const b of rows) {
    const v = amt(b)
    const p = b.project_id ? proj.get(b.project_id) : undefined
    const main = p?.parent ? proj.get(p.parent) : p
    const mainKey = p?.parent ?? b.project_id ?? '—'
    const mainLabel = main ? `${main.code} — ${main.name}` : 'Unassigned project'
    const isSub = !!p?.parent
    const subKey = isSub ? (b.project_id ?? '—') : '__direct__'
    const subLabel = isSub && p ? `${p.code} — ${p.name}` : 'Direct'
    const trustKey = (b.trust || '').trim() || 'No trust set'
    let t = trusts.get(trustKey)
    if (!t) { t = { key: trustKey, label: trustKey, n: 0, value: 0, mains: [] }; trusts.set(trustKey, t) }
    bump(t, v)
    let m = t.mains.find(x => x.key === mainKey)
    if (!m) { m = { key: mainKey, label: mainLabel, n: 0, value: 0, subs: [] }; t.mains.push(m) }
    bump(m, v)
    let s = m.subs.find(x => x.key === subKey)
    if (!s) { s = { key: subKey, label: subLabel, n: 0, value: 0, bills: [] }; m.subs.push(s) }
    bump(s, v)
    const leaf: Leaf = {
      id: b.id, vendor: vendorOf(b), billNo: b.bill_no, orderType: b.order_type,
      billType: b.bill_type, discipline: b.discipline, stage: b.current_stage, amount: v,
    }
    s.bills.push(leaf)
  }
  const tree = [...trusts.values()].sort((a, b) => b.value - a.value)

  const KPIS = [
    { label: 'Live bills', value: String(live.length), tone: 'text-slate-900' },
    { label: 'In pipeline', value: cr(pipelineValue), tone: 'text-indigo-700' },
    { label: 'Over SLA', value: String(lateBills.length), tone: lateBills.length ? 'text-rose-600' : 'text-gray-400' },
    { label: 'WO / amendment', value: String(woIssues.length), tone: woIssues.length ? 'text-amber-700' : 'text-gray-400' },
    { label: 'Paid', value: String(paidCount), tone: 'text-emerald-700' },
  ]

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <PageHeader title="Bills Booking" back="/" subtitle="Contractor & vendor bills — by trust, project and sub-project.">
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
          {/* KPIs — 2-up on mobile */}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
            {KPIS.map(k => (
              <div key={k.label} className="rounded-xl border border-gray-100 bg-white p-3">
                <div className="text-[10.5px] font-bold uppercase tracking-wide text-gray-400">{k.label}</div>
                <div className={`mt-1 text-xl font-bold tabular-nums ${k.tone}`}>{k.value}</div>
              </div>
            ))}
          </div>

          {/* Needs attention — the smart flags */}
          {attention.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 sm:p-4">
              <div className="mb-2 flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <p className="text-sm font-bold text-amber-900">Needs attention · {attention.length}</p>
              </div>
              <ul className="space-y-1.5">
                {attention.slice(0, 6).map(({ r, reason }) => (
                  <li key={r.id}>
                    <Link href={`/bills-booking/${r.id}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-white px-3 py-2 hover:bg-gray-50">
                      <span className="truncate text-[13px] font-semibold text-gray-900">{vendorOf(r)}</span>
                      <span className="rounded bg-slate-800 px-1.5 py-px text-[10px] font-bold text-white">{projCode(r)}</span>
                      <span className={`rounded px-1.5 py-px text-[10px] font-bold ${reason.c}`}>{reason.t}</span>
                      <span className="ml-auto text-[13px] font-bold tabular-nums text-gray-900">₹{amt(r).toLocaleString('en-IN')}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              {attention.length > 6 && <p className="mt-1.5 text-[11px] text-amber-700">+ {attention.length - 6} more flagged</p>}
            </div>
          )}

          {/* Where it sits — stage strip (scrolls on mobile) */}
          {stageStrip.length > 0 && (
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
              {stageStrip.map(({ s, n, v }) => (
                <div key={s.key} className="min-w-[104px] shrink-0 rounded-xl border border-gray-100 bg-white p-2.5">
                  <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-gray-400">
                    <Clock className="h-3 w-3" /> <span className="truncate">{s.label}</span>
                  </div>
                  <div className="mt-1 text-lg font-bold tabular-nums text-gray-900">{n}</div>
                  <div className="text-[10.5px] text-gray-500">{cr(v)}</div>
                </div>
              ))}
            </div>
          )}

          {/* The tree */}
          <BillingTree tree={tree} />
        </>
      )}
    </div>
  )
}
