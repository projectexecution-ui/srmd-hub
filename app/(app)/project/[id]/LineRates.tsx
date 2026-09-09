'use client'

import { useState } from 'react'
import { History, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { formatINR, formatDate } from '@/lib/utils'
import { fetchOrderLineRates } from './line-rates-actions'
import type { OrderLineRates, LineRate as LineRateInfo } from '@/lib/revamp/line-rates'

/**
 * "What did we pay last time?" on one line in the WO/PO tree, opened on demand
 * (Aksha, 9 Sep 2026). A small chip beside a line; on click it loads the whole
 * order's rate history ONCE (shared across the order's lines through the cache
 * below) and shows this line's: last rate here vs elsewhere, the change against
 * the current rate, supplier and date, how often it has been bought — or
 * "never bought before", with near-name suggestions from past purchases.
 */

// One fetch per order, shared by every line's chip. Keyed by the order; a PO
// with no captured header id falls back to its number.
const cache = new Map<string, Promise<OrderLineRates>>()
function getOrderRates(kind: 'wo' | 'po', in4Id: number | null, ref: string | null): Promise<OrderLineRates> {
  const k = `${kind}:${in4Id ?? 'ref'}:${ref ?? ''}`
  let p = cache.get(k)
  if (!p) { p = fetchOrderLineRates(kind, in4Id, ref); cache.set(k, p) }
  return p
}

type Load = 'idle' | 'loading' | 'done' | 'error'

export function LineRate({
  kind, in4Id, orderRef, matchKey, itemId, block,
}: {
  kind: 'wo' | 'po'
  in4Id: number | null
  orderRef: string | null
  /** normaliseBoq(name, uom), computed server-side — how a PO line is matched. */
  matchKey: string
  /** BOQ item id for a WO line; null for a PO line. */
  itemId: number | null
  /** Mobile card lays the chip on its own line. */
  block?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [load, setLoad] = useState<Load>('idle')
  const [entry, setEntry] = useState<LineRateInfo | null>(null)
  const [in4, setIn4] = useState<OrderLineRates['in4']>('live')

  if (in4Id == null && !orderRef) return null

  async function toggle() {
    if (open) { setOpen(false); return }
    setOpen(true)
    if (load === 'done' || load === 'loading') return
    setLoad('loading')
    try {
      const res = await getOrderRates(kind, in4Id, orderRef)
      const found = res.lines.find(l => (itemId != null && l.itemId === itemId) || l.key === matchKey) ?? null
      setEntry(found)
      setIn4(res.in4)
      setLoad(res.error || res.in4 !== 'live' ? 'error' : 'done')
    } catch {
      setLoad('error')
    }
  }

  return (
    <div className={block ? 'mt-1' : 'mt-0.5'}>
      <button
        type="button"
        onClick={toggle}
        className="inline-flex items-center gap-1 rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[11px] font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900"
      >
        <History className="h-3 w-3 text-gray-400" />
        Last rate
        <span className="text-gray-400">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="mt-1 rounded-lg border border-gray-200 bg-gray-50/70 p-2.5 text-[12px] max-w-[420px]">
          {load === 'loading' && <p className="text-gray-500">Checking IN4…</p>}
          {load === 'error' && (
            <p className="text-gray-500">
              {in4 === 'not-configured' ? 'Rate history is not available here.' : 'Could not read the rate history from IN4.'}
            </p>
          )}
          {load === 'done' && <Panel e={entry} />}
        </div>
      )}
    </div>
  )
}

function Panel({ e }: { e: LineRateInfo | null }) {
  if (!e) return <p className="text-gray-500">Never bought before — no record of this item in IN4.</p>

  const ref = e.lastHere ?? e.last
  if (!ref) {
    return (
      <div className="space-y-1.5">
        <p className="font-medium text-gray-700">Never bought before.</p>
        {e.suggestions.length > 0 && (
          <div>
            <p className="text-gray-500">Did you mean one of these (bought earlier)?</p>
            <Suggestions list={e.suggestions} />
          </div>
        )}
      </div>
    )
  }

  const d = e.deltaPct
  const tone = d == null ? 'text-gray-500' : d > 2 ? 'text-rose-700' : d < -2 ? 'text-emerald-700' : 'text-gray-600'
  const Icon = d == null ? Minus : d > 2 ? TrendingUp : d < -2 ? TrendingDown : Minus

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-gray-500">Last rate {e.where === 'here' ? 'on this project' : 'elsewhere'}</span>
        <span className="font-semibold tabular-nums text-gray-900">{formatINR(ref.rate)}{e.uom ? `/${e.uom}` : ''}</span>
      </div>
      {d != null && (
        <div className={`flex items-center gap-1 font-medium ${tone}`}>
          <Icon className="h-3.5 w-3.5" />
          {d > 0 ? 'Now ' : d < 0 ? 'Now ' : ''}{Math.abs(Math.round(d))}% {d > 0 ? 'dearer' : d < 0 ? 'cheaper' : 'same'} than last
        </div>
      )}
      <p className="text-gray-500">
        {[ref.supplier, ref.poNo, ref.date ? formatDate(ref.date) : null].filter(Boolean).join(' · ') || '—'}
        {e.where === 'elsewhere' && ref.project ? ` · ${ref.project}` : ''}
      </p>
      <p className="text-gray-400">
        Bought {e.timesBought}×{e.suppliers > 1 ? ` from ${e.suppliers} suppliers` : ''}
        {e.minRate != null && e.maxRate != null && e.minRate !== e.maxRate ? ` · range ${formatINR(e.minRate)}–${formatINR(e.maxRate)}` : ''}
      </p>
      {/* When this project has its own last rate, still name the trust-wide one if it differs. */}
      {e.lastHere && e.last && e.last.rate !== e.lastHere.rate && (
        <p className="text-gray-400">Elsewhere in the trust last at {formatINR(e.last.rate)}{e.last.supplier ? ` (${e.last.supplier})` : ''}.</p>
      )}
    </div>
  )
}

function Suggestions({ list }: { list: LineRateInfo['suggestions'] }) {
  return (
    <ul className="mt-1 space-y-1">
      {list.map((s, i) => (
        <li key={i} className="flex items-baseline justify-between gap-3">
          <span className="text-gray-700 truncate">{s.name}{s.uom ? ` (${s.uom})` : ''}</span>
          <span className="tabular-nums text-gray-600 whitespace-nowrap">
            {formatINR(s.lastRate)}{s.date ? ` · ${formatDate(s.date)}` : ''}
          </span>
        </li>
      ))}
    </ul>
  )
}
