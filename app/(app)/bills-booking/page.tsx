import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getMyPermissions, can } from '@/lib/auth'
import { requireBillsAccess } from '@/lib/bills-booking/access'
import { PageHeader } from '@/components/PageHeader'
import { QueryError } from '@/components/ui/query-error'
import { EmptyState } from '@/components/ui/empty-state'
import { Plus, ReceiptText, Clock, Users, Landmark, PackageCheck, ShieldCheck, CalendarDays, FileQuestion, MapPin, ChevronRight } from 'lucide-react'
import { isTerminal, isOverSla, type BbStage } from '@/lib/bills-booking/stages'
import { BillingTree, type TrustNode, type Leaf } from './BillingTree'
import { WhoHolds } from './WhoHolds'
import { whoHoldsWhat, summarise, type PendingBill } from '@/lib/bills-booking/holding'
import { formatINRCompact } from '@/lib/utils'

export const dynamic = 'force-dynamic'
// One money rule for the whole section: compact on a headline tile, full
// rupees in a row. Both come from lib/utils now — this file, BillingTree and
// the detail page each carried their own version and they disagreed.
// The SLA maths moved to lib/bills-booking/stages.ts for the same reason, and
// because a component that reads Date.now() is impure.

type Row = {
  id: string; order_type: string; bill_type: string | null; bill_no: string | null
  claimed_amount: number; net_amount: number | null; current_stage: BbStage; stage_since: string
  discipline: string | null; trust: string | null; project_id: string | null
  wo_pending: boolean; amendment_flag: boolean; is_example: boolean; in4_subproject_id: number | null
  vendor_text: string | null
}

export default async function BillsBookingPage() {
  await requireBillsAccess()
  const perms = await getMyPermissions()
  const canEdit = can(perms, 'bills-booking', 'edit')
  const canAdmin = can(perms, 'bills-booking', 'admin')
  const supabase = await createClient()

  const COLS ='id, order_type, bill_type, bill_no, claimed_amount, net_amount, current_stage, stage_since, discipline, trust, project_id, wo_pending, amendment_flag, is_example, vendor_text, in4_subproject_id'

  // PostgREST stops at 1,000 rows and hands back the first page without a
  // word, so every KPI on this screen would quietly become a sample of the
  // newest thousand bills. The rest of the section pages; this page did not.
  const rows: Row[] = []
  let error: { message: string } | null = null
  for (let from = 0; ; from += 1000) {
    const { data, error: e } = await supabase.from('bb_bills').select(COLS)
      .order('created_at', { ascending: false }).range(from, from + 999)
    if (e) { error = e; break }
    const page = (data ?? []) as unknown as Row[]
    rows.push(...page)
    if (page.length < 1000) break
  }
  const { data: projData } = await supabase.from('projects').select('id, code, name, parent_project_id')
  type Proj = { code: string; name: string; parent: string | null }
  const proj = new Map<string, Proj>(
    (projData ?? []).map(p => [p.id as string, { code: p.code as string, name: p.name as string, parent: p.parent_project_id as string | null }]),
  )
  const amt = (r: Row) => Number(r.net_amount ?? r.claimed_amount ?? 0)
  const vendorOf = (r: Row) => r.vendor_text || '—'
  const projCode = (r: Row) => (r.project_id ? proj.get(r.project_id)?.code : '') || '—'

  // ── Insights ──
  // The walkthrough bills stay in the list, badged, and out of every figure.
  // A demo row counted as money is worse than no demo at all, and one flag on
  // the row means a screen cannot badge it and total it at the same time.
  const examples = rows.filter(r => r.is_example)
  const real = rows.filter(r => !r.is_example)
  const live = real.filter(r => !isTerminal(r.current_stage))
  const overSla = (r: Row) => isOverSla(r.current_stage, r.stage_since)
  const lateBills = live.filter(overSla)
  const woIssues = live.filter(r => r.wo_pending || r.amendment_flag)
  const paidCount = real.filter(r => r.current_stage === 'paid').length
  const pipelineValue = live.reduce((a, r) => a + amt(r), 0)

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
      isExample: b.is_example,
    }
    s.bills.push(leaf)
  }
  const tree = [...trusts.values()].sort((a, b) => b.value - a.value)

  // ── Who is holding which bill ──
  // The desk behind a bill is decided by bb_stage_members, which is the one
  // place those rules live. Resolving it per BILL would be a query each; the
  // answer only varies by (stage, project, discipline, sub-project), and a
  // section this size has a handful of those. So it is asked once per
  // combination, and a copy of the desk logic in TypeScript is avoided.
  const { data: { user } } = await supabase.auth.getUser()
  const meId = user?.id ?? null

  const deskKey = (r: Row) =>
    `${r.current_stage}|${r.project_id ?? ''}|${r.discipline ?? ''}|${r.in4_subproject_id ?? ''}`
  const liveForDesks = rows.filter(r => !isTerminal(r.current_stage))
  const combos = new Map<string, Row>()
  for (const r of liveForDesks) if (!combos.has(deskKey(r))) combos.set(deskKey(r), r)

  const memberIds = new Map<string, string[]>()
  await Promise.all([...combos].map(async ([k, r]) => {
    const { data } = await supabase.rpc('bb_stage_members', {
      p_stage: r.current_stage, p_project: r.project_id,
      p_disc: r.discipline, p_subproject: r.in4_subproject_id,
    })
    memberIds.set(k, ((data ?? []) as string[]).filter(Boolean))
  }))

  const allIds = [...new Set([...memberIds.values()].flat())]
  const nameOf = new Map<string, string>()
  if (allIds.length) {
    const { data: people } = await supabase.from('profiles').select('id, full_name, email').in('id', allIds)
    for (const p of people ?? []) nameOf.set(p.id as string, (p.full_name || p.email) as string)
  }

  const pending: PendingBill[] = liveForDesks.map(r => ({
    id: r.id,
    vendor: vendorOf(r),
    billNo: r.bill_no,
    orderType: r.order_type,
    // The building, whatever CT Hub can name it by — 32 of the 54 IN4
    // sub-projects carrying work orders have no CT Hub project at all.
    projectLabel: projCode(r),
    amount: amt(r),
    stage: r.current_stage,
    stageSince: r.stage_since,
    isExample: r.is_example,
    woPending: r.wo_pending,
    amendmentFlag: r.amendment_flag,
  }))
  const rowByBill = new Map(liveForDesks.map(r => [r.id, r]))
  const desks = whoHoldsWhat(pending, b => {
    const r = rowByBill.get(b.id)
    const ids = (r ? memberIds.get(deskKey(r)) : undefined) ?? []
    return {
      holders: ids.map(id => nameOf.get(id)).filter((n): n is string => !!n),
      // Being an admin lets you see every desk; it does not put you ON one.
      // Saying "yours" about a desk somebody else works would make the word
      // useless on the day the desks go live.
      mine: !!meId && ids.includes(meId),
    }
  })
  const holdSummary = summarise(desks)

  const KPIS = [
    { label: 'Live bills', value: String(live.length), tone: 'text-slate-900' },
    { label: 'In pipeline', value: formatINRCompact(pipelineValue), tone: 'text-indigo-700' },
    { label: 'Over SLA', value: String(lateBills.length), tone: lateBills.length ? 'text-rose-600' : 'text-gray-400' },
    { label: 'WO / amendment', value: String(woIssues.length), tone: woIssues.length ? 'text-amber-700' : 'text-gray-400' },
    { label: 'Paid', value: String(paidCount), tone: 'text-emerald-700' },
  ]

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <PageHeader title="Bills Approval" back="/" subtitle="Contractor & vendor bills — by trust, project and sub-project.">
        <div className="flex items-center gap-2">
          {canAdmin && (
            <Link href="/bills-booking/admin" className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
              <Users className="h-4 w-4" /> Desks
            </Link>
          )}
          {canEdit && (
            <Link href="/bills-booking/new" className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
              <Plus className="h-4 w-4" /> New bill
            </Link>
          )}
        </div>
      </PageHeader>

      {examples.length > 0 && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
          <b>{examples.length} example bills</b> are in the list below, badged <b>EXAMPLE</b>. They are seeded from real
          IN4 work orders so the figures behave, and they are left out of every total on this page.{' '}
          <Link href="/bills-booking/admin" className="font-semibold underline">Remove them</Link> when you are done.
        </p>
      )}

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

          {/* Pending bills, by the desk holding them.
              This replaced two blocks that were cuts of the same bills: a
              "Needs attention" list (flagged, biggest money first) and a
              stage strip (counts per stage). Both are in here — the flags as
              badges on the rows, the counts and money on each desk header —
              and neither now appears twice. */}
          <WhoHolds desks={desks} summary={holdSummary} />
          {/* The tree */}
          <BillingTree tree={tree} />

        </>
      )}

      {/* Reports and registers.
          Aksha, 15 Sep 2026: "does these Blocks are really needed to be in
          front or rather when Managmnet wants can refer". They are eight ways
          of looking BACK at what happened — none of them says what is on
          anybody's desk right now. So they are one line at the foot of the
          page, open when wanted, and the page itself opens on the work.
          A <details> rather than a component: no JavaScript, and it survives
          with the page in print. */}
      {canAdmin && (
      <details className="group rounded-xl border border-gray-200 bg-white">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold text-gray-700 min-h-[44px]">
          <ChevronRight className="h-4 w-4 text-gray-400 transition-transform group-open:rotate-90" />
          Reports &amp; registers
          <span className="text-[11px] font-normal text-gray-400">8 views over IN4 — retention, closure, sanctions, daily</span>
        </summary>
        <div className="grid grid-cols-2 gap-2 border-t border-gray-100 p-3 lg:grid-cols-4">
          {([
            { href: '/bills-booking/in-flight', icon: Clock, label: 'In flight', hint: 'Who is sitting on what' },
            { href: '/bills-booking/overview', icon: ReceiptText, label: 'Money waiting', hint: 'Open bills by project' },
            { href: '/bills-booking/retention', icon: Landmark, label: 'Retention', hint: 'Held and not given back' },
            { href: '/bills-booking/closure', icon: PackageCheck, label: 'Never closed', hint: 'No final bill, gone quiet' },
            { href: '/bills-booking/sanctions', icon: ShieldCheck, label: 'Sanctions', hint: 'What you approved vs IN4' },
            { href: '/bills-booking/daily', icon: CalendarDays, label: 'Daily report', hint: 'Paid, and at each trust' },
            { href: '/bills-booking/no-order', icon: FileQuestion, label: 'No work order', hint: 'Misc, and bills before the WO' },
            // Not an action, a place to look: which IN4 sub-projects still have
            // no CT Hub project and no Atm Head, so bills on them arrive with
            // nobody to go to. Separate from /bills-booking/admin, which is who
            // sits at each desk in the flow.
            { href: '/bills-booking/mapping', icon: MapPin, label: 'Where bills book', hint: 'Sub-project → project & Atm Head' },
          ] as const).map(v => (
            <Link key={v.href} href={v.href}
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 hover:border-indigo-300 hover:bg-indigo-50/40 min-h-[44px]">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-gray-800">
                <v.icon className="h-4 w-4 text-indigo-600" /> {v.label}
              </div>
              <div className="text-[11px] text-gray-500 mt-0.5">{v.hint}</div>
            </Link>
          ))}
        </div>
      </details>
      )}
    </div>
  )
}
