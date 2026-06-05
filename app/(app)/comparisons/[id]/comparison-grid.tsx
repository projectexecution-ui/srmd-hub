'use client'
// The comparison grid.
//   rows = scope items (cmp_items)
//   cols = vendors  (cmp_vendors)
//   each cell = a quote (cmp_quotes) with rate × qty = amount
//
// Smart bits:
//   - Per-item L1 highlight (lowest rate among quoted vendors)
//   - Per-vendor grand total + overall L1/L2/L3 ranking
//   - "Not quoted" count per vendor
//   - Type rate → amount auto-fills (rate × item.quantity)

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MoneyInput } from '@/components/ui/money-input'
import { Badge } from '@/components/ui/badge'
import { Loader2, Plus, Trash2, Users, Trophy, AlertTriangle } from 'lucide-react'
import { confirm } from '@/components/ui/confirm-dialog'
import { cn } from '@/lib/utils'
import {
  buildQuoteMap, computeItemBest, computeVendorTotals, computeRanking, quoteLineAmount,
} from '@/lib/comparison'

interface Vendor { id: string; comparison_id: string; name: string; contact: string | null; sequence: number }
interface Item   { id: string; comparison_id: string; sequence: number; code: string | null; description: string; uom: string | null; quantity: number | null }
interface Quote  { id: string; comparison_id: string; item_id: string; vendor_id: string; rate: number | null; amount: number | null; not_quoted: boolean; notes: string | null }

function fmtINR(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })
}

export default function ComparisonGrid({
  comparisonId, canWrite, initialVendors, initialItems, initialQuotes,
}: {
  comparisonId: string
  canWrite: boolean
  initialVendors: Vendor[]
  initialItems: Item[]
  initialQuotes: Quote[]
}) {
  const router = useRouter()
  const supabase = createClient()
  const [vendors, setVendors] = useState<Vendor[]>(initialVendors)
  const [items, setItems]     = useState<Item[]>(initialItems)
  const [quotes, setQuotes]   = useState<Quote[]>(initialQuotes)
  const [busy, setBusy]       = useState<string | null>(null)
  const [error, setError]     = useState<string | null>(null)
  const [showAddVendor, setShowAddVendor] = useState(false)
  const [newVendorName, setNewVendorName] = useState('')

  // ───────── All the comparison math lives in lib/comparison.ts (pure +
  //           unit-tested). The grid just memoises the calls. Amounts are
  //           computed LIVE from current quantity, so editing a qty after
  //           rates were typed correctly re-totals (no stale snapshot).
  const quoteMap = useMemo(() => buildQuoteMap(quotes), [quotes])

  function getQuote(itemId: string, vendorId: string): Quote | null {
    return quoteMap.get(`${itemId}::${vendorId}`) ?? null
  }

  // Per-item L1 = lowest non-null rate among quoted vendors
  const itemBest = useMemo(() => computeItemBest(items, vendors, quoteMap), [items, vendors, quoteMap])

  // Per-vendor grand total + missing/quoted counts
  const vendorTotals = useMemo(() => computeVendorTotals(items, vendors, quoteMap), [items, vendors, quoteMap])

  // L-ranking: sort vendors by total ASC (lower is better). NOTE: a vendor
  // missing most items but cheap on a few can rank L1 — the "missing" count
  // is shown next to the rank so the user sees incomplete bids.
  const ranking = useMemo(() => computeRanking(vendors, vendorTotals), [vendors, vendorTotals])

  // ───────── Mutators ─────────
  async function addItem() {
    setBusy('add-item'); setError(null)
    const nextSeq = (items[items.length - 1]?.sequence ?? 0) + 10
    const { data, error } = await supabase
      .from('cmp_items')
      .insert({ comparison_id: comparisonId, sequence: nextSeq, description: 'New item' })
      .select('*').single()
    setBusy(null)
    if (error) { setError(error.message); return }
    setItems(prev => [...prev, data as Item])
    router.refresh()
  }

  async function removeItem(id: string) {
    if (!(await confirm('Delete this scope item? Quotes for it are also removed.'))) return
    setBusy(`item:${id}`); setError(null)
    const { error } = await supabase.from('cmp_items').delete().eq('id', id)
    setBusy(null)
    if (error) { setError(error.message); return }
    setItems(prev => prev.filter(i => i.id !== id))
    setQuotes(prev => prev.filter(q => q.item_id !== id))
    router.refresh()
  }

  async function updateItem(id: string, patch: Partial<Item>) {
    setBusy(`item:${id}`); setError(null)
    const prev = items
    setItems(prevItems => prevItems.map(i => i.id === id ? { ...i, ...patch } : i))
    const { error } = await supabase.from('cmp_items').update(patch).eq('id', id)
    setBusy(null)
    if (error) { setError(error.message); setItems(prev); return }
  }

  async function addVendor() {
    if (!newVendorName.trim()) return
    setBusy('add-vendor'); setError(null)
    const nextSeq = (vendors[vendors.length - 1]?.sequence ?? 0) + 10
    const { data, error } = await supabase
      .from('cmp_vendors')
      .insert({ comparison_id: comparisonId, name: newVendorName.trim(), sequence: nextSeq })
      .select('*').single()
    setBusy(null)
    if (error) { setError(error.message); return }
    setVendors(prev => [...prev, data as Vendor])
    setNewVendorName('')
    setShowAddVendor(false)
    router.refresh()
  }

  async function removeVendor(id: string) {
    if (!(await confirm('Remove this vendor? Their quotes are deleted.'))) return
    setBusy(`vendor:${id}`); setError(null)
    const { error } = await supabase.from('cmp_vendors').delete().eq('id', id)
    setBusy(null)
    if (error) { setError(error.message); return }
    setVendors(prev => prev.filter(v => v.id !== id))
    setQuotes(prev => prev.filter(q => q.vendor_id !== id))
    router.refresh()
  }

  async function upsertQuote(itemId: string, vendorId: string, patch: Partial<Quote>) {
    const existing = getQuote(itemId, vendorId)
    const it = items.find(i => i.id === itemId)
    const computedAmount =
      patch.rate != null && it?.quantity != null ? Number(it.quantity) * Number(patch.rate) : (patch.amount ?? null)
    const payload: Partial<Quote> & { item_id: string; vendor_id: string; comparison_id: string } = {
      comparison_id: comparisonId, item_id: itemId, vendor_id: vendorId, ...patch,
      amount: computedAmount,
    }
    setBusy(`q:${itemId}:${vendorId}`); setError(null)
    if (existing) {
      const { data, error } = await supabase
        .from('cmp_quotes').update(payload).eq('id', existing.id)
        .select('*').single()
      setBusy(null)
      if (error) { setError(error.message); return }
      setQuotes(prev => prev.map(q => q.id === existing.id ? (data as Quote) : q))
    } else {
      const { data, error } = await supabase
        .from('cmp_quotes').insert(payload).select('*').single()
      setBusy(null)
      if (error) { setError(error.message); return }
      setQuotes(prev => [...prev, data as Quote])
    }
  }

  // ───────── Render ─────────
  return (
    <Card>
      <CardContent className="pt-5 space-y-3">
        {error && <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1.5">{error}</p>}

        {/* Toolbar */}
        {canWrite && (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={addItem} disabled={busy === 'add-item'}>
              {busy === 'add-item' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Add scope item
            </Button>
            {!showAddVendor ? (
              <Button size="sm" onClick={() => setShowAddVendor(true)}>
                <Users className="h-4 w-4" /> Add vendor
              </Button>
            ) : (
              <form onSubmit={e => { e.preventDefault(); addVendor() }} className="inline-flex items-center gap-1.5">
                <Input value={newVendorName} onChange={e => setNewVendorName(e.target.value)} autoFocus placeholder="Vendor name" className="h-9 w-48" />
                <Button type="submit" size="sm" disabled={!newVendorName.trim() || busy === 'add-vendor'}>
                  {busy === 'add-vendor' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add'}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => { setShowAddVendor(false); setNewVendorName('') }}>Cancel</Button>
              </form>
            )}
          </div>
        )}

        {items.length === 0 && vendors.length === 0 ? (
          <div className="text-center py-12 text-sm text-gray-500">
            Start by adding a few <b>scope items</b> (what you&apos;re buying) and at least two <b>vendors</b>.
            The L1 ranking auto-computes as you type rates.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm border-separate border-spacing-0">
              <thead>
                <tr className="bg-gray-50">
                  <th className="px-2 py-2 text-left text-[10px] uppercase tracking-wide text-gray-500 sticky left-0 bg-gray-50 z-10 w-12">#</th>
                  <th className="px-2 py-2 text-left text-[10px] uppercase tracking-wide text-gray-500 sticky left-12 bg-gray-50 z-10 min-w-[240px]">Scope item</th>
                  <th className="px-2 py-2 text-right text-[10px] uppercase tracking-wide text-gray-500 w-20">Qty</th>
                  <th className="px-2 py-2 text-left text-[10px] uppercase tracking-wide text-gray-500 w-16">UOM</th>
                  {vendors.map(v => {
                    const t = vendorTotals.get(v.id)
                    const rank = ranking.get(v.id)
                    return (
                      <th key={v.id} className="px-2 py-2 text-center text-[10px] uppercase tracking-wide text-gray-500 min-w-[140px] border-l border-gray-200">
                        <div className="flex items-center justify-center gap-1.5 flex-wrap">
                          <span className="font-bold text-gray-700 normal-case text-sm">{v.name}</span>
                          {rank === 1 && <Badge className="bg-emerald-100 text-emerald-800 text-[10px]"><Trophy className="h-3 w-3 mr-0.5 inline" />L1</Badge>}
                          {rank === 2 && <Badge className="bg-blue-100 text-blue-800 text-[10px]">L2</Badge>}
                          {rank === 3 && <Badge className="bg-slate-100 text-slate-700 text-[10px]">L3</Badge>}
                          {rank !== undefined && rank > 3 && <Badge variant="secondary" className="text-[10px]">L{rank}</Badge>}
                        </div>
                        {t && t.missing > 0 && (
                          <div className="text-[10px] text-rose-600 normal-case mt-0.5 inline-flex items-center gap-0.5">
                            <AlertTriangle className="h-3 w-3" /> {t.missing} missing
                          </div>
                        )}
                        {canWrite && (
                          <button onClick={() => removeVendor(v.id)} className="block mx-auto mt-1 text-rose-500 hover:text-rose-700" title="Remove vendor">
                            <Trash2 className="h-3 w-3" />
                          </button>
                        )}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {items.map((it, idx) => (
                  <tr key={it.id} className="border-t border-gray-100 hover:bg-gray-50/50">
                    <td className="px-2 py-2 sticky left-0 bg-white z-10 border-r border-gray-100">
                      <span className="text-xs text-gray-400 font-mono">{idx + 1}</span>
                    </td>
                    <td className="px-2 py-1 sticky left-12 bg-white z-10 border-r border-gray-100">
                      <Input
                        defaultValue={it.description}
                        onBlur={e => { const v = e.target.value.trim(); if (v && v !== it.description) updateItem(it.id, { description: v }) }}
                        disabled={!canWrite}
                        className="h-8 text-sm border-transparent hover:border-gray-300 focus:border-gray-400 bg-transparent"
                      />
                    </td>
                    <td className="px-1 py-1">
                      <MoneyInput
                        value={it.quantity == null ? '' : String(it.quantity)}
                        onChange={(v) => updateItem(it.id, { quantity: v === '' ? null : Number(v) })}
                        disabled={!canWrite}
                        className="h-8 text-xs text-right tabular-nums"
                      />
                    </td>
                    <td className="px-1 py-1">
                      <Input
                        defaultValue={it.uom ?? ''}
                        onBlur={e => { const v = e.target.value.trim(); if (v !== (it.uom ?? '')) updateItem(it.id, { uom: v || null }) }}
                        disabled={!canWrite}
                        placeholder="nos"
                        className="h-8 text-xs"
                      />
                    </td>
                    {vendors.map(v => {
                      const q = getQuote(it.id, v.id)
                      const rate = q?.rate ?? null
                      const best = itemBest.get(it.id)
                      const isL1 = rate != null && best != null && Math.abs(rate - best) < 0.001
                      const missing = !q || q.not_quoted || q.rate == null
                      return (
                        <td key={v.id} className={cn(
                          'px-1 py-1 border-l border-gray-100 align-top',
                          isL1 && 'bg-emerald-50',
                          missing && 'bg-rose-50/40',
                        )}>
                          <MoneyInput
                            value={rate == null ? '' : String(rate)}
                            onChange={(raw) => {
                              const num = raw === '' ? null : Number(raw)
                              if (num == null) {
                                if (q) upsertQuote(it.id, v.id, { rate: null, amount: null })
                              } else {
                                upsertQuote(it.id, v.id, { rate: num, not_quoted: false })
                              }
                            }}
                            disabled={!canWrite}
                            placeholder="rate"
                            className="h-8 text-xs text-right tabular-nums"
                          />
                          <div className={cn('text-[10px] text-right mt-0.5 tabular-nums', isL1 ? 'text-emerald-700 font-semibold' : 'text-gray-500')}>
                            {(() => { const a = quoteLineAmount(q, it); return a != null ? fmtINR(a) : '—' })()}
                          </div>
                        </td>
                      )
                    })}
                    {canWrite && (
                      <td className="px-1 py-1 w-8">
                        <button onClick={() => removeItem(it.id)} className="text-rose-500 hover:text-rose-700" title="Remove item">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}

                {/* Totals row */}
                {items.length > 0 && vendors.length > 0 && (
                  <tr className="bg-gray-50 font-semibold border-t-2 border-gray-300">
                    <td colSpan={4} className="px-2 py-2 text-right text-xs uppercase tracking-wide text-gray-600 sticky left-0 bg-gray-50">
                      Grand total
                    </td>
                    {vendors.map(v => {
                      const t = vendorTotals.get(v.id)
                      const rank = ranking.get(v.id)
                      return (
                        <td key={v.id} className={cn(
                          'px-2 py-2 text-right tabular-nums border-l border-gray-200',
                          rank === 1 && 'bg-emerald-100 text-emerald-900',
                          rank === 2 && 'bg-blue-50 text-blue-900',
                        )}>
                          {t ? fmtINR(t.total) : '—'}
                          {rank && (
                            <span className="block text-[10px] font-normal mt-0.5">
                              L{rank} {t && t.missing > 0 && <span className="text-rose-600">· {t.missing} missing</span>}
                            </span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
