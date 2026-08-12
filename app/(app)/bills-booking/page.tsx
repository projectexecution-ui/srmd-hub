import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requirePermission, getMyPermissions, can } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { QueryError } from '@/components/ui/query-error'
import { EmptyState } from '@/components/ui/empty-state'
import { Plus, ReceiptText } from 'lucide-react'
import { type BbStage } from '@/lib/bills-booking/stages'
import { BillingTree, type TrustNode, type Leaf } from './BillingTree'

export const dynamic = 'force-dynamic'
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v)

type Row = {
  id: string; order_type: string; bill_type: string | null; bill_no: string | null
  claimed_amount: number; net_amount: number | null; current_stage: BbStage; discipline: string | null
  trust: string | null; project_id: string | null
  vendors: { name: string } | { name: string }[] | null; vendor_text: string | null
}

export default async function BillsBookingPage() {
  await requirePermission('bills-booking', 'view')
  const canEdit = can(await getMyPermissions(), 'bills-booking', 'edit')
  const supabase = await createClient()

  const [{ data: billData, error }, { data: projData }] = await Promise.all([
    supabase.from('bb_bills')
      .select('id, order_type, bill_type, bill_no, claimed_amount, net_amount, current_stage, discipline, trust, project_id, vendors(name), vendor_text')
      .order('created_at', { ascending: false }),
    supabase.from('projects').select('id, code, name, parent_project_id'),
  ])
  const rows = (billData ?? []) as Row[]
  type Proj = { code: string; name: string; parent: string | null }
  const proj = new Map<string, Proj>(
    (projData ?? []).map(p => [p.id as string, { code: p.code as string, name: p.name as string, parent: p.parent_project_id as string | null }]),
  )

  // Build the Trust → Main project → Sub project tree from the bills.
  const trusts = new Map<string, TrustNode>()
  const bump = (n: { n: number; value: number }, amt: number) => { n.n += 1; n.value += amt }

  for (const b of rows) {
    const amt = Number(b.net_amount ?? b.claimed_amount ?? 0)
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
    bump(t, amt)
    let m = t.mains.find(x => x.key === mainKey)
    if (!m) { m = { key: mainKey, label: mainLabel, n: 0, value: 0, subs: [] }; t.mains.push(m) }
    bump(m, amt)
    let s = m.subs.find(x => x.key === subKey)
    if (!s) { s = { key: subKey, label: subLabel, n: 0, value: 0, bills: [] }; m.subs.push(s) }
    bump(s, amt)

    const leaf: Leaf = {
      id: b.id, vendor: one(b.vendors)?.name || b.vendor_text || '—',
      billNo: b.bill_no, orderType: b.order_type, billType: b.bill_type,
      discipline: b.discipline, stage: b.current_stage, amount: amt,
    }
    s.bills.push(leaf)
  }
  const tree = [...trusts.values()].sort((a, b) => b.value - a.value)
  const totalValue = rows.reduce((a, r) => a + Number(r.net_amount ?? r.claimed_amount ?? 0), 0)

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
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
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 rounded-xl border border-gray-100 bg-white px-4 py-3">
            <span className="text-sm text-gray-500">Live bills <b className="text-gray-900">{rows.length}</b></span>
            <span className="text-sm text-gray-500">Value <b className="text-gray-900">₹{totalValue.toLocaleString('en-IN')}</b></span>
            <span className="text-sm text-gray-500">Trusts <b className="text-gray-900">{tree.length}</b></span>
          </div>
          <BillingTree tree={tree} />
        </>
      )}
    </div>
  )
}
