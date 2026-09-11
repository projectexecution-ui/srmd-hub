// Accounts — money across the whole hub, not one project.
//
// Three questions whose answers span every project, which is exactly why this
// is its own lane and not a tab inside a project: a trust's total, a party's
// ledger (Desai Construction runs across 14 projects), and a financial year.
//
// Gated twice, like every restricted screen here: the lane is hidden for anyone
// not on the list, and this page refuses the URL, so nothing "goes through URL".
// The RPCs behind it check the same list a third time.

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { QueryError } from '@/components/ui/query-error'
import { requirePermission } from '@/lib/auth'
import { canOpenAccounts } from '@/lib/revamp/accounts-access'
import { formatINR, formatDate } from '@/lib/utils'
import {
  loadByTrust, loadByParty, loadByFy, loadPartyLedger, totals,
  type PartyRow,
} from '@/lib/revamp/accounts-hub'

export const dynamic = 'force-dynamic'

const VIEWS = [
  { key: 'trust', label: 'Trustwise' },
  { key: 'party', label: 'Party wise Ledger' },
  { key: 'fy',    label: 'FY Wise' },
] as const
type ViewKey = (typeof VIEWS)[number]['key']

/** Money column — right-aligned, tabular, and a dash rather than ₹0 so a
 *  column of real figures is not diluted by zeroes. */
function Money({ n, strong = false }: { n: number; strong?: boolean }) {
  return (
    <span className={`tabular-nums whitespace-nowrap ${strong ? 'font-bold text-gray-900' : 'text-gray-700'}`}>
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

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; kind?: string; party?: string }>
}) {
  await requirePermission('cost-control', 'view')
  // The second gate. A person not on the list never sees the lane; typing the
  // address must not be a way in either.
  if (!(await canOpenAccounts())) redirect('/dashboard')

  const sp = await searchParams
  const view: ViewKey = VIEWS.some(v => v.key === sp.view) ? (sp.view as ViewKey) : 'trust'
  const partyId = sp.party && /^\d+$/.test(sp.party) ? Number(sp.party) : null
  const partyKind = sp.kind === 'supplier' ? 'supplier' : 'contractor'

  const tab = (key: ViewKey, label: string) => (
    <Link
      key={key}
      href={`/accounts?view=${key}`}
      className={`inline-flex items-center min-h-[38px] px-3 rounded-t-lg text-[13px] font-semibold border-b-2 ${
        view === key
          ? 'border-blue-600 text-blue-700 bg-blue-50/60'
          : 'border-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-50'
      }`}
    >
      {label}
    </Link>
  )

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <PageHeader
        title="Accounts"
        subtitle="Every project, every trust — certified, paid and outstanding as IN4 holds them"
      />

      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {VIEWS.map(v => tab(v.key, v.label))}
      </div>

      {view === 'trust' && <TrustView />}
      {view === 'fy' && <FyView />}
      {view === 'party' && (partyId === null ? <PartyView /> : <LedgerView kind={partyKind} partyId={partyId} />)}

      <p className="text-[11.5px] text-gray-500">
        Read from the IN4 certificate mirror. Certified, paid, outstanding and retention are
        IN4&rsquo;s own figures and are not derived from one another — IN4 nets recoveries,
        deductions and advance recovery in its own way.
      </p>
    </div>
  )
}

// ── Trustwise ───────────────────────────────────────────────────────
async function TrustView() {
  const { rows, error } = await loadByTrust()
  if (error) return <QueryError message={error} what="the trust totals" />
  if (rows.length === 0) return <Empty what="No certificates yet." />
  const t = totals(rows)

  return (
    <Card className="overflow-hidden p-0">
      <div className="overflow-x-auto hidden md:block">
        <table className="w-full text-sm">
          <thead><tr>
            <Th>Trust</Th><Th right>Certificates</Th><Th right>Certified</Th>
            <Th right>Paid</Th><Th right>Outstanding</Th><Th right>Retention</Th>
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.trust_id ?? 'none'} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-3 py-2.5">
                  <span className="font-semibold text-gray-900">{r.trust_code ?? 'No trust on the project'}</span>
                  {r.trust_name && r.trust_name !== r.trust_code && (
                    <span className="block text-[11.5px] text-gray-500">{r.trust_name}</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">{r.certificates.toLocaleString('en-IN')}</td>
                <td className="px-3 py-2.5 text-right"><Money n={r.certified} /></td>
                <td className="px-3 py-2.5 text-right"><Money n={r.paid} /></td>
                <td className="px-3 py-2.5 text-right"><Money n={r.outstanding} strong /></td>
                <td className="px-3 py-2.5 text-right"><Money n={r.retention} /></td>
              </tr>
            ))}
            <tr className="bg-gray-50 font-bold">
              <td className="px-3 py-2.5 text-gray-900">All trusts</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-gray-900">{t.certificates.toLocaleString('en-IN')}</td>
              <td className="px-3 py-2.5 text-right"><Money n={t.certified} strong /></td>
              <td className="px-3 py-2.5 text-right"><Money n={t.paid} strong /></td>
              <td className="px-3 py-2.5 text-right"><Money n={t.outstanding} strong /></td>
              <td className="px-3 py-2.5 text-right"><Money n={t.retention} strong /></td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Six columns will not survive 375px. */}
      <div className="md:hidden divide-y divide-gray-100">
        {rows.map(r => (
          <div key={r.trust_id ?? 'none'} className="px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-semibold text-[13px] text-gray-900">{r.trust_code ?? 'No trust'}</span>
              <Money n={r.certified} strong />
            </div>
            {r.trust_name && <p className="text-[11.5px] text-gray-500 mt-0.5">{r.trust_name}</p>}
            <p className="text-[11.5px] text-gray-600 mt-1 tabular-nums">
              {r.certificates.toLocaleString('en-IN')} certificates · paid {formatINR(r.paid)}
            </p>
            <p className="text-[12px] mt-0.5">
              Outstanding <b className="tabular-nums text-gray-900">{formatINR(r.outstanding)}</b>
            </p>
          </div>
        ))}
        <div className="px-4 py-3 bg-gray-50">
          <p className="text-[12px] font-bold text-gray-900">
            All trusts · {formatINR(t.certified)} certified · {formatINR(t.outstanding)} outstanding
          </p>
        </div>
      </div>
    </Card>
  )
}

// ── FY Wise ─────────────────────────────────────────────────────────
async function FyView() {
  const { rows, error } = await loadByFy()
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
            They cannot be placed in a year, so they are shown on their own row rather than dropped
            or folded into the current year.
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
              <p className="text-[11.5px] text-gray-600 mt-1 tabular-nums">
                {r.certificates.toLocaleString('en-IN')} certificates · paid {formatINR(r.paid)}
              </p>
              <p className="text-[12px] mt-0.5">
                Outstanding <b className="tabular-nums text-gray-900">{formatINR(r.outstanding)}</b>
              </p>
            </div>
          ))}
        </div>
      </Card>
    </>
  )
}

// ── Party wise ──────────────────────────────────────────────────────
async function PartyView() {
  const { rows, error } = await loadByParty()
  if (error) return <QueryError message={error} what="the party totals" />
  if (rows.length === 0) return <Empty what="No certificates yet." />
  const t = totals(rows)

  const href = (r: PartyRow) => `/accounts?view=party&kind=${r.kind}&party=${r.party_id ?? 0}`

  return (
    <Card className="overflow-hidden p-0">
      <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50/60">
        <p className="text-[11.5px] text-gray-600">
          {rows.length.toLocaleString('en-IN')} parties · <b className="text-gray-900">{formatINR(t.outstanding)}</b> outstanding
          in total. Highest outstanding first — open a party for its ledger.
        </p>
      </div>

      <div className="overflow-x-auto hidden md:block">
        <table className="w-full text-sm">
          <thead><tr>
            <Th>Party</Th><Th right>Projects</Th><Th right>Certified</Th>
            <Th right>Paid</Th><Th right>Outstanding</Th><Th right>Retention</Th>
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={`${r.kind}:${r.party_id}`} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-3 py-2.5">
                  <Link href={href(r)} className="font-semibold text-blue-700 hover:underline">{r.party_name}</Link>
                  <span className="ml-2 text-[10px] font-bold uppercase tracking-wide text-gray-400">{r.kind}</span>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">{r.projects}</td>
                <td className="px-3 py-2.5 text-right"><Money n={r.certified} /></td>
                <td className="px-3 py-2.5 text-right"><Money n={r.paid} /></td>
                <td className="px-3 py-2.5 text-right"><Money n={r.outstanding} strong /></td>
                <td className="px-3 py-2.5 text-right"><Money n={r.retention} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="md:hidden divide-y divide-gray-100">
        {rows.map(r => (
          <Link key={`${r.kind}:${r.party_id}`} href={href(r)} className="block px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-semibold text-[13px] text-blue-700 truncate">{r.party_name}</span>
              <Money n={r.outstanding} strong />
            </div>
            <p className="text-[11.5px] text-gray-500 mt-0.5">
              {r.kind} · {r.projects} project{r.projects === 1 ? '' : 's'} · {r.certificates} certificates
            </p>
            <p className="text-[11.5px] text-gray-600 mt-0.5 tabular-nums">
              Certified {formatINR(r.certified)} · paid {formatINR(r.paid)}
            </p>
          </Link>
        ))}
      </div>
    </Card>
  )
}

// ── One party's ledger ──────────────────────────────────────────────
async function LedgerView({ kind, partyId }: { kind: string; partyId: number }) {
  const [{ rows, error }, parties] = await Promise.all([
    loadPartyLedger(kind, partyId),
    loadByParty(),
  ])
  if (error) return <QueryError message={error} what="this party's ledger" />
  const party = parties.rows.find(p => p.kind === kind && p.party_id === partyId)
  const t = totals(rows)

  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-base font-bold text-gray-900 truncate">{party?.party_name ?? 'Party ledger'}</h2>
          <p className="text-[12px] text-gray-600">
            {kind} · {rows.length.toLocaleString('en-IN')} certificate{rows.length === 1 ? '' : 's'}
            {party ? ` across ${party.projects} project${party.projects === 1 ? '' : 's'}` : ''}
          </p>
        </div>
        <Link href="/accounts?view=party" className="text-[12.5px] font-semibold text-blue-700 hover:underline">
          ← All parties
        </Link>
      </div>

      {rows.length === 0 ? <Empty what="No certificates for this party." /> : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto hidden md:block">
            <table className="w-full text-sm">
              <thead><tr>
                <Th>Date</Th><Th>Reference</Th><Th>Project</Th>
                <Th right>Certified</Th><Th right>Paid</Th><Th right>Outstanding</Th><Th right>Retention</Th>
              </tr></thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.certificate_id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2 text-[12.5px] text-gray-600 whitespace-nowrap">
                      {r.doc_date ? formatDate(r.doc_date) : <span className="text-amber-700">no date</span>}
                    </td>
                    <td className="px-3 py-2 text-[12.5px] text-gray-700">
                      {r.ref_no ?? '—'}
                      {r.order_no && <span className="block text-[11px] text-gray-400">{r.order_no}</span>}
                    </td>
                    <td className="px-3 py-2 text-[12.5px] text-gray-700">{r.project_code ?? r.project_name ?? '—'}</td>
                    <td className="px-3 py-2 text-right"><Money n={r.certified} /></td>
                    <td className="px-3 py-2 text-right"><Money n={r.paid} /></td>
                    <td className="px-3 py-2 text-right"><Money n={r.outstanding} strong /></td>
                    <td className="px-3 py-2 text-right"><Money n={r.retention} /></td>
                  </tr>
                ))}
                <tr className="bg-gray-50 font-bold">
                  <td className="px-3 py-2.5 text-gray-900" colSpan={3}>Total</td>
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
              <div key={r.certificate_id} className="px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[12.5px] font-semibold text-gray-900">{r.ref_no ?? `#${r.certificate_id}`}</span>
                  <Money n={r.certified} strong />
                </div>
                <p className="text-[11.5px] text-gray-500 mt-0.5">
                  {r.doc_date ? formatDate(r.doc_date) : 'no date'} · {r.project_code ?? r.project_name ?? '—'}
                </p>
                <p className="text-[11.5px] text-gray-600 mt-0.5 tabular-nums">
                  Paid {formatINR(r.paid)} · outstanding {formatINR(r.outstanding)}
                </p>
              </div>
            ))}
            <div className="px-4 py-3 bg-gray-50">
              <p className="text-[12px] font-bold text-gray-900">
                Total {formatINR(t.certified)} certified · {formatINR(t.outstanding)} outstanding
              </p>
            </div>
          </div>
        </Card>
      )}
    </>
  )
}

function Empty({ what }: { what: string }) {
  return <Card className="p-8 text-center text-sm text-gray-500">{what}</Card>
}
