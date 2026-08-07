'use client'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { QtyInput } from '@/components/inventory/QtyInput'
import {
  Loader2, Check, ChevronDown, RotateCcw, Wrench, PackageOpen, Minus, Plus, AlertTriangle,
} from 'lucide-react'
import { classifyLine, type CustodyPrefillItem } from '@/lib/inventory/custody'

const nf = (n: number) => Number(n || 0).toLocaleString('en-IN')

export function CheckForm({ projectId, weekStart, items }: {
  projectId: string
  weekStart: string
  items: CustodyPrefillItem[]
}) {
  const router = useRouter()
  const supabase = createClient()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [showFinished, setShowFinished] = useState(false)

  const prefill = (it: CustodyPrefillItem) => it.lastActual != null ? it.lastActual : it.expected
  const [actual, setActual] = useState<Record<string, string>>(
    Object.fromEntries(items.map(it => [it.itemId, String(prefill(it))])),
  )
  const [reason, setReason] = useState<Record<string, string>>({})
  const set = (id: string, v: string) => setActual(s => ({ ...s, [id]: v }))
  const bump = (id: string, d: number) => setActual(s => {
    const n = Math.max(0, (Number(s[id] ?? '0') || 0) + d)
    return { ...s, [id]: String(n) }
  })

  const returnables = items.filter(it => it.isReturnable)
  const consumables = items.filter(it => !it.isReturnable)
  const active = consumables.filter(it => !(it.lastActual === 0 && it.expected <= (it.lastActual ?? 0)))
  const finished = consumables.filter(it => it.lastActual === 0 && it.expected <= (it.lastActual ?? 0))

  const byCategory = useMemo(() => {
    const m = new Map<string, CustodyPrefillItem[]>()
    for (const it of active) {
      const k = it.category?.trim() || 'Other'
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(it)
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [active])

  // A line needs a written reason when it's over what was sent, or a returnable
  // is short — i.e. anything that doesn't match the ledger.
  const needsReason = (it: CustodyPrefillItem) => {
    const k = classifyLine(it.expected, Number(actual[it.itemId] ?? '0') || 0, it.isReturnable).kind
    return k === 'missing' || k === 'phantom'
  }
  const flags = items.filter(needsReason).length

  async function submit() {
    // Gate: every flagged line must carry a reason before it saves.
    const unexplained = items.filter(it => needsReason(it) && !(reason[it.itemId] ?? '').trim())
    if (unexplained.length > 0) {
      setErr(`Add a quick reason for ${unexplained.length} flagged item${unexplained.length === 1 ? '' : 's'} (highlighted below) before submitting.`)
      return
    }
    setBusy(true); setErr(null)
    const payload = items.map(it => ({
      item_id: it.itemId,
      actual_qty: Number(actual[it.itemId] ?? '0') || 0,
      remarks: (reason[it.itemId] ?? '').trim() || null,
    }))
    const { error } = await supabase.rpc('inv_rpc_submit_stock_check', {
      p_project: projectId, p_week_start: weekStart, p_items: payload, p_note: note.trim() || null,
    })
    if (error) { setBusy(false); setErr(error.message); return }
    router.push('/inventory/site-stock')
  }

  return (
    <div className="space-y-5 pb-24">
      {err && <p role="alert" className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{err}</p>}

      {returnables.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-800">
              <Wrench className="h-4 w-4 text-amber-600" /> Comes back
            </h2>
            <button type="button"
              onClick={() => setActual(s => { const n = { ...s }; for (const it of returnables) n[it.itemId] = String(it.expected); return n })}
              className="text-xs font-medium text-emerald-700 hover:underline">All present ✓</button>
          </div>
          <p className="text-xs text-gray-500">Tools/formwork — should all still be at site. Confirm, or fix if some are missing.</p>
          <div className="space-y-2">
            {returnables.map(it => <ItemCard key={it.itemId} it={it} value={actual[it.itemId] ?? ''} onSet={v => set(it.itemId, v)} onBump={d => bump(it.itemId, d)}
                reason={reason[it.itemId] ?? ''} onReason={v => setReason(s => ({ ...s, [it.itemId]: v }))} />)}
          </div>
        </section>
      )}

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-800">
            <PackageOpen className="h-4 w-4 text-blue-600" /> How much is left?
          </h2>
          <button type="button"
            onClick={() => setActual(s => { const n = { ...s }; for (const it of active) n[it.itemId] = String(prefill(it)); return n })}
            className="text-xs font-medium text-blue-700 hover:underline">Nothing changed</button>
        </div>
        <p className="text-xs text-gray-500">Enter what&apos;s lying at site now — we work out how much was used. Already filled from last time.</p>
        {byCategory.map(([cat, list]) => (
          <div key={cat} className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mt-3">{cat}</p>
            {list.map(it => <ItemCard key={it.itemId} it={it} value={actual[it.itemId] ?? ''} onSet={v => set(it.itemId, v)} onBump={d => bump(it.itemId, d)}
                reason={reason[it.itemId] ?? ''} onReason={v => setReason(s => ({ ...s, [it.itemId]: v }))} />)}
          </div>
        ))}

        {finished.length > 0 && (
          <div className="pt-1">
            <button type="button" onClick={() => setShowFinished(s => !s)}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700">
              <ChevronDown className={`h-4 w-4 transition-transform ${showFinished ? 'rotate-180' : ''}`} />
              Finished earlier (0 left) · {finished.length}
            </button>
            {showFinished && (
              <div className="mt-2 space-y-2">
                {finished.map(it => <ItemCard key={it.itemId} it={it} value={actual[it.itemId] ?? ''} onSet={v => set(it.itemId, v)} onBump={d => bump(it.itemId, d)}
                reason={reason[it.itemId] ?? ''} onReason={v => setReason(s => ({ ...s, [it.itemId]: v }))} />)}
              </div>
            )}
          </div>
        )}
      </section>

      <Textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="Note for management (optional)" />

      {/* Sticky action bar */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-gray-200 bg-white/95 backdrop-blur px-4 py-3">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <div className="min-w-0 flex-1 text-xs">
            {flags > 0
              ? <span className="inline-flex items-center gap-1 text-rose-700 font-medium"><AlertTriangle className="h-3.5 w-3.5" /> {flags} to review</span>
              : <span className="text-gray-500">{items.length} item{items.length === 1 ? '' : 's'} · all look fine</span>}
            <button type="button" onClick={() => setActual(Object.fromEntries(items.map(it => [it.itemId, String(prefill(it))])))}
              className="ml-3 inline-flex items-center gap-1 text-gray-400 hover:text-gray-600"><RotateCcw className="h-3 w-3" /> Reset</button>
          </div>
          <Button onClick={submit} disabled={busy} className="bg-emerald-600 hover:bg-emerald-700 shrink-0">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Submit count
          </Button>
        </div>
      </div>
    </div>
  )
}

function ItemCard({ it, value, onSet, onBump, reason, onReason }: {
  it: CustodyPrefillItem
  value: string
  onSet: (v: string) => void
  onBump: (d: number) => void
  reason: string
  onReason: (v: string) => void
}) {
  const actualNum = Number(value ?? '0') || 0
  const c = classifyLine(it.expected, actualNum, it.isReturnable)
  const needsReason = c.kind === 'missing' || c.kind === 'phantom'
  const reasonPrompt = c.kind === 'phantom'
    ? 'More than we sent — where did it come from? (direct to site, another site, found extra)'
    : 'Some missing — what happened? (broke, moved to another site, etc.)'
  const missingReason = needsReason && !reason.trim()

  const chip = (() => {
    if (c.kind === 'missing') return { text: `${nf(c.shortfall)} missing`, cls: 'text-rose-700 bg-rose-50 border-rose-200' }
    if (c.kind === 'phantom') return { text: `${nf(c.phantom)} more than sent`, cls: 'text-amber-800 bg-amber-50 border-amber-200' }
    if (c.kind === 'used') return { text: `${nf(c.usedToDate)} used`, cls: 'text-gray-600 bg-gray-50 border-gray-200' }
    return { text: it.isReturnable ? 'All present' : 'Full', cls: 'text-emerald-700 bg-emerald-50 border-emerald-200' }
  })()

  const cardCls = c.kind === 'missing'
    ? 'border-rose-200 bg-rose-50/40'
    : c.kind === 'phantom'
      ? 'border-amber-200 bg-amber-50/40'
      : 'border-gray-100'

  return (
    <div className={`rounded-xl border p-3 ${cardCls}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-gray-900 leading-snug">{it.name}</p>
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-gray-500">{nf(it.expected)} {it.unit} sent</span>
            <span className={`text-[11px] font-medium rounded-full border px-2 py-0.5 ${chip.cls}`}>{chip.text}</span>
          </div>
        </div>
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        <span className="text-[11px] text-gray-400 mr-auto">On site now</span>
        <button type="button" aria-label="Decrease" onClick={() => onBump(-1)}
          className="h-10 w-10 rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 inline-flex items-center justify-center active:scale-95">
          <Minus className="h-4 w-4" />
        </button>
        <div className="w-24"><QtyInput value={value} onChange={onSet} placeholder="0" className="text-center text-base font-semibold" /></div>
        <button type="button" aria-label="Increase" onClick={() => onBump(1)}
          className="h-10 w-10 rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 inline-flex items-center justify-center active:scale-95">
          <Plus className="h-4 w-4" />
        </button>
        <span className="text-xs text-gray-500 w-12 whitespace-nowrap">{it.unit}</span>
      </div>

      {needsReason && (
        <div className="mt-2.5">
          <input
            value={reason}
            onChange={e => onReason(e.target.value)}
            placeholder={reasonPrompt}
            aria-label="Reason for the difference"
            className={`w-full h-10 rounded-lg border bg-white px-3 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 ${
              missingReason ? 'border-rose-300 focus:ring-rose-500/40' : 'border-gray-200 focus:ring-blue-500/40'
            }`}
          />
          {missingReason && <p className="mt-1 text-[11px] text-rose-600">A reason is needed before you can submit.</p>}
        </div>
      )}
    </div>
  )
}
