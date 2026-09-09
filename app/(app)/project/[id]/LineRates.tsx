'use client'

import { useState } from 'react'
import { History, TrendingUp, TrendingDown } from 'lucide-react'
import { formatINR, formatDate } from '@/lib/utils'
import { fetchOrderLineRates } from './line-rates-actions'
import type { OrderLineRates, LineRate as LineRateInfo } from '@/lib/revamp/line-rates'

/**
 * "What did we pay last time?" for a whole order, on one click (Aksha, 9 Sep
 * 2026 — the per-line chip was tedious). One button beside the item list; it
 * loads the order's lines straight from IN4 (authoritative names, rates and
 * history — no fragile matching against the tree's indent-sourced names) and
 * shows each line's last rate, the change against this order, how often it has
 * been bought, or "new — never bought", with same-unit near-name suggestions.
 */

const cache = new Map<string, Promise<OrderLineRates>>()
function getOrderRates(kind: 'wo' | 'po', in4Id: number | null, ref: string | null): Promise<OrderLineRates> {
  const k = `${kind}:${in4Id ?? 'ref'}:${ref ?? ''}`
  let p = cache.get(k)
  if (!p) { p = fetchOrderLineRates(kind, in4Id, ref); cache.set(k, p) }
  return p
}

type Load = 'idle' | 'loading' | 'done' | 'error'

export function RateCheck({ kind, in4Id, orderRef }: { kind: 'wo' | 'po'; in4Id: number | null; orderRef: string | null }) {
  const [open, setOpen] = useState(false)
  const [load, setLoad] = useState<Load>('idle')
  const [data, setData] = useState<OrderLineRates | null>(null)

  if (in4Id == null && !orderRef) return null

  async function toggle() {
    if (open) { setOpen(false); return }
    setOpen(true)
    if (load === 'done' || load === 'loading') return
    setLoad('loading')
    try {
      const res = await getOrderRates(kind, in4Id, orderRef)
      setData(res)
      setLoad(res.error || res.in4 !== 'live' ? 'error' : 'done')
    } catch {
      setLoad('error')
    }
  }

  const withHistory = data ? data.lines.filter(l => l.last || l.lastHere).length : 0

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={toggle}
        className="inline-flex items-center gap-1.5 rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[12px] font-semibold text-indigo-700 hover:bg-indigo-100"
      >
        <History className="h-3.5 w-3.5" />
        Rate check
        {load === 'done' && <span className="font-normal text-indigo-500">· {withHistory} of {data!.lines.length} bought before</span>}
        <span className="text-indigo-400">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className="mt-2 rounded-lg border border-gray-200 bg-white">
          {load === 'loading' && <p className="px-3 py-3 text-[12px] text-gray-500">Checking IN4 for previous rates…</p>}
          {load === 'error' && (
            <p className="px-3 py-3 text-[12px] text-gray-500">
              {data?.in4 === 'not-configured' ? 'Rate history is not available here.' : 'Could not read the rate history from IN4 — try again in a moment.'}
            </p>
          )}
          {load === 'done' && data && <RateTable lines={data.lines} />}
        </div>
      )}
    </div>
  )
}

function RateTable({ lines }: { lines: LineRateInfo[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px] min-w-[560px]">
        <thead className="text-left text-[11px] uppercase tracking-wide text-gray-400">
          <tr className="border-b border-gray-100">
            <th className="px-3 py-1.5">Item</th>
            <th className="px-2 py-1.5">Unit</th>
            <th className="px-2 py-1.5 text-right">This order</th>
            <th className="px-2 py-1.5 text-right">Last rate</th>
            <th className="px-2 py-1.5 text-right">Change</th>
            <th className="px-2 py-1.5 text-right whitespace-nowrap">Bought</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {lines.map((l, i) => <RateRow key={i} l={l} />)}
        </tbody>
      </table>
    </div>
  )
}

function RateRow({ l }: { l: LineRateInfo }) {
  const ref = l.lastHere ?? l.last
  const d = l.deltaPct
  const tone = d == null ? 'text-gray-400' : d > 2 ? 'text-rose-700' : d < -2 ? 'text-emerald-700' : 'text-gray-500'
  const Icon = d != null && d > 2 ? TrendingUp : d != null && d < -2 ? TrendingDown : null

  return (
    <tr className="align-top">
      <td className="px-3 py-2 text-gray-800">
        <p>{l.name}</p>
        {!ref && (
          l.suggestions.length > 0 ? (
            <div className="mt-1 text-[11px] text-gray-500">
              <span className="text-amber-700 font-medium">New item.</span> Similar bought before:
              <ul className="mt-0.5 space-y-0.5">
                {l.suggestions.map((s, i) => (
                  <li key={i} className="flex justify-between gap-3">
                    <span className="text-gray-600 truncate">{s.name}</span>
                    <span className="tabular-nums text-gray-500 whitespace-nowrap">{formatINR(s.lastRate)}{s.uom ? `/${s.uom}` : ''}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : <p className="mt-0.5 text-[11px] text-amber-700">New item — never bought before.</p>
        )}
        {ref && ref === l.last && !l.lastHere && (
          <p className="mt-0.5 text-[11px] text-gray-400">Last bought {ref.project ? `on ${ref.project}` : 'elsewhere'}{ref.supplier ? ` · ${ref.supplier}` : ''}{ref.date ? ` · ${formatDate(ref.date)}` : ''}</p>
        )}
        {ref && l.lastHere && (
          <p className="mt-0.5 text-[11px] text-gray-400">On this project{ref.supplier ? ` · ${ref.supplier}` : ''}{ref.date ? ` · ${formatDate(ref.date)}` : ''}{l.last && l.last.rate !== l.lastHere.rate ? ` · elsewhere ${formatINR(l.last.rate)}` : ''}</p>
        )}
      </td>
      <td className="px-2 py-2 text-gray-500 whitespace-nowrap">{l.uom ?? ''}</td>
      <td className="px-2 py-2 text-right tabular-nums text-gray-900">{l.currentRate == null ? '—' : formatINR(l.currentRate)}</td>
      <td className="px-2 py-2 text-right tabular-nums text-gray-700">{ref ? formatINR(ref.rate) : <span className="text-gray-300">—</span>}</td>
      <td className={`px-2 py-2 text-right tabular-nums font-medium ${tone}`}>
        {d == null ? '' : (
          <span className="inline-flex items-center gap-0.5 justify-end">
            {Icon && <Icon className="h-3 w-3" />}
            {d > 0 ? '+' : ''}{Math.round(d)}%
          </span>
        )}
      </td>
      <td className="px-2 py-2 text-right tabular-nums text-gray-500 whitespace-nowrap">{l.timesBought > 0 ? `${l.timesBought}×` : ''}</td>
    </tr>
  )
}
