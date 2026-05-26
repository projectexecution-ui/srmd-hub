import { Fragment } from 'react'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requirePermission, can, getMyProfile } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { formatINR, formatDateIN } from '@/lib/jmr/format'
import { AlertTriangle } from 'lucide-react'
import { BillActions } from './bill-actions'

export const dynamic = 'force-dynamic'

export default async function BillDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const perms = await requirePermission('jmr-bills', 'view')
  const profile = await getMyProfile()
  const isPM = can(perms, 'jmr-bills', 'edit') && (profile?.role === 'admin' || profile?.role === 'head')

  const { id } = await params
  const supabase = await createClient()

  const { data: bill } = await supabase
    .from('jmr_bills')
    .select(`
      *,
      jmr_contractors ( id, name, gst_number ),
      projects ( id, name, code ),
      jmr_bill_line_items (
        id, billed_quantity, jmr_quantity, rate, amount, variance, variance_pct,
        effective_from, effective_to,
        jmr_items ( name, unit, category )
      )
    `)
    .eq('id', id)
    .single()
  if (!bill) notFound()

  const photoUrl = bill.bill_photo_url ? (await supabase.storage.from('jmr-photos').createSignedUrl(bill.bill_photo_url, 3600)).data?.signedUrl : null

  // Supabase types the joined relations as arrays; unwrap them once here.
  type RelObj<T> = T | T[] | null | undefined
  function unwrap<T>(v: RelObj<T>): T | null {
    if (!v) return null
    return Array.isArray(v) ? (v[0] ?? null) : v
  }
  type LineItem = {
    id: string
    billed_quantity: number | string
    jmr_quantity: number | string
    rate: number | string
    amount: number | string
    variance: number | string
    variance_pct: number | string | null
    effective_from: string | null
    effective_to: string | null
    jmr_items?: RelObj<{ name: string; unit: string; category: string }>
  }
  const lines: LineItem[] = (bill.jmr_bill_line_items ?? []) as LineItem[]

  // Group lines by item so multi-rate items render with sub-rows.
  // Each "group" = one item; "rows" = each (rate, effective period) split.
  type ItemGroup = { name: string; unit: string; rows: LineItem[]; subtotal: number }
  const grouped: ItemGroup[] = (() => {
    const map = new Map<string, ItemGroup>()
    for (const l of lines) {
      const item = unwrap(l.jmr_items)
      const key = item?.name ?? l.id
      const g = map.get(key) ?? { name: item?.name ?? '—', unit: item?.unit ?? '', rows: [], subtotal: 0 }
      g.rows.push(l)
      g.subtotal += Number(l.amount)
      map.set(key, g)
    }
    for (const g of map.values()) {
      // Earliest period first within each item.
      g.rows.sort((a, b) => (a.effective_from ?? '').localeCompare(b.effective_from ?? ''))
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name))
  })()

  // Rate-period totals: every distinct rate band across the whole bill,
  // labelled A / B / C / … so the report can spell out the split.
  type Band = { label: string; rate: number; period: string; subtotal: number; qty: number; unit: string; itemNames: Set<string> }
  const bands: Band[] = (() => {
    const m = new Map<string, Band>()
    for (const l of lines) {
      const item = unwrap(l.jmr_items)
      const rate = Number(l.rate)
      const from = l.effective_from
      const to   = l.effective_to
      // Key bands by the rate value; if the same rate spans non-contiguous
      // periods across items we still treat them as one band.
      const key = `${rate}`
      const period = from && to
        ? (from === to ? from : `${from} → ${to}`)
        : '—'
      const prev = m.get(key)
      if (!prev) {
        m.set(key, { label: '', rate, period, subtotal: Number(l.amount), qty: Number(l.billed_quantity), unit: item?.unit ?? '', itemNames: new Set([item?.name ?? '']) })
      } else {
        prev.subtotal += Number(l.amount)
        prev.qty += Number(l.billed_quantity)
        prev.itemNames.add(item?.name ?? '')
        // Widen period range if needed.
        if (from && to) {
          const [pf, pt] = prev.period.split(' → ')
          const newFrom = pf < from ? pf : from
          const newTo   = pt && pt > to ? pt : to
          prev.period = newFrom === newTo ? newFrom : `${newFrom} → ${newTo}`
        }
      }
    }
    const list = Array.from(m.values()).sort((a, b) => a.period.localeCompare(b.period))
    list.forEach((b, i) => { b.label = String.fromCharCode(65 + i) }) // A, B, C, …
    return list
  })()
  const showBands = bands.length > 1
  const contractor = unwrap(bill.jmr_contractors as RelObj<{ id: string; name: string; gst_number?: string }>)
  const project = unwrap(bill.projects as RelObj<{ id: string; name: string; code?: string }>)

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <PageHeader
        title={`Bill ${bill.bill_number}`}
        subtitle={`${contractor?.name ?? ''} · ${project?.code || project?.name || ''}`}
        back="/jmr/bills"
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2 space-y-4">
          {bill.variance_flag && (
            <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 rounded-md px-3 py-2 text-sm text-rose-900">
              <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Variance flagged</p>
                <p className="text-xs opacity-80">One or more line items exceed the configured tolerance.</p>
              </div>
            </div>
          )}

          <Card className="p-4">
            <h3 className="text-sm font-bold text-gray-800 mb-3">Line items</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-2 py-2 text-left">Item · period</th>
                    <th className="px-2 py-2 text-right">JMR qty</th>
                    <th className="px-2 py-2 text-right">Billed</th>
                    <th className="px-2 py-2 text-right">Var.</th>
                    <th className="px-2 py-2 text-right">Rate</th>
                    <th className="px-2 py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {grouped.map(g => (
                    <Fragment key={g.name}>
                      {g.rows.map((l, i) => {
                        const flagged = Math.abs(Number(l.variance_pct) || 0) > 5
                        const period = l.effective_from && l.effective_to
                          ? (l.effective_from === l.effective_to ? formatDateIN(l.effective_from) : `${formatDateIN(l.effective_from)} → ${formatDateIN(l.effective_to)}`)
                          : null
                        return (
                          <tr key={l.id} className={`border-t border-gray-100 ${flagged ? 'bg-rose-50/60' : ''}`}>
                            <td className="px-2 py-2">
                              {i === 0 && <div className="font-medium text-gray-900">{g.name}</div>}
                              {period && <div className="text-[10px] text-gray-500">{period}</div>}
                            </td>
                            <td className="px-2 py-2 text-right text-gray-700">{Number(l.jmr_quantity)} {g.unit}</td>
                            <td className="px-2 py-2 text-right font-medium">{Number(l.billed_quantity)} {g.unit}</td>
                            <td className={`px-2 py-2 text-right ${flagged ? 'text-rose-700 font-semibold' : 'text-gray-500'}`}>
                              {Number(l.variance) > 0 ? '+' : ''}{Number(l.variance)} ({l.variance_pct != null ? `${Number(l.variance_pct).toFixed(1)}%` : '—'})
                            </td>
                            <td className="px-2 py-2 text-right font-mono">{formatINR(Number(l.rate))}</td>
                            <td className="px-2 py-2 text-right font-mono font-semibold">{formatINR(Number(l.amount))}</td>
                          </tr>
                        )
                      })}
                      {g.rows.length > 1 && (
                        <tr className="bg-gray-50/60">
                          <td colSpan={5} className="px-2 py-1 text-right text-[11px] text-gray-600 italic">
                            {g.name} sub-total
                          </td>
                          <td className="px-2 py-1 text-right font-mono text-[11px] font-semibold text-gray-700">
                            {formatINR(g.subtotal)}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50 text-sm">
                  <tr><td colSpan={5} className="px-2 py-1.5 text-right font-medium">Sub-total</td><td className="px-2 py-1.5 text-right font-mono">{formatINR(Number(bill.subtotal))}</td></tr>
                  <tr><td colSpan={5} className="px-2 py-1.5 text-right text-gray-600">GST {bill.gst_rate}%</td><td className="px-2 py-1.5 text-right font-mono">{formatINR(Number(bill.gst_amount))}</td></tr>
                  <tr className="font-bold"><td colSpan={5} className="px-2 py-2 text-right">Grand total</td><td className="px-2 py-2 text-right font-mono">{formatINR(Number(bill.total_amount))}</td></tr>
                </tfoot>
              </table>
            </div>
          </Card>

          {showBands && (
            <Card className="p-4 border-blue-200 bg-blue-50/30">
              <h3 className="text-sm font-bold text-gray-800 mb-2">Rate-period totals</h3>
              <p className="text-[11px] text-gray-500 mb-3">
                One or more items had different rates inside this bill period. Here&apos;s the split — each band&apos;s amount sums up to the grand total below.
              </p>
              <div className="space-y-1.5">
                {bands.map(b => (
                  <div key={b.label} className="flex items-baseline gap-2 text-xs">
                    <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-blue-600 text-white text-[10px] font-bold flex-shrink-0">{b.label}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-gray-800">
                        <span className="font-mono font-semibold">{formatINR(b.rate)}</span>
                        <span className="text-gray-500">/{b.unit}</span>
                        <span className="text-gray-500"> · {b.period}</span>
                      </div>
                      <div className="text-[10px] text-gray-500 truncate">
                        {Array.from(b.itemNames).join(', ')}
                      </div>
                    </div>
                    <div className="text-right font-mono font-semibold text-gray-900 whitespace-nowrap">
                      {formatINR(b.subtotal)}
                    </div>
                  </div>
                ))}
                <div className="pt-2 mt-2 border-t border-blue-200 flex items-baseline justify-between text-sm font-bold text-gray-900">
                  <span>{bands.map(b => b.label).join(' + ')} = Sub-total</span>
                  <span className="font-mono">{formatINR(Number(bill.subtotal))}</span>
                </div>
                <div className="flex items-baseline justify-between text-xs text-gray-600">
                  <span>+ GST {bill.gst_rate}%</span>
                  <span className="font-mono">{formatINR(Number(bill.gst_amount))}</span>
                </div>
                <div className="flex items-baseline justify-between text-sm font-bold text-gray-900">
                  <span>Grand total</span>
                  <span className="font-mono">{formatINR(Number(bill.total_amount))}</span>
                </div>
              </div>
            </Card>
          )}

          {photoUrl && (
            <Card className="p-3">
              <p className="text-xs text-gray-500 mb-2">Bill photo</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photoUrl} alt="Bill" className="max-h-96 mx-auto rounded" />
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card className="p-4 text-sm space-y-2">
            <Detail label="Bill date" value={formatDateIN(bill.bill_date)} />
            <Detail label="Period" value={`${formatDateIN(bill.period_from)} – ${formatDateIN(bill.period_to)}`} />
            <Detail label="Status" value={bill.status} />
            {bill.paid_on && <Detail label="Paid on" value={formatDateIN(bill.paid_on)} />}
            {bill.payment_ref && <Detail label="Payment ref" value={bill.payment_ref} />}
          </Card>
          {isPM && (
            <Card className="p-4">
              <h3 className="text-sm font-bold text-gray-800 mb-3">PM actions</h3>
              <BillActions bill={bill} />
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-gray-500 text-xs">{label}</span>
      <span className="font-medium text-gray-900 text-right">{value}</span>
    </div>
  )
}
