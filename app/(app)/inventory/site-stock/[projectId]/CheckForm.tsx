'use client'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { QtyInput } from '@/components/inventory/QtyInput'
import { Loader2, Check, ChevronDown, RotateCcw, Wrench, PackageOpen } from 'lucide-react'
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

  // Pre-fill: carry forward the last count; first-ever count starts at "all sent".
  const prefill = (it: CustodyPrefillItem) => it.lastActual != null ? it.lastActual : it.expected
  const [actual, setActual] = useState<Record<string, string>>(
    Object.fromEntries(items.map(it => [it.itemId, String(prefill(it))])),
  )

  const returnables = items.filter(it => it.isReturnable)
  const consumables = items.filter(it => !it.isReturnable)
  // "Finished" = counted to zero last time (and nothing new sent to move expected).
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

  async function submit() {
    setBusy(true); setErr(null)
    const payload = items.map(it => ({
      item_id: it.itemId,
      actual_qty: Number(actual[it.itemId] ?? '0') || 0,
      remarks: null,
    }))
    const { error } = await supabase.rpc('inv_rpc_submit_stock_check', {
      p_project: projectId, p_week_start: weekStart, p_items: payload, p_note: note.trim() || null,
    })
    if (error) { setBusy(false); setErr(error.message); return }
    router.push('/inventory/site-stock')
  }

  return (
    <div className="space-y-5">
      {err && <p role="alert" className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{err}</p>}

      {returnables.length > 0 && (
        <section className="space-y-2">
          <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-700">
            <Wrench className="h-4 w-4 text-amber-600" /> Comes back — should still be on site
          </h2>
          <p className="text-xs text-gray-500">Tools/formwork. Confirm the count, or fix it if some are missing.</p>
          <div className="rounded-xl border border-gray-100 divide-y divide-gray-100">
            {returnables.map(it => <Row key={it.itemId} it={it} value={actual[it.itemId] ?? ''} onChange={v => setActual(s => ({ ...s, [it.itemId]: v }))} />)}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-700">
          <PackageOpen className="h-4 w-4 text-blue-600" /> Gets used — how much is left on site?
        </h2>
        <p className="text-xs text-gray-500">Enter what&apos;s physically lying at site. We work out how much was used. Untouched lines are already filled from last time.</p>
        {byCategory.map(([cat, list]) => (
          <div key={cat} className="space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mt-2">{cat}</p>
            <div className="rounded-xl border border-gray-100 divide-y divide-gray-100">
              {list.map(it => <Row key={it.itemId} it={it} value={actual[it.itemId] ?? ''} onChange={v => setActual(s => ({ ...s, [it.itemId]: v }))} />)}
            </div>
          </div>
        ))}

        {finished.length > 0 && (
          <div>
            <button type="button" onClick={() => setShowFinished(s => !s)}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700">
              <ChevronDown className={`h-4 w-4 transition-transform ${showFinished ? 'rotate-180' : ''}`} />
              Finished earlier (0 left) · {finished.length}
            </button>
            {showFinished && (
              <div className="mt-2 rounded-xl border border-gray-100 divide-y divide-gray-100">
                {finished.map(it => <Row key={it.itemId} it={it} value={actual[it.itemId] ?? ''} onChange={v => setActual(s => ({ ...s, [it.itemId]: v }))} />)}
              </div>
            )}
          </div>
        )}
      </section>

      <Textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="Note for management (optional)" />

      <div className="flex items-center gap-3">
        <Button onClick={submit} disabled={busy} className="bg-emerald-600 hover:bg-emerald-700">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Submit this week&apos;s count
        </Button>
        <button type="button" onClick={() => setActual(Object.fromEntries(items.map(it => [it.itemId, String(prefill(it))])))}
          className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700">
          <RotateCcw className="h-3.5 w-3.5" /> Reset to last count
        </button>
      </div>
    </div>
  )
}

function Row({ it, value, onChange }: { it: CustodyPrefillItem; value: string; onChange: (v: string) => void }) {
  const actualNum = Number(value ?? '0') || 0
  const c = classifyLine(it.expected, actualNum, it.isReturnable)
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-gray-900 truncate">{it.name}</p>
        <p className="text-[11px] text-gray-500">
          {nf(it.expected)} {it.unit} sent
          {c.kind === 'used' && actualNum < it.expected && <span className="text-gray-500"> · {nf(c.usedToDate)} used</span>}
          {c.kind === 'missing' && <span className="text-rose-600 font-medium"> · {nf(c.shortfall)} missing</span>}
          {c.kind === 'phantom' && <span className="text-amber-700 font-medium"> · {nf(c.phantom)} more than sent</span>}
        </p>
      </div>
      <div className="w-28 flex items-center gap-1.5">
        <QtyInput value={value} onChange={onChange} placeholder="left" />
        <span className="text-xs text-gray-400 w-8 truncate">{it.unit}</span>
      </div>
    </div>
  )
}
