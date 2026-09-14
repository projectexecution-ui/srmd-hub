import { createClient } from '@/lib/supabase/server'
import { requireBillsAccess } from '@/lib/bills-booking/access'
import { PageHeader } from '@/components/PageHeader'
import { QueryError } from '@/components/ui/query-error'
import { EmptyState } from '@/components/ui/empty-state'
import { ShieldCheck } from 'lucide-react'
import { formatINR } from '@/lib/utils'
import { formatDateTime } from '@/lib/utils'
import { CheckNowButton } from './CheckNowButton'
import { CardList, Card as MCard, CardTotal } from '../Cards'

export const dynamic = 'force-dynamic'

type Row = {
  id: string; certificate_id: number; display_no: string | null; wo_no: string | null
  contractor_name: string | null; project_name: string | null
  sanctioned_amount: number; sanctioned_at: string; note: string | null
  verdict: string | null; in4_amount: number | null; in4_status: string | null
  in4_approved_by: string | null; checked_at: string | null
  profiles: { full_name: string | null } | { full_name: string | null }[] | null
}

const VERDICT: Record<string, { label: string; cls: string }> = {
  matched:        { label: 'Matched',        cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  amount_differs: { label: 'Does not match', cls: 'bg-red-50 text-red-700 border-red-200' },
  awaiting_in4:   { label: 'Awaiting IN4',   cls: 'bg-gray-50 text-gray-600 border-gray-200' },
  gone:           { label: 'Gone from IN4',  cls: 'bg-red-50 text-red-700 border-red-200' },
}

/** Every sanction, and whether IN4 agreed. Admin only.
 *
 *  This is the record of who approved what — IN4's own trail names whoever in
 *  Billing keyed it in, so if this list is wrong there is nothing else. */
export default async function SanctionsPage() {
  await requireBillsAccess()
  const sb = await createClient()

  const { data, error } = await sb
    .from('bb_sanctions')
    .select('id, certificate_id, display_no, wo_no, contractor_name, project_name, sanctioned_amount, sanctioned_at, note, verdict, in4_amount, in4_status, in4_approved_by, checked_at, profiles:sanctioned_by(full_name)')
    .is('superseded_by', null)
    .order('sanctioned_at', { ascending: false })

  if (error) return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <PageHeader title="Sanctions" back="/bills-booking" />
      <QueryError message={error.message} />
    </div>
  )

  const rows = (data ?? []) as unknown as Row[]
  const one = (v: Row['profiles']) => (Array.isArray(v) ? v[0] : v)
  const n = (v: string | null) => rows.filter(r => r.verdict === v).length
  const differs = n('amount_differs') + n('gone')

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <PageHeader
        title="Sanctions"
        subtitle="What was approved here, and whether IN4 ended up agreeing. Admin only."
        back="/bills-booking"
      >
        <CheckNowButton />
      </PageHeader>

      {rows.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck className="h-8 w-8" />}
          title="Nothing sanctioned yet"
          description="Sanction a bill from In flight and it appears here, with the IN4 comparison attached."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-px rounded-xl overflow-hidden border border-gray-200 bg-gray-200">
            <Stat k="Sanctioned" v={formatINR(rows.reduce((s, r) => s + Number(r.sanctioned_amount || 0), 0))} s={`${rows.length} bills`} />
            <Stat k="Matched" v={String(n('matched'))} s="IN4 agrees" />
            <Stat k="Needs a look" v={String(differs)} s="different, or gone" />
            <Stat k="Awaiting IN4" v={String(n('awaiting_in4'))} s="not keyed in yet" />
          </div>

          {differs > 0 && (
            <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {differs} {differs === 1 ? 'sanction does' : 'sanctions do'} not agree with IN4. Each one has been sent to
              whoever sanctioned it and to every admin.
            </p>
          )}

          {/* Phone */}
          <CardList>
            {rows.map(r => {
              const v = VERDICT[r.verdict ?? ''] ?? { label: 'Not checked yet', cls: '' }
              const diff = r.in4_amount != null ? Number(r.in4_amount) - Number(r.sanctioned_amount) : null
              const bad = r.verdict === 'amount_differs' || r.verdict === 'gone'
              return (
                <MCard key={r.id} flagged={bad}
                       title={r.display_no || r.wo_no || 'no number in IN4'}
                       sub={<>{r.contractor_name || '—'}{r.project_name ? ` · ${r.project_name}` : ''}</>}
                       amount={formatINR(Number(r.sanctioned_amount))} amountLabel="sanctioned"
                       facts={[
                         { k: 'Verdict', v: v.label, tone: bad ? 'bad' : r.verdict === 'matched' ? 'good' : undefined },
                         { k: 'IN4 says', v: r.in4_amount == null ? '—' : formatINR(Number(r.in4_amount)), tone: diff != null && Math.abs(diff) > 1 ? 'bad' : undefined },
                         { k: 'Sanctioned by', v: one(r.profiles)?.full_name || '—' },
                         { k: 'Keyed into IN4 by', v: r.in4_approved_by || '—' },
                       ]}
                       note={formatDateTime(r.sanctioned_at)} />
              )
            })}
            <CardTotal n={rows.length} label="sanctions" amount={formatINR(rows.reduce((s, r) => s + Number(r.sanctioned_amount || 0), 0))} />
          </CardList>

          {/* Desktop */}
          <div className="hidden overflow-x-auto rounded-xl border border-gray-200 bg-white md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                  <th className="text-left font-semibold px-3 py-2">Certificate</th>
                  <th className="text-left font-semibold px-3 py-2">Contractor</th>
                  <th className="text-right font-semibold px-3 py-2">Sanctioned</th>
                  <th className="text-right font-semibold px-3 py-2">IN4 says</th>
                  <th className="text-left font-semibold px-3 py-2">Verdict</th>
                  <th className="text-left font-semibold px-3 py-2">Sanctioned by</th>
                  <th className="text-left font-semibold px-3 py-2">Keyed into IN4 by</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const v = VERDICT[r.verdict ?? ''] ?? { label: 'Not checked yet', cls: 'bg-gray-50 text-gray-500 border-gray-200' }
                  const diff = r.in4_amount != null ? Number(r.in4_amount) - Number(r.sanctioned_amount) : null
                  return (
                    <tr key={r.id} className={`border-b border-gray-100 last:border-0 ${r.verdict === 'amount_differs' || r.verdict === 'gone' ? 'bg-red-50/40' : 'hover:bg-gray-50'}`}>
                      <td className="px-3 py-2 font-mono text-[11px]">
                        {r.display_no || `#${r.certificate_id}`}
                        <span className="block text-gray-400">{r.wo_no}</span>
                      </td>
                      <td className="px-3 py-2">
                        {r.contractor_name || '—'}
                        <span className="block text-[11px] text-gray-400">{r.project_name}</span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">{formatINR(Number(r.sanctioned_amount))}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {r.in4_amount == null ? '—' : formatINR(Number(r.in4_amount))}
                        {diff != null && Math.abs(diff) > 1 && (
                          <span className="block text-[11px] text-red-600 font-semibold">
                            {diff > 0 ? '+' : '−'}{formatINR(Math.abs(diff))}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-block text-[10.5px] font-semibold rounded-full border px-2 py-0.5 ${v.cls}`}>{v.label}</span>
                        {r.in4_status && <span className="block text-[10.5px] text-gray-400 mt-0.5">IN4: {r.in4_status}</span>}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {one(r.profiles)?.full_name || '—'}
                        <span className="block text-[10.5px] text-gray-400">{formatDateTime(r.sanctioned_at)}</span>
                      </td>
                      <td className="px-3 py-2 text-xs">{r.in4_approved_by || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-gray-500">
            The sanctioned figure is fixed at the moment of the click and cannot be edited — the table has no
            update policy for any user, only for the sweep that writes the verdict. A sanction made in error is
            corrected by making a new one; the old row stays. Checked twice a day, and it keeps checking until
            the bill is paid, because about one certificate in eight moves again after being approved.
          </p>
        </>
      )}
    </div>
  )
}

function Stat({ k, v, s }: { k: string; v: string; s: string }) {
  return (
    <div className="bg-white px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">{k}</div>
      <div className="text-xl font-medium tabular-nums mt-0.5">{v}</div>
      <div className="text-[11px] text-gray-500">{s}</div>
    </div>
  )
}
