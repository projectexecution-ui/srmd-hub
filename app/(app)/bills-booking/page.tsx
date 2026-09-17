import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requireBillsAccess } from '@/lib/bills-booking/access'
import { PageHeader } from '@/components/PageHeader'
import { QueryError } from '@/components/ui/query-error'
import { EmptyState } from '@/components/ui/empty-state'
import { Plus, ReceiptText, Clock, Users, Landmark, PackageCheck, ShieldCheck, CalendarDays, FileQuestion, MapPin, ChevronRight, Wallet, Search, X } from 'lucide-react'
import { isTerminal } from '@/lib/bills-booking/stages'
import { BillingTree, type TrustNode, type Leaf } from './BillingTree'
import { WhoHolds } from './WhoHolds'
import { CheckIn4Button } from './CheckIn4Button'
import { RegisterFilters } from './RegisterFilters'
import { BillRows } from './BillRows'
import { whoHoldsWhat, summarise, type PendingBill } from '@/lib/bills-booking/holding'
import { loadRegister, vendorOf } from '@/lib/bills-booking/load-register'
import { applyFilters, duplicateKeys, waitingOnMe, type RegisterFilters as Filters, type View } from '@/lib/bills-booking/register'
import { loadUnpaidCerts } from '@/lib/bills-booking/load-money'
import { moneyAtRest } from '@/lib/bills-booking/money'
import { DESKS } from '@/lib/bills-booking/desk-list'
import { formatINRCompact } from '@/lib/utils'

export const dynamic = 'force-dynamic'

/** The register, as the person in front of it needs it.
 *
 *  Aksha, 16 Sep 2026, screen A of the look-and-feel preview: "Build it".
 *  Signed in as a desk, not as admin: what is waiting on YOU first, then what
 *  arrived from IN4 by itself, then the money at rest across every desk. Then
 *  the controls — search, project, WO/PO, late-only, saved views, export — and
 *  the rows, each saying why it is here. Then who holds what, as heat.
 *
 *  Everything that decides is in lib/bills-booking (register.ts, holding.ts,
 *  money.ts) and tested; this page fetches, shapes and lays out. */
export default async function BillsBookingPage({ searchParams }: {
  searchParams: Promise<{ q?: string; project?: string; type?: string; late?: string; view?: string; find?: string }>
}) {
  const me = await requireBillsAccess()
  const sp = await searchParams
  const supabase = await createClient()

  const [reg, certs] = await Promise.all([
    loadRegister(supabase, me),
    // The money-at-rest tile. One number; the page behind it does the rest.
    loadUnpaidCerts(supabase).catch(() => []),
  ])
  const money = moneyAtRest(certs)

  const filters: Filters = {
    q: sp.q ?? null,
    project: sp.project ?? null,
    type: sp.type === 'WO' ? 'WO' : sp.type === 'PO' ? 'PO' : null,
    late: sp.late === '1',
    view: (sp.view as View | undefined) ?? (me.onAnyDesk ? 'mine' : 'all'),
  }
  const shown = applyFilters(reg.rows, filters)
  const dupes = duplicateKeys(reg.rows)
  const mine = waitingOnMe(reg.rows)
  const liveRows = reg.rows.filter(r => !isTerminal(r.stage))
  const counts = {
    mine: liveRows.filter(r => r.mine && !r.isExample).length,
    late: applyFilters(reg.rows, { view: 'late' }).length,
    arrived: liveRows.filter(r => r.autoRaised).length,
    sentBack: liveRows.filter(r => r.lastAction === 'send_back').length,
  }
  const projectOptions = [...new Map(
    reg.rows.filter(r => r.project).map(r => [r.project as string, r.project as string]),
  ).keys()].sort().map(code => ({ id: code, code }))

  // Search is behind an icon. Aksha, 17 Sep 2026: "THIS section can be hidden
  // as search in an icon on top right corner - when required we can open."
  //
  // Open/closed is in the URL rather than component state, so the icon can sit
  // in the page header (a server component) beside the other actions, and an
  // opened search survives a reload and can be sent to somebody.
  //
  // What is NOT hidden: a filter that is actually ON. Narrowing a list behind
  // a closed panel is exactly the silent blocker that makes somebody think the
  // register has lost their bills — so the icon carries a count and the active
  // filters stay on screen as chips with a way to drop each one.
  const qs = (mut: (p: URLSearchParams) => void): string => {
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries(sp)) if (typeof v === 'string' && v) p.set(k, v)
    mut(p)
    const s = p.toString()
    return s ? `/bills-booking?${s}` : '/bills-booking'
  }
  const active: Array<{ label: string; clear: string }> = [
    ...(sp.q ? [{ label: `“${sp.q}”`, clear: qs(p => p.delete('q')) }] : []),
    ...(sp.project ? [{ label: sp.project, clear: qs(p => p.delete('project')) }] : []),
    ...(sp.type ? [{ label: `${sp.type} only`, clear: qs(p => p.delete('type')) }] : []),
    ...(sp.late === '1' ? [{ label: 'Late only', clear: qs(p => p.delete('late')) }] : []),
  ]
  const findOpen = sp.find === '1'
  const findHref = qs(p => { if (findOpen) p.delete('find'); else p.set('find', '1') })
  const clearAll = qs(p => { for (const k of ['q', 'project', 'type', 'late', 'find']) p.delete(k) })

  // Who I am, in words — the subtitle. Desk keys are permanent; the labels are display.
  const deskLabel = (k: string) => DESKS.find(d => d.key === k)?.label ?? k
  const myDesks = [
    ...new Set(me.desks.map(d => deskLabel(d.desk))),
    ...(me.atmProjects.length || me.atmSubprojects.length ? ['Atm Head'] : []),
  ]

  // ── Who is holding which bill (desk cards) ──
  const pending: PendingBill[] = reg.raw.filter(r => !isTerminal(r.current_stage)).map(r => ({
    id: r.id,
    vendor: vendorOf(r),
    billNo: r.bill_no,
    orderType: r.order_type,
    projectLabel: r.project_id ? reg.projects.get(r.project_id)?.code ?? null : null,
    amount: Number(r.net_amount ?? r.claimed_amount ?? 0),
    stage: r.current_stage,
    stageSince: r.stage_since,
    isExample: r.is_example,
    woPending: r.wo_pending,
    amendmentFlag: r.amendment_flag,
  }))
  const rawById = new Map(reg.raw.map(r => [r.id, r]))
  const desks = whoHoldsWhat(pending, b => {
    const r = rawById.get(b.id)
    const ids = (r ? reg.memberIds.get(reg.deskKey(r)) : undefined) ?? []
    return {
      holders: ids.map(id => reg.nameOf.get(id)).filter((n): n is string => !!n),
      mine: !!me.userId && ids.includes(me.userId),
    }
  })
  const holdSummary = summarise(desks)

  // ── The tree, by trust → project → sub-project (kept, under Reports) ──
  const trusts = new Map<string, TrustNode>()
  const bump = (n: { n: number; value: number }, v: number) => { n.n += 1; n.value += v }
  for (const b of reg.raw) {
    const v = Number(b.net_amount ?? b.claimed_amount ?? 0)
    const p = b.project_id ? reg.projects.get(b.project_id) : undefined
    const main = p?.parent ? reg.projects.get(p.parent) : p
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

  const examples = reg.raw.filter(r => r.is_example).length
  const viewTitle: Record<View, string> = {
    mine: myDesks.length ? `On your desk — ${myDesks.join(', ')}` : 'On your desk',
    all: 'Every bill',
    late: 'Late — past the desk turnaround',
    sent_back: 'Sent back for revision',
    arrived: 'Arrived from IN4 by themselves',
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <PageHeader title="Bills Approval" back="/"
        subtitle={myDesks.length
          ? `Signed in as ${myDesks.join(' · ')}${me.isAdmin ? ' · admin' : ''}`
          : me.isAdmin ? 'Admin — every desk' : 'Contractor & vendor bills — by trust, project and sub-project.'}>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={findHref} scroll={false}
                aria-expanded={findOpen}
                title={findOpen ? 'Hide search and filters' : 'Search and filter the register'}
                className={`relative inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold ${
                  findOpen || active.length
                    ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                    : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}>
            {findOpen ? <X className="h-4 w-4" /> : <Search className="h-4 w-4" />}
            <span className="sr-only sm:not-sr-only">{findOpen ? 'Close' : 'Search'}</span>
            {active.length > 0 && !findOpen && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-indigo-600 px-1 text-[10px] font-bold tabular-nums text-white">
                {active.length}
              </span>
            )}
          </Link>
          {/* The Disc Head and every desk above waits on IN4. Twice a day is
              the schedule; this is the same two sweeps — raise, then advance —
              on demand, so a bill approved this morning is not left sitting. */}
          {(me.isAdmin || me.onAnyDesk) && <CheckIn4Button />}
          {me.isAdmin && (
            <Link href="/bills-booking/admin" className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
              <Users className="h-4 w-4" /> Desks
            </Link>
          )}
          {(me.isAdmin || me.canEdit) && (
            <Link href="/bills-booking/new" className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
              <Plus className="h-4 w-4" /> New bill
            </Link>
          )}
        </div>
      </PageHeader>

      {reg.error ? (
        <QueryError what="the bills" message={reg.error} />
      ) : (
        <>
          {/* Three tiles: you, what arrived, the money */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {me.onAnyDesk ? (
              <div className={`rounded-2xl border bg-white p-4 shadow-sm ${mine.tone === 'late' ? 'border-rose-300' : mine.tone === 'warn' ? 'border-amber-300' : 'border-indigo-200'}`}>
                <p className="text-[11px] font-bold uppercase tracking-wide text-indigo-700">Waiting on you</p>
                <p className="mt-1 text-2xl font-extrabold tabular-nums text-gray-900">
                  {mine.bills} <span className="text-base font-semibold text-gray-500">{mine.bills === 1 ? 'bill' : 'bills'} · {formatINRCompact(mine.value)}</span>
                </p>
                <p className="mt-1 text-[12px] text-gray-600">
                  {mine.bills === 0 ? 'Nothing is waiting on you.' : <>Oldest <b className={mine.tone === 'late' ? 'text-rose-700' : mine.tone === 'warn' ? 'text-amber-800' : 'text-gray-800'}>{mine.oldestDays === 0 ? 'today' : `${mine.oldestDays} days`}</b>{mine.tone === 'late' ? ' — well past the turnaround' : mine.tone === 'warn' ? ' — past the turnaround' : ''}</>}
                </p>
              </div>
            ) : (
              <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Live bills</p>
                <p className="mt-1 text-2xl font-extrabold tabular-nums text-gray-900">{holdSummary.bills}</p>
                <p className="mt-1 text-[12px] text-gray-600">{formatINRCompact(holdSummary.value)} moving · {holdSummary.late} late</p>
              </div>
            )}
            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Arrived from IN4 today</p>
              <p className="mt-1 text-2xl font-extrabold tabular-nums text-gray-900">{reg.arrivedToday}</p>
              <p className="mt-1 text-[12px] text-gray-600">Raised by themselves when IN4 approved the abstract. Nobody typed them.</p>
            </div>
            <Link href="/bills-booking/money" className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm hover:border-indigo-300 hover:bg-indigo-50/30">
              <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-gray-500"><Wallet className="h-3.5 w-3.5" /> Money at rest — IN4</p>
              <p className="mt-1 text-2xl font-extrabold tabular-nums text-gray-900">{formatINRCompact(money.wo.value)}</p>
              <p className="mt-1 text-[12px] text-gray-600">{money.wo.bills} contractor bills not yet paid · <span className="font-semibold text-indigo-700">where it stands ›</span></p>
            </Link>
          </div>

          {examples > 0 && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
              <b>{examples} example bills</b> are in the list, badged. Seeded from real IN4 work orders so the figures
              behave; left out of every total.{me.isAdmin && <> <Link href="/bills-booking/admin" className="font-semibold underline">Remove them</Link> when you are done.</>}
            </p>
          )}

          {findOpen && <RegisterFilters projects={projectOptions} counts={counts} onDesk={me.onAnyDesk} closeHref={findHref} />}

          {/* Closed, but something is filtering the list. Never silent. */}
          {!findOpen && active.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
              <span className="text-gray-500">Filtered:</span>
              {active.map(a => (
                <Link key={a.label} href={a.clear} scroll={false}
                      title={`Remove ${a.label}`}
                      className="inline-flex min-h-[28px] items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 font-semibold text-indigo-800 hover:bg-indigo-100">
                  {a.label} <X className="h-3 w-3" />
                </Link>
              ))}
              <Link href={clearAll} scroll={false} className="ml-0.5 min-h-[28px] px-1 py-1 font-semibold text-gray-500 underline underline-offset-2 hover:text-gray-800">
                Clear all
              </Link>
            </div>
          )}

          {reg.rows.length === 0 ? (
            <EmptyState icon={<ReceiptText className="h-8 w-8" />} title="No bills yet"
              description="Bills raise themselves here when IN4 approves an abstract. Press Check IN4 to look now." />
          ) : (
            <BillRows rows={shown} dupes={dupes}
              title={viewTitle[filters.view ?? 'all']}
              note={filters.q || filters.project || filters.type || filters.late ? 'filtered' : 'oldest first'} />
          )}

          <WhoHolds desks={desks} summary={holdSummary} />
        </>
      )}

      {/* Reports and registers — the places to look BACK. One line at the
          foot, open when wanted. The by-trust tree lives here too now. */}
      {me.isAdmin && (
      <details className="group rounded-xl border border-gray-200 bg-white">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold text-gray-700 min-h-[44px]">
          <ChevronRight className="h-4 w-4 text-gray-400 transition-transform group-open:rotate-90" />
          Reports &amp; registers
          <span className="text-[11px] font-normal text-gray-400">9 views over IN4 — money, retention, closure, sanctions, daily, and the tree by trust</span>
        </summary>
        <div className="space-y-3 border-t border-gray-100 p-3">
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {([
              { href: '/bills-booking/money', icon: Wallet, label: 'Where the money stands', hint: 'By age, project, IN4 status, desk' },
              { href: '/bills-booking/in-flight', icon: Clock, label: 'In flight', hint: 'Who is sitting on what' },
              { href: '/bills-booking/overview', icon: ReceiptText, label: 'Money waiting', hint: 'Open bills by project' },
              { href: '/bills-booking/retention', icon: Landmark, label: 'Retention', hint: 'Held and not given back' },
              { href: '/bills-booking/closure', icon: PackageCheck, label: 'Never closed', hint: 'No final bill, gone quiet' },
              { href: '/bills-booking/sanctions', icon: ShieldCheck, label: 'Sanctions', hint: 'What you approved vs IN4' },
              { href: '/bills-booking/daily', icon: CalendarDays, label: 'Daily report', hint: 'Paid, and at each trust' },
              { href: '/bills-booking/no-order', icon: FileQuestion, label: 'No work order', hint: 'Misc, and bills before the WO' },
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
          {tree.length > 0 && <BillingTree tree={tree} />}
        </div>
      </details>
      )}
    </div>
  )
}
