// Accounts — money across the whole hub, not one project.
//
// Three questions whose answers span every project, which is exactly why this
// is its own lane and not a tab inside a project: a trust's total, a firm's
// ledger (Desai Construction runs across 11 projects), and a financial year.
//
// Since 21 Sep 2026 the lane shows TRUE figures by default: cancelled
// certificates out, advances not counted beside the bills that recover them,
// retention releases not counted as work, supplier advances dated from their
// PO. Until then it summed every row in the mirror and reported ₹11.92 Cr owed
// where IN4's live bills carry ₹5.13 Cr. "IN4 raw" brings the old view back in
// one click. The rule is in the database (cc_accounts_rows) and is the same one
// the project-level Accounts tab follows, so the two screens agree.
//
// Gated twice, like every restricted screen here: the lane is hidden for anyone
// not on the list, and this page refuses the URL, so nothing "goes through URL".
// The RPCs behind it check the same list a third time.

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Download } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { QueryError } from '@/components/ui/query-error'
import { requirePermission } from '@/lib/auth'
import { canOpenAccounts } from '@/lib/revamp/accounts-access'
import { formatINR, formatDate } from '@/lib/utils'
import {
  loadSummary, loadByTrust, loadByParty, loadByFy, loadPartyLedger,
  loadTrustProjects, loadTrustParties, loadRetentionByTrust, loadRetentionByParty, totals,
  type PartyRow, type LedgerRow,
} from '@/lib/revamp/accounts-hub'

export const dynamic = 'force-dynamic'

const VIEWS = [
  { key: 'trust',     label: 'Trustwise' },
  { key: 'party',     label: 'Parties' },
  { key: 'retention', label: 'Retention' },
  { key: 'fy',        label: 'FY Wise' },
] as const
type ViewKey = (typeof VIEWS)[number]['key']

interface Params { view: ViewKey; raw: boolean; trust: number | null; party: string | null; q: string; all: boolean }

/** Every link on the page keeps the raw switch as it is — flipping it is a deliberate act. */
function href(p: Params, patch: Partial<Params> & { view?: ViewKey }): string {
  const n = { ...p, ...patch }
  const s = new URLSearchParams({ view: n.view })
  if (n.raw) s.set('raw', '1')
  if (n.trust != null) s.set('trust', String(n.trust))
  if (n.party) s.set('party', n.party)
  if (n.q) s.set('q', n.q)
  if (n.all) s.set('all', '1')
  return `/accounts?${s.toString()}`
}
function exportHref(p: Params): string {
  const s = new URLSearchParams({ view: p.view })
  if (p.raw) s.set('raw', '1')
  if (p.trust != null) s.set('trust', String(p.trust))
  if (p.party) s.set('party', p.party)
  if (p.q) s.set('q', p.q)
  if (p.all) s.set('all', '1')
  return `/api/accounts-hub/export?${s.toString()}`
}

/** Money column — right-aligned, tabular, and a dash rather than ₹0 so a
 *  column of real figures is not diluted by zeroes. */
function Money({ n, strong = false, tone }: { n: number; strong?: boolean; tone?: 'bad' }) {
  const cls = tone === 'bad' ? 'text-rose-700 font-bold' : strong ? 'font-bold text-gray-900' : 'text-gray-700'
  return (
    <span className={`tabular-nums whitespace-nowrap ${cls}`}>
      {n ? formatINR(n) : <span className="text-gray-300">—</span>}
    </span>
  )
}

function Th({ children, right = false }: { children?: React.ReactNode; right?: boolean }) {
  return (
    <th className={`px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500 bg-gray-50 border-b border-gray-200 ${right ? 'text-right' : 'text-left'}`}>
      {children}
    </th>
  )
}

/** "contractor · supplier" when IN4 lists the firm in both series. */
function Kinds({ kinds }: { kinds: string }) {
  return <span className="ml-2 text-[10px] font-bold uppercase tracking-wide text-gray-400 whitespace-nowrap">{kinds}</span>
}

/** How old the oldest unpaid bill is. Red past 90 days; "no date" is unknown, not new. */
function Age({ days }: { days: number | null }) {
  if (days == null) return <span className="text-[11.5px] text-amber-700">no date</span>
  return <span className={`tabular-nums font-semibold ${days > 90 ? 'text-rose-700' : 'text-gray-700'}`}>{days.toLocaleString('en-IN')}d</span>
}

function ExportButton({ p, what }: { p: Params; what: string }) {
  return (
    <a
      href={exportHref(p)}
      className="inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-lg border border-gray-300 bg-white text-[12.5px] font-semibold text-gray-700 hover:border-gray-500"
      title={`Download ${what} as Excel — the same figures as this screen`}
    >
      <Download className="h-3.5 w-3.5" /> Excel
    </a>
  )
}

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; party?: string; trust?: string; q?: string; raw?: string; all?: string }>
}) {
  await requirePermission('cost-control', 'view')
  // The second gate. A person not on the list never sees the lane; typing the
  // address must not be a way in either.
  if (!(await canOpenAccounts())) redirect('/dashboard')

  const sp = await searchParams
  const p: Params = {
    view: VIEWS.some(v => v.key === sp.view) ? (sp.view as ViewKey) : 'trust',
    raw: sp.raw === '1',
    trust: sp.trust && /^\d+$/.test(sp.trust) ? Number(sp.trust) : null,
    party: sp.party && /^[a-z0-9]{1,120}$/.test(sp.party) ? sp.party : null,
    q: (sp.q ?? '').trim().slice(0, 80),
    all: sp.all === '1',
  }

  const summary = await loadSummary(p.raw)

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <PageHeader
        title="Accounts"
        subtitle={p.raw
          ? 'IN4 exactly as the mirror holds it — cancelled certificates and advances included'
          : 'Every project, every trust — certified, paid and outstanding on live bills, as IN4 holds them'}
      />

      {summary.error
        ? <QueryError message={summary.error} what="the headline figures" />
        : summary.row && <Headline s={summary.row} p={p} />}

      <div className="flex items-end gap-2 border-b border-gray-200">
        <div className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden flex-1">
          {VIEWS.map(v => (
            <Link
              key={v.key}
              href={href(p, { view: v.key, trust: null, party: null, q: '', all: false })}
              className={`inline-flex items-center min-h-[38px] px-3 rounded-t-lg text-[13px] font-semibold border-b-2 whitespace-nowrap ${
                p.view === v.key
                  ? 'border-blue-600 text-blue-700 bg-blue-50/60'
                  : 'border-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-50'
              }`}
            >
              {v.label}
            </Link>
          ))}
        </div>
        <div className="pb-1.5 flex-none">
          <ExportButton p={p} what={VIEWS.find(v => v.key === p.view)?.label ?? 'this view'} />
        </div>
      </div>

      {p.view === 'trust' && (p.trust === null ? <TrustView p={p} /> : <TrustDetail p={p} trustId={p.trust} />)}
      {p.view === 'party' && (p.party === null ? <PartyView p={p} /> : <LedgerView p={p} partyKey={p.party} />)}
      {p.view === 'retention' && <RetentionView p={p} />}
      {p.view === 'fy' && <FyView p={p} />}

      <p className="text-[11.5px] text-gray-500">
        Read from the IN4 certificate mirror. Certified, paid, outstanding and retention are
        IN4&rsquo;s own figures and are not derived from one another — IN4 nets recoveries,
        deductions and advance recovery in its own way.
        {!p.raw && <> Ageing is by invoice date, else certificate date, else the PO date.</>}
      </p>
    </div>
  )
}

// ── Headline ────────────────────────────────────────────────────────────────
// Four numbers and the one line that explains the difference from IN4 raw. The
// raw switch sits here, next to the figures it changes.
function Headline({ s, p }: { s: NonNullable<Awaited<ReturnType<typeof loadSummary>>['row']>; p: Params }) {
  const pct = s.owed > 0 ? Math.round((s.over90 / s.owed) * 100) : 0
  const delta = s.paid_prev_30d > 0 ? Math.round(((s.paid_30d - s.paid_prev_30d) / s.paid_prev_30d) * 100) : null
  const hidden = s.hidden_cancelled + s.hidden_advances
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-gray-200 border border-gray-200 rounded-xl overflow-hidden">
        <Kpi label={p.raw ? 'Outstanding, raw' : 'Owed on live bills'} value={formatINR(s.owed)} sub={`${s.parties_open.toLocaleString('en-IN')} parties · 3 trusts`} tone="good" />
        <Kpi label="Past 90 days" value={formatINR(s.over90)} sub={`${pct}% of what is owed · ${s.parties_over90} parties`} tone={s.over90 > 0 ? 'bad' : undefined} />
        <Kpi label="Retention held" value={formatINR(s.retention_held)} sub={s.releases_pending > 0 ? `${s.releases_pending} release${s.releases_pending === 1 ? '' : 's'} pending · ${formatINR(s.releases_pending_amt)}` : 'no releases pending'} />
        <Kpi label="Paid, last 30 days" value={formatINR(s.paid_30d)} sub={delta == null ? `previous 30 days ${formatINR(s.paid_prev_30d)}` : `${delta > 0 ? '+' : ''}${delta}% vs previous 30 days`} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
        {p.raw ? (
          <p className="text-amber-800">
            <b>Raw view.</b> {formatINR(s.hidden_cancelled)} of this sits on {s.hidden_rows.toLocaleString('en-IN')} cancelled certificates and {formatINR(s.hidden_advances)} on advances already being recovered through bills.
          </p>
        ) : (
          <p className="text-gray-600">
            Not counted: <b className="text-gray-900 tabular-nums">{formatINR(s.hidden_cancelled)}</b> on {s.hidden_rows.toLocaleString('en-IN')} cancelled certificates
            and <b className="text-gray-900 tabular-nums">{formatINR(s.hidden_advances)}</b> on advances already being recovered through bills
            {hidden > 0 && <> — {formatINR(hidden)} that IN4 lists but does not owe.</>}
          </p>
        )}
        <Link
          href={href(p, { raw: !p.raw })}
          className={`inline-flex items-center gap-2 min-h-[32px] px-3 rounded-full border text-[12px] font-semibold ${
            p.raw ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-gray-300 bg-white text-gray-700 hover:border-gray-500'
          }`}
          title={p.raw ? 'Back to the true figures' : 'Show every row exactly as IN4 holds it'}
        >
          <span className={`inline-block h-2 w-2 rounded-full ${p.raw ? 'bg-amber-500' : 'bg-gray-300'}`} />
          {p.raw ? 'Showing IN4 raw' : 'Show IN4 raw'}
        </Link>
      </div>
    </div>
  )
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="bg-white px-3.5 py-3">
      <p className="text-[11px] font-semibold text-gray-500">{label}</p>
      <p className={`text-[19px] font-bold tabular-nums leading-tight mt-0.5 ${tone === 'bad' ? 'text-rose-700' : tone === 'good' ? 'text-emerald-800' : 'text-gray-900'}`}>{value}</p>
      {sub && <p className="text-[11px] text-gray-500 mt-0.5">{sub}</p>}
    </div>
  )
}

// ── Trustwise ───────────────────────────────────────────────────────────────
// A trust total on its own is just a figure. The question behind it is how OLD
// the unpaid money is, so the list carries the ageing, and a trust opens into
// the two breakdowns behind it: which projects hold the money, and who is owed.
async function TrustView({ p }: { p: Params }) {
  const { rows, error } = await loadByTrust(p.raw)
  if (error) return <QueryError message={error} what="the trust totals" />
  if (rows.length === 0) return <Empty what="No certificates yet." />
  const t = totals(rows)
  const over90 = rows.reduce((s, r) => s + r.amt_over90, 0)

  return (
    <Card className="overflow-hidden p-0">
      <div className="overflow-x-auto hidden md:block">
        <table className="w-full text-sm">
          <thead><tr>
            <Th>Trust</Th><Th right>Certified</Th><Th right>Paid</Th>
            <Th right>Outstanding</Th><Th right>Over 90 days</Th><Th right>Retention held</Th>
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.trust_id ?? 'none'} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-3 py-2.5">
                  {r.trust_id === null ? (
                    <span className="font-semibold text-gray-900">No trust on the project</span>
                  ) : (
                    <Link href={href(p, { trust: r.trust_id })} className="font-semibold text-blue-700 hover:underline">
                      {r.trust_code}
                    </Link>
                  )}
                  <span className="block text-[11.5px] text-gray-500">
                    {r.projects} project{r.projects === 1 ? '' : 's'} · {r.parties} parties · {r.certificates.toLocaleString('en-IN')} certificates
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right"><Money n={r.certified} /></td>
                <td className="px-3 py-2.5 text-right"><Money n={r.paid} /></td>
                <td className="px-3 py-2.5 text-right"><Money n={r.outstanding} strong /></td>
                <td className="px-3 py-2.5 text-right">
                  <Money n={r.amt_over90} tone={r.amt_over90 > 0 ? 'bad' : undefined} />
                  {r.n_over90 > 0 && <span className="block text-[11px] text-gray-500">{r.n_over90} certificates</span>}
                </td>
                <td className="px-3 py-2.5 text-right"><Money n={r.retention} /></td>
              </tr>
            ))}
            <tr className="bg-gray-50 font-bold">
              <td className="px-3 py-2.5 text-gray-900">All trusts</td>
              <td className="px-3 py-2.5 text-right"><Money n={t.certified} strong /></td>
              <td className="px-3 py-2.5 text-right"><Money n={t.paid} strong /></td>
              <td className="px-3 py-2.5 text-right"><Money n={t.outstanding} strong /></td>
              <td className="px-3 py-2.5 text-right"><Money n={over90} tone={over90 > 0 ? 'bad' : undefined} /></td>
              <td className="px-3 py-2.5 text-right"><Money n={t.retention} strong /></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="md:hidden divide-y divide-gray-100">
        {rows.map(r => (
          <Link key={r.trust_id ?? 'none'} href={href(p, { trust: r.trust_id })} className="block px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-semibold text-[13px] text-blue-700">{r.trust_code ?? 'No trust'}</span>
              <Money n={r.outstanding} strong />
            </div>
            <p className="text-[11.5px] text-gray-500 mt-0.5">{r.projects} project{r.projects === 1 ? '' : 's'} · {r.parties} parties</p>
            {r.amt_over90 > 0 && <p className="text-[12px] font-semibold text-rose-700 mt-1 tabular-nums">{formatINR(r.amt_over90)} over 90 days</p>}
            <p className="text-[11.5px] text-gray-600 mt-0.5 tabular-nums">Certified {formatINR(r.certified)} · retention {formatINR(r.retention)}</p>
          </Link>
        ))}
      </div>
    </Card>
  )
}

/** One ageing bucket. Red only past 90 days — the rest is normal trading. */
function AgeTile({ label, amount, count, tone }: { label: string; amount: number; count?: number; tone: 'plain' | 'warn' | 'bad' }) {
  const cls = tone === 'bad' ? 'border-rose-200 bg-rose-50 text-rose-900'
    : tone === 'warn' ? 'border-amber-200 bg-amber-50 text-amber-900'
    : 'border-gray-200 bg-white text-gray-900'
  return (
    <div className={`rounded-lg border px-3 py-2.5 flex-1 min-w-[150px] ${cls}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide opacity-70">{label}</p>
      <p className="text-[15px] font-bold tabular-nums mt-0.5">{amount ? formatINR(amount) : '—'}</p>
      {count != null && count > 0 && <p className="text-[11px] opacity-70">{count} certificate{count === 1 ? '' : 's'}</p>}
    </div>
  )
}

// ── Inside one trust ────────────────────────────────────────────────────────
async function TrustDetail({ p, trustId }: { p: Params; trustId: number }) {
  const [summary, projects, parties] = await Promise.all([
    loadByTrust(p.raw), loadTrustProjects(trustId, p.raw), loadTrustParties(trustId, p.raw),
  ])
  if (summary.error) return <QueryError message={summary.error} what="this trust" />
  const trust = summary.rows.find(r => r.trust_id === trustId)
  if (!trust) return <Empty what="That trust has no certificates." />
  const owed = parties.rows.filter(x => x.outstanding > 0)

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-base font-bold text-gray-900">{trust.trust_code}</h2>
          <p className="text-[12px] text-gray-600">
            {trust.trust_name} · {trust.projects} project{trust.projects === 1 ? '' : 's'} · {trust.parties} parties
            · {trust.certificates.toLocaleString('en-IN')} certificates
          </p>
        </div>
        <Link href={href(p, { trust: null })} className="text-[12.5px] font-semibold text-blue-700 hover:underline">← All trusts</Link>
      </div>

      <div>
        <p className="text-[11.5px] font-semibold text-gray-700 mb-1.5">{formatINR(trust.outstanding)} outstanding, by age</p>
        <div className="flex flex-wrap gap-2">
          <AgeTile label="0–30 days" amount={trust.amt_0_30} tone="plain" />
          <AgeTile label="31–90 days" amount={trust.amt_31_90} tone="warn" />
          <AgeTile label="Over 90 days" amount={trust.amt_over90} count={trust.n_over90} tone="bad" />
          {trust.n_undated > 0 && <AgeTile label="No date in IN4" amount={trust.amt_undated} count={trust.n_undated} tone="warn" />}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <AgeTile label="Owed to contractors" amount={trust.outst_contractor} tone="plain" />
        <AgeTile label="Owed to suppliers" amount={trust.outst_supplier} tone="plain" />
        <AgeTile label="Retention held" amount={trust.retention} tone="plain" />
      </div>

      <Card className="overflow-hidden p-0">
        <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50/60">
          <p className="text-[12px] font-semibold text-gray-900">Projects under {trust.trust_code}</p>
          <p className="text-[11px] text-gray-500">Most outstanding first</p>
        </div>
        {projects.error ? <QueryError message={projects.error} what="this trust's projects" /> : (
          <>
            <div className="overflow-x-auto hidden md:block">
              <table className="w-full text-sm">
                <thead><tr>
                  <Th>Project</Th><Th right>Certificates</Th><Th right>Certified</Th>
                  <Th right>Paid</Th><Th right>Outstanding</Th><Th right>Over 90 days</Th>
                </tr></thead>
                <tbody>
                  {projects.rows.map(r => (
                    <tr key={r.project_label} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-3 py-2.5">
                        {r.hub_project_id
                          ? <Link href={`/project/${r.hub_project_id}/accounts`} className="font-semibold text-blue-700 hover:underline">{r.project_label}</Link>
                          : <span className="font-semibold text-gray-900">{r.project_label}</span>}
                        {r.hub_codes && r.hub_codes !== r.project_label && <span className="block text-[11px] text-gray-500">in CT Hub: {r.hub_codes}</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">{r.certificates.toLocaleString('en-IN')}</td>
                      <td className="px-3 py-2.5 text-right"><Money n={r.certified} /></td>
                      <td className="px-3 py-2.5 text-right"><Money n={r.paid} /></td>
                      <td className="px-3 py-2.5 text-right"><Money n={r.outstanding} strong /></td>
                      <td className="px-3 py-2.5 text-right"><Money n={r.amt_over90} tone={r.amt_over90 > 0 ? 'bad' : undefined} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="md:hidden divide-y divide-gray-100">
              {projects.rows.map(r => (
                <div key={r.project_label} className="px-4 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-semibold text-[13px] text-gray-900">{r.project_label}</span>
                    <Money n={r.outstanding} strong />
                  </div>
                  <p className="text-[11.5px] text-gray-600 mt-0.5 tabular-nums">Certified {formatINR(r.certified)} · {r.certificates} certificates</p>
                  {r.amt_over90 > 0 && <p className="text-[12px] font-semibold text-rose-700 mt-0.5 tabular-nums">{formatINR(r.amt_over90)} over 90 days</p>}
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50/60">
          <p className="text-[12px] font-semibold text-gray-900">Owed by {trust.trust_code}</p>
          <p className="text-[11px] text-gray-500">{owed.length} firms with a balance · most outstanding first, with the age of the oldest unpaid bill</p>
        </div>
        {parties.error ? <QueryError message={parties.error} what="this trust's parties" /> : owed.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-gray-500">Nothing outstanding under this trust.</p>
        ) : (
          <>
            <div className="overflow-x-auto hidden md:block">
              <table className="w-full text-sm">
                <thead><tr>
                  <Th>Party</Th><Th right>Certified</Th><Th right>Paid</Th><Th right>Outstanding</Th><Th right>Oldest unpaid</Th>
                </tr></thead>
                <tbody>
                  {owed.map(x => (
                    <tr key={x.party_key} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-3 py-2.5">
                        <Link href={href(p, { view: 'party', party: x.party_key, trust: null })} className="font-semibold text-blue-700 hover:underline">{x.party_name}</Link>
                        <Kinds kinds={x.kinds} />
                      </td>
                      <td className="px-3 py-2.5 text-right"><Money n={x.certified} /></td>
                      <td className="px-3 py-2.5 text-right"><Money n={x.paid} /></td>
                      <td className="px-3 py-2.5 text-right"><Money n={x.outstanding} strong /></td>
                      <td className="px-3 py-2.5 text-right"><Age days={x.oldest_unpaid_days} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="md:hidden divide-y divide-gray-100">
              {owed.map(x => (
                <Link key={x.party_key} href={href(p, { view: 'party', party: x.party_key, trust: null })} className="block px-4 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-semibold text-[13px] text-blue-700 truncate">{x.party_name}</span>
                    <Money n={x.outstanding} strong />
                  </div>
                  <p className="text-[11.5px] text-gray-500 mt-0.5">{x.kinds} · oldest unpaid {x.oldest_unpaid_days == null ? 'has no date' : `${x.oldest_unpaid_days} days`}</p>
                </Link>
              ))}
            </div>
          </>
        )}
      </Card>
    </div>
  )
}

// ── Parties ─────────────────────────────────────────────────────────────────
// One row per FIRM. Opens on the firms with money outstanding; the settled ones
// are a search away, the way the Bills register works. A firm that works under
// three trusts shows the split, so the same money is never read three times.
async function PartyView({ p }: { p: Params }) {
  const openOnly = !p.all && !p.q
  const { rows, error } = await loadByParty({ raw: p.raw, openOnly, q: p.q || null })
  if (error) return <QueryError message={error} what="the party totals" />
  const t = totals(rows)
  const ledger = (r: PartyRow) => href(p, { party: r.party_key })

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={href(p, { q: '', all: false, party: null })} className={`inline-flex items-center min-h-[32px] px-3 rounded-full border text-[12.5px] font-semibold ${openOnly ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-300 hover:border-gray-500'}`}>
          With a balance
        </Link>
        <Link href={href(p, { q: '', all: true, party: null })} className={`inline-flex items-center min-h-[32px] px-3 rounded-full border text-[12.5px] font-semibold ${p.all && !p.q ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-300 hover:border-gray-500'}`}>
          Every firm
        </Link>
        <form action="/accounts" method="get" className="flex items-center gap-1.5 ml-auto w-full sm:w-auto">
          <input type="hidden" name="view" value="party" />
          {p.raw && <input type="hidden" name="raw" value="1" />}
          <input
            id="party-q"
            name="q"
            type="search"
            defaultValue={p.q}
            placeholder="Find a firm, settled or not…"
            className="min-h-[36px] w-full sm:w-64 rounded-lg border border-gray-300 px-3 text-[13px] text-gray-900 placeholder:text-gray-400"
            autoComplete="off"
          />
          <button type="submit" className="min-h-[36px] px-3 rounded-lg bg-gray-900 text-white text-[12.5px] font-semibold">Search</button>
        </form>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50/60">
          <p className="text-[11.5px] text-gray-600">
            {rows.length.toLocaleString('en-IN')} firm{rows.length === 1 ? '' : 's'}
            {p.q ? <> matching &ldquo;{p.q}&rdquo;</> : openOnly ? ' with money outstanding' : ' in all'}
            {' · '}<b className="text-gray-900 tabular-nums">{formatINR(t.outstanding)}</b> outstanding in total. Open a firm for its ledger.
          </p>
        </div>

        {rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-gray-500">
            {p.q ? 'No firm matches that.' : 'Nothing outstanding.'}
          </p>
        ) : (
          <>
            <div className="overflow-x-auto hidden md:block">
              <table className="w-full text-sm">
                <thead><tr>
                  <Th>Firm</Th><Th>Trusts</Th><Th right>Projects</Th><Th right>Certified</Th>
                  <Th right>Paid</Th><Th right>Outstanding</Th><Th right>Oldest unpaid</Th>
                </tr></thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.party_key} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-3 py-2.5">
                        <Link href={ledger(r)} className="font-semibold text-blue-700 hover:underline">{r.party_name}</Link>
                        <Kinds kinds={r.kinds} />
                      </td>
                      <td className="px-3 py-2.5 text-[12px] text-gray-600">
                        {r.trusts.length === 0 ? '—' : r.trusts.map(x => (
                          <span key={x.trust} className="inline-block mr-2 whitespace-nowrap">
                            {x.trust}{r.trusts.length > 1 && x.outstanding > 0 && <span className="text-gray-400 tabular-nums"> {formatINR(x.outstanding)}</span>}
                          </span>
                        ))}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">{r.projects}</td>
                      <td className="px-3 py-2.5 text-right"><Money n={r.certified} /></td>
                      <td className="px-3 py-2.5 text-right"><Money n={r.paid} /></td>
                      <td className="px-3 py-2.5 text-right"><Money n={r.outstanding} strong /></td>
                      <td className="px-3 py-2.5 text-right">{r.outstanding > 0 ? <Age days={r.oldest_unpaid_days} /> : <span className="text-gray-300">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="md:hidden divide-y divide-gray-100">
              {rows.map(r => (
                <Link key={r.party_key} href={ledger(r)} className="block px-4 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-semibold text-[13px] text-blue-700 truncate">{r.party_name}</span>
                    <Money n={r.outstanding} strong />
                  </div>
                  <p className="text-[11.5px] text-gray-500 mt-0.5">
                    {r.kinds} · {r.trusts.map(x => x.trust).join(', ') || '—'} · {r.projects} project{r.projects === 1 ? '' : 's'}
                  </p>
                  <p className="text-[11.5px] text-gray-600 mt-0.5 tabular-nums">
                    Certified {formatINR(r.certified)} · paid {formatINR(r.paid)}
                    {r.outstanding > 0 && r.oldest_unpaid_days != null && <> · oldest {r.oldest_unpaid_days}d</>}
                  </p>
                </Link>
              ))}
            </div>
          </>
        )}
      </Card>
    </div>
  )
}

// ── One firm's ledger ───────────────────────────────────────────────────────
function RowTag({ r }: { r: LedgerRow }) {
  if (r.is_cancelled) return <span className="ml-1.5 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-gray-100 text-gray-500">cancelled</span>
  if (r.is_advance) return <span className="ml-1.5 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-amber-50 text-amber-800">advance</span>
  if (r.is_retention_release) return <span className="ml-1.5 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-sky-50 text-sky-800">retention release</span>
  return null
}

async function LedgerView({ p, partyKey }: { p: Params; partyKey: string }) {
  const [{ rows, error }, parties] = await Promise.all([
    loadPartyLedger(partyKey, p.raw),
    loadByParty({ raw: p.raw, openOnly: false }),
  ])
  if (error) return <QueryError message={error} what="this firm's ledger" />
  const party = parties.rows.find(x => x.party_key === partyKey)
  const t = totals(rows)
  const name = party?.party_name ?? rows[0]?.project_name ?? 'Ledger'

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-base font-bold text-gray-900 truncate">{party?.party_name ?? 'Party ledger'}</h2>
          <p className="text-[12px] text-gray-600">
            {party?.kinds ?? ''} · {rows.length.toLocaleString('en-IN')} certificate{rows.length === 1 ? '' : 's'}
            {party ? ` across ${party.projects} project${party.projects === 1 ? '' : 's'}` : ''}
            {party && party.trusts.length > 0 && <> · {party.trusts.map(x => x.trust).join(', ')}</>}
          </p>
        </div>
        <Link href={href(p, { party: null })} className="text-[12.5px] font-semibold text-blue-700 hover:underline">← All firms</Link>
      </div>

      {rows.length === 0 ? <Empty what="No certificates for this firm." /> : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto hidden md:block">
            <table className="w-full text-sm">
              <thead><tr>
                <Th>Date</Th><Th>Reference</Th><Th>Project</Th>
                <Th right>Certified</Th><Th right>Paid</Th><Th right>Outstanding</Th><Th right>Retention</Th><Th>Open</Th>
              </tr></thead>
              <tbody>
                {rows.map(r => (
                  <tr key={`${r.kind}:${r.certificate_id}`} className={`border-b border-gray-100 hover:bg-gray-50 ${r.is_cancelled ? 'text-gray-400' : ''}`}>
                    <td className="px-3 py-2 text-[12.5px] text-gray-600 whitespace-nowrap">
                      {r.doc_date ? formatDate(r.doc_date) : <span className="text-amber-700">no date</span>}
                      {r.date_source === 'po' && <span className="block text-[10px] text-gray-400">PO date</span>}
                    </td>
                    <td className="px-3 py-2 text-[12.5px] text-gray-700">
                      {r.ref_no ?? `#${r.certificate_id}`}<RowTag r={r} />
                      {r.order_no && <span className="block text-[11px] text-gray-400">{r.order_no}{r.cert_type && r.cert_type !== 'Running' && r.cert_type !== 'Supplier' ? ` · ${r.cert_type}` : ''}</span>}
                    </td>
                    <td className="px-3 py-2 text-[12.5px] text-gray-700">
                      {r.project_code ?? r.project_name ?? '—'}
                      {r.trust_code && <span className="block text-[11px] text-gray-400">{r.trust_code}</span>}
                    </td>
                    <td className="px-3 py-2 text-right"><Money n={r.certified} /></td>
                    <td className="px-3 py-2 text-right"><Money n={r.paid} /></td>
                    <td className="px-3 py-2 text-right"><Money n={r.outstanding} strong /></td>
                    <td className="px-3 py-2 text-right"><Money n={r.retention} /></td>
                    <td className="px-3 py-2 text-[11.5px] whitespace-nowrap">
                      {r.hub_project_id && (
                        <Link href={`/project/${r.hub_project_id}/accounts?view=4&party=${encodeURIComponent(name)}`} className="text-blue-700 hover:underline">project</Link>
                      )}
                      {r.bill_id && (
                        <Link href={`/bills-booking/${r.bill_id}`} className="ml-2 text-blue-700 hover:underline">bill</Link>
                      )}
                    </td>
                  </tr>
                ))}
                <tr className="bg-gray-50 font-bold">
                  <td className="px-3 py-2.5 text-gray-900" colSpan={3}>Total</td>
                  <td className="px-3 py-2.5 text-right"><Money n={t.certified} strong /></td>
                  <td className="px-3 py-2.5 text-right"><Money n={t.paid} strong /></td>
                  <td className="px-3 py-2.5 text-right"><Money n={t.outstanding} strong /></td>
                  <td className="px-3 py-2.5 text-right"><Money n={t.retention} strong /></td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
          <div className="md:hidden divide-y divide-gray-100">
            {rows.map(r => (
              <div key={`${r.kind}:${r.certificate_id}`} className={`px-4 py-3 ${r.is_cancelled ? 'opacity-60' : ''}`}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[12.5px] font-semibold text-gray-900">{r.ref_no ?? `#${r.certificate_id}`}<RowTag r={r} /></span>
                  <Money n={r.certified} strong />
                </div>
                <p className="text-[11.5px] text-gray-500 mt-0.5">
                  {r.doc_date ? formatDate(r.doc_date) : 'no date'}{r.date_source === 'po' ? ' (PO)' : ''} · {r.project_code ?? r.project_name ?? '—'}
                </p>
                <p className="text-[11.5px] text-gray-600 mt-0.5 tabular-nums">Paid {formatINR(r.paid)} · outstanding {formatINR(r.outstanding)}</p>
                {(r.hub_project_id || r.bill_id) && (
                  <p className="text-[11.5px] mt-1">
                    {r.hub_project_id && <Link href={`/project/${r.hub_project_id}/accounts?view=4&party=${encodeURIComponent(name)}`} className="text-blue-700 font-semibold">Open project</Link>}
                    {r.bill_id && <Link href={`/bills-booking/${r.bill_id}`} className="ml-3 text-blue-700 font-semibold">Open bill</Link>}
                  </p>
                )}
              </div>
            ))}
            <div className="px-4 py-3 bg-gray-50">
              <p className="text-[12px] font-bold text-gray-900">Total {formatINR(t.certified)} certified · {formatINR(t.outstanding)} outstanding</p>
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}

// ── Retention ───────────────────────────────────────────────────────────────
// What is held back, by trust and by firm, and the releases IN4 is still
// processing. A column nobody could act on becomes a list someone can.
async function RetentionView({ p }: { p: Params }) {
  const [byTrust, byParty] = await Promise.all([loadRetentionByTrust(p.raw), loadRetentionByParty(p.raw)])
  if (byTrust.error) return <QueryError message={byTrust.error} what="retention by trust" />
  const trusts = byTrust.rows.filter(r => r.held > 0 || r.releases_pending > 0)
  const held = trusts.reduce((s, r) => s + r.held, 0)
  const parties = p.all ? byParty.rows : byParty.rows.slice(0, 40)

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden p-0">
        <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50/60">
          <p className="text-[12px] font-semibold text-gray-900">{formatINR(held)} held back, by trust</p>
          <p className="text-[11px] text-gray-500">Retention on live bills · releases IN4 is still processing · released to date</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead><tr>
              <Th>Trust</Th><Th right>Held</Th><Th right>Bills</Th><Th right>Firms</Th><Th right>Releases pending</Th><Th right>Released so far</Th>
            </tr></thead>
            <tbody>
              {trusts.map(r => (
                <tr key={r.trust_id ?? 'none'} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2.5 font-semibold text-gray-900">{r.trust_code ?? 'No trust'}</td>
                  <td className="px-3 py-2.5 text-right"><Money n={r.held} strong /></td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">{r.bills_with_retention.toLocaleString('en-IN')}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">{r.parties}</td>
                  <td className="px-3 py-2.5 text-right">
                    {r.releases_pending > 0
                      ? <><Money n={r.releases_pending_amt} /><span className="block text-[11px] text-gray-500">{r.releases_pending} certificate{r.releases_pending === 1 ? '' : 's'}</span></>
                      : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right"><Money n={r.released_so_far} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50/60 flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <p className="text-[12px] font-semibold text-gray-900">Held from each firm</p>
            <p className="text-[11px] text-gray-500">Most held first · age of the oldest bill it sits on</p>
          </div>
          {byParty.rows.length > 40 && (
            <Link href={href(p, { all: !p.all })} className="text-[12px] font-semibold text-blue-700 hover:underline">
              {p.all ? 'Show top 40' : `Show all ${byParty.rows.length}`}
            </Link>
          )}
        </div>
        {byParty.error ? <QueryError message={byParty.error} what="retention by firm" /> : (
          <>
            <div className="overflow-x-auto hidden md:block">
              <table className="w-full text-sm">
                <thead><tr><Th>Firm</Th><Th>Trusts</Th><Th>Projects</Th><Th right>Held</Th><Th right>Bills</Th><Th right>Oldest bill</Th></tr></thead>
                <tbody>
                  {parties.map(r => (
                    <tr key={r.party_key} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-3 py-2.5">
                        <Link href={href(p, { view: 'party', party: r.party_key, all: false })} className="font-semibold text-blue-700 hover:underline">{r.party_name}</Link>
                        <Kinds kinds={r.kinds} />
                      </td>
                      <td className="px-3 py-2.5 text-[12px] text-gray-600">{r.trusts ?? '—'}</td>
                      <td className="px-3 py-2.5 text-[12px] text-gray-600 max-w-[260px] truncate" title={r.projects ?? ''}>{r.projects ?? '—'}</td>
                      <td className="px-3 py-2.5 text-right"><Money n={r.held} strong /></td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">{r.bills}</td>
                      <td className="px-3 py-2.5 text-right"><Age days={r.oldest_bill_days} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="md:hidden divide-y divide-gray-100">
              {parties.map(r => (
                <Link key={r.party_key} href={href(p, { view: 'party', party: r.party_key, all: false })} className="block px-4 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-semibold text-[13px] text-blue-700 truncate">{r.party_name}</span>
                    <Money n={r.held} strong />
                  </div>
                  <p className="text-[11.5px] text-gray-500 mt-0.5">{r.trusts ?? '—'} · {r.bills} bill{r.bills === 1 ? '' : 's'}{r.oldest_bill_days != null && <> · oldest {r.oldest_bill_days}d</>}</p>
                </Link>
              ))}
            </div>
          </>
        )}
      </Card>
    </div>
  )
}

// ── FY Wise ─────────────────────────────────────────────────────────────────
async function FyView({ p }: { p: Params }) {
  const { rows, error } = await loadByFy(p.raw)
  if (error) return <QueryError message={error} what="the financial-year totals" />
  if (rows.length === 0) return <Empty what="No certificates yet." />
  const t = totals(rows)
  const undated = rows.find(r => r.fy_start === null)

  return (
    <>
      {undated && undated.certificates > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-[13px] font-semibold text-amber-900">
            {undated.certificates.toLocaleString('en-IN')} certificates carry no date in IN4
          </p>
          <p className="text-[12px] text-amber-800 mt-0.5">
            {formatINR(undated.certified)} certified, {formatINR(undated.outstanding)} still outstanding.
            They cannot be placed in a year, so they are shown on their own row rather than dropped or folded into the current year.
          </p>
        </div>
      )}
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto hidden md:block">
          <table className="w-full text-sm">
            <thead><tr>
              <Th>Financial year</Th><Th right>Certificates</Th><Th right>Certified</Th>
              <Th right>Paid</Th><Th right>Outstanding</Th><Th right>Retention</Th>
            </tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.fy} className={`border-b border-gray-100 hover:bg-gray-50 ${r.fy_start === null ? 'bg-amber-50/40' : ''}`}>
                  <td className="px-3 py-2.5 font-semibold text-gray-900">{r.fy}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">{r.certificates.toLocaleString('en-IN')}</td>
                  <td className="px-3 py-2.5 text-right"><Money n={r.certified} /></td>
                  <td className="px-3 py-2.5 text-right"><Money n={r.paid} /></td>
                  <td className="px-3 py-2.5 text-right"><Money n={r.outstanding} strong /></td>
                  <td className="px-3 py-2.5 text-right"><Money n={r.retention} /></td>
                </tr>
              ))}
              <tr className="bg-gray-50 font-bold">
                <td className="px-3 py-2.5 text-gray-900">Every year</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-gray-900">{t.certificates.toLocaleString('en-IN')}</td>
                <td className="px-3 py-2.5 text-right"><Money n={t.certified} strong /></td>
                <td className="px-3 py-2.5 text-right"><Money n={t.paid} strong /></td>
                <td className="px-3 py-2.5 text-right"><Money n={t.outstanding} strong /></td>
                <td className="px-3 py-2.5 text-right"><Money n={t.retention} strong /></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="md:hidden divide-y divide-gray-100">
          {rows.map(r => (
            <div key={r.fy} className={`px-4 py-3 ${r.fy_start === null ? 'bg-amber-50/40' : ''}`}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-semibold text-[13px] text-gray-900">{r.fy}</span>
                <Money n={r.certified} strong />
              </div>
              <p className="text-[11.5px] text-gray-600 mt-1 tabular-nums">{r.certificates.toLocaleString('en-IN')} certificates · paid {formatINR(r.paid)}</p>
              <p className="text-[12px] mt-0.5">Outstanding <b className="tabular-nums text-gray-900">{formatINR(r.outstanding)}</b></p>
            </div>
          ))}
        </div>
      </Card>
    </>
  )
}

function Empty({ what }: { what: string }) {
  return <Card className="p-8 text-center text-sm text-gray-500">{what}</Card>
}
