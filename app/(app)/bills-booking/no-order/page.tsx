import { createClient } from '@/lib/supabase/server'
import { requireBillsAccess } from '@/lib/bills-booking/access'
import { PageHeader } from '@/components/PageHeader'
import { QueryError } from '@/components/ui/query-error'

import { formatINR, formatDate } from '@/lib/utils'
import { loadOutOfScope, rowOutOfScope, SCOPE_NOTE } from '@/lib/bills-booking/scope'

export const dynamic = 'force-dynamic'

type Cert = {
  certificate_id: number; kind: string | null; display_no: string | null; wo_no: string | null
  contractor_name: string | null; project_id: number | null; status_name: string | null
  subproject_id: number | null
  outstanding_amt: number | null; invoice_no: string | null; invoice_date: string | null; creation_dt: string | null
}
type Wo = { wo_id: number; display_no: string | null; creation_dt: string | null }

const DEAD = new Set(['cancelled', 'reversed'])

/** Bills with no order behind them, in the two shapes that actually occur.
 *
 *  IN4 will not raise a payment certificate without a work order — not one of
 *  its 3,107 has a blank one — so "no WO" never shows up there as a state. It
 *  shows up as two other things, and this page is both of them. */
export default async function NoOrderPage() {
  await requireBillsAccess()
  const sb = await createClient()

  // PostgREST caps a plain select at 1,000 rows and returns the first page
  // without complaining, so every count on this screen would quietly be a
  // thousand-row sample rather than the truth.
  const page = async <T,>(table: string, cols: string): Promise<T[]> => {
    const out: T[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from(table).select(cols).range(from, from + 999)
      if (error) throw new Error(`${table}: ${error.message}`)
      const rows = (data ?? []) as unknown as T[]
      out.push(...rows)
      if (rows.length < 1000) return out
    }
  }

  let certs: Cert[] = []
  let wos: Wo[] = []
  let projRows: Array<{ id: number; name: string }> = []
  let err: string | null = null
  try {
    certs = await page<Cert>('in4_wo_certificates', 'certificate_id, kind, display_no, wo_no, contractor_name, project_id, subproject_id, status_name, outstanding_amt, invoice_no, invoice_date, creation_dt')
    const excluded = await loadOutOfScope(sb)
    certs = certs.filter(c => !rowOutOfScope(excluded, c.subproject_id))
    wos = await page<Wo>('in4_work_orders', 'wo_id, display_no, creation_dt')
    projRows = await page<{ id: number; name: string }>('in4_projects', 'id, name')
  } catch (e) { err = e instanceof Error ? e.message : String(e) }

  if (err) return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <PageHeader title="No work order" back="/bills-booking" />
      <QueryError message={err} />
    </div>
  )

  const projects = new Map(projRows.map(p => [p.id, p.name]))
  const live = (c: Cert) => !DEAD.has((c.status_name ?? '').trim().toLowerCase())

  // Shape one: misc expenses. These never have a work order by design — petty
  // cash, labour charges, tanker hire — and IN4 keeps them as a different
  // document, not as a certificate with a blank WO.
  const misc = certs.filter(c => c.kind === 'misc' && live(c) && Number(c.outstanding_amt || 0) > 0)
    .sort((a, b) => Number(b.outstanding_amt || 0) - Number(a.outstanding_amt || 0))
  const miscTotal = misc.reduce((s, c) => s + Number(c.outstanding_amt || 0), 0)

  // Shape two: the bill was written before the order existed. IN4 cannot show
  // this at all — it refuses the bill until the WO is there — so the wait
  // happens outside the system and only the two dates side by side reveal it.
  const woDate = new Map(wos.filter(w => w.display_no).map(w => [w.display_no as string, w.creation_dt]))
  const early = certs
    .filter(c => c.kind === 'wo' && live(c) && c.invoice_date && c.wo_no)
    .map(c => {
      const made = woDate.get(c.wo_no as string)
      if (!made || !c.invoice_date || c.invoice_date >= made) return null
      const ahead = Math.floor((new Date(made).getTime() - new Date(c.invoice_date).getTime()) / 86_400_000)
      return { c, made, ahead }
    })
    .filter((x): x is { c: Cert; made: string; ahead: number } => x != null)
    .sort((a, b) => b.ahead - a.ahead)

  const overAMonth = early.filter(e => e.ahead > 30)

  // Counted, not asserted. It was a typed "0" — true when it was written,
  // and unable to notice if IN4 ever let one through.
  const blankWo = certs.filter(c => c.kind === 'wo' && live(c) && !c.wo_no).length

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-5">
      <PageHeader
        title="No work order"
        subtitle="Bills with no order behind them, and bills that arrived before their order existed. Admin only."
        back="/bills-booking"
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-px rounded-xl overflow-hidden border border-gray-200 bg-gray-200">
        <Stat k="Misc expenses open" v={formatINR(miscTotal)} s={`${misc.length} bills, never have a WO`} />
        <Stat k="Billed before the order" v={String(early.length)} s="of all live work-order bills" />
        <Stat k="Waited over a month" v={String(overAMonth.length)} s="the ones worth looking at" />
        <Stat k="Certificates with no WO" v={String(blankWo)} s={blankWo === 0 ? 'IN4 refuses to raise one' : 'IN4 let these through — look'} />
      </div>

      <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-600">
        <b>Why there is no third list.</b> Not one of IN4&apos;s work-order certificates has a blank work order —
        it will not let you raise one. So a bill that arrives before its order simply waits outside the system
        until somebody writes the WO, and nothing counts it while it waits. The second table below is that wait,
        reconstructed from the only trace it leaves: the bill&apos;s own date being earlier than the order&apos;s.
      </div>

      <section className="space-y-2">
        <h2 className="text-[11px] uppercase tracking-wide font-semibold text-gray-700">
          Misc expenses still owed — no work order, by design
        </h2>
        {misc.length === 0 ? (
          <p className="text-sm text-gray-500 rounded-xl border border-gray-200 bg-white px-4 py-6 text-center">Nothing outstanding.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                  <th className="text-left font-semibold px-3 py-2">Bill no.</th>
                  <th className="text-left font-semibold px-3 py-2">Paid to</th>
                  <th className="text-left font-semibold px-3 py-2">Project</th>
                  <th className="text-right font-semibold px-3 py-2">Outstanding</th>
                  <th className="text-left font-semibold px-3 py-2">Raised</th>
                  <th className="text-left font-semibold px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {misc.map(c => (
                  <tr key={`m${c.certificate_id}`} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                    <td className="px-3 py-2 font-mono text-[11px]">{c.invoice_no || `#${c.certificate_id}`}</td>
                    <td className="px-3 py-2">{c.contractor_name || '—'}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{(c.project_id != null && projects.get(c.project_id)) || '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">{formatINR(Number(c.outstanding_amt || 0))}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-gray-500">{c.creation_dt ? formatDate(c.creation_dt) : '—'}</td>
                    <td className="px-3 py-2 text-xs">{c.status_name || '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
                  <td className="px-3 py-2" colSpan={3}>{misc.length} bills</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatINR(miscTotal)}</td>
                  <td className="px-3 py-2" colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-[11px] uppercase tracking-wide font-semibold text-amber-700">
          Billed before the order was written — waited over a month
        </h2>
        {overAMonth.length === 0 ? (
          <p className="text-sm text-gray-500 rounded-xl border border-gray-200 bg-white px-4 py-6 text-center">
            Every bill&apos;s order was written within a month of the bill date.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                  <th className="text-left font-semibold px-3 py-2">Certificate</th>
                  <th className="text-left font-semibold px-3 py-2">Contractor</th>
                  <th className="text-left font-semibold px-3 py-2">Work order</th>
                  <th className="text-left font-semibold px-3 py-2">Bill dated</th>
                  <th className="text-left font-semibold px-3 py-2">Order written</th>
                  <th className="text-right font-semibold px-3 py-2">Waited</th>
                </tr>
              </thead>
              <tbody>
                {overAMonth.map(({ c, made, ahead }) => (
                  <tr key={`e${c.certificate_id}`} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                    <td className="px-3 py-2 font-mono text-[11px]">{c.display_no || `#${c.certificate_id}`}</td>
                    <td className="px-3 py-2">{c.contractor_name || '—'}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-gray-500">{c.wo_no}</td>
                    <td className="px-3 py-2 font-mono text-[11px]">{formatDate(c.invoice_date!)}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-gray-500">{formatDate(made)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${ahead > 180 ? 'text-red-600 font-semibold' : 'text-amber-600'}`}>{ahead} d</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
                  <td className="px-3 py-2" colSpan={6}>
                    {overAMonth.length} bills waited over a month ·
                    {' '}{early.length - overAMonth.length} more were inside a month, which is just paperwork catching up
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      <p className="text-xs text-gray-500">
        Cancelled and reversed certificates are excluded from both tables. The second table compares the bill&apos;s own
        invoice date against the day its work order was created — the only evidence the wait leaves behind, since the
        bill cannot enter IN4 until the order exists. {SCOPE_NOTE}
      </p>
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
