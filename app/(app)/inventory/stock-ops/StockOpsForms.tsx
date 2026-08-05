'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { QtyInput } from '@/components/inventory/QtyInput'
import { ItemPicker, type PickerItem } from '@/components/inventory/ItemPicker'
import { Loader2, ClipboardCheck, ArrowLeftRight, PackageX } from 'lucide-react'

interface WhOpt { id: string; code: string; name: string }
type Mode = 'adjust' | 'transfer' | 'damage'

const MODES: { key: Mode; label: string; icon: React.ComponentType<{ className?: string }>; hint: string }[] = [
  { key: 'adjust',   label: 'Correct count',     icon: ClipboardCheck, hint: 'Set on-hand to the number you actually counted.' },
  { key: 'transfer', label: 'Transfer',          icon: ArrowLeftRight, hint: 'Move stock from one store to another.' },
  { key: 'damage',   label: 'Damage write-off',  icon: PackageX,       hint: 'Remove broken / spoiled stock from usable on-hand.' },
]

export function StockOpsForms({ warehouses, items }: { warehouses: WhOpt[]; items: PickerItem[] }) {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('adjust')
  const [wh, setWh] = useState(warehouses[0]?.id ?? '')
  const [wh2, setWh2] = useState(warehouses[1]?.id ?? warehouses[0]?.id ?? '')
  const [itemId, setItemId] = useState('')
  const [qty, setQty] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const item = items.find(i => i.id === itemId)

  async function run() {
    if (mode === 'transfer' && wh === wh2) { setError('Pick two different stores'); return }
    setBusy(true); setError(null); setOk(null)
    const n = Number(qty)
    const supabase = createClient()
    let error
    if (mode === 'adjust') {
      ;({ error } = await supabase.rpc('inv_rpc_stock_adjust', { p_warehouse_id: wh, p_item_id: itemId, p_new_physical: n, p_reason: reason.trim() }))
    } else if (mode === 'transfer') {
      ;({ error } = await supabase.rpc('inv_rpc_stock_transfer', { p_from_warehouse: wh, p_to_warehouse: wh2, p_item_id: itemId, p_qty: n, p_remarks: reason.trim() || null }))
    } else {
      ;({ error } = await supabase.rpc('inv_rpc_stock_damage', { p_warehouse_id: wh, p_item_id: itemId, p_qty: n, p_reason: reason.trim() }))
    }
    setBusy(false)
    if (error) { setError(error.message); return }
    setOk(mode === 'adjust' ? 'Stock corrected.' : mode === 'transfer' ? 'Stock transferred.' : 'Write-off recorded.')
    setQty(''); setReason(''); setItemId('')
    router.refresh()
  }

  if (warehouses.length === 0 || items.length === 0) {
    return <p className="text-sm text-gray-600">Add a warehouse and an item first.</p>
  }
  const activeHint = MODES.find(m => m.key === mode)!.hint

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-2">
        {MODES.map(m => (
          <button key={m.key} type="button" onClick={() => { setMode(m.key); setError(null); setOk(null) }}
            className={`flex-1 rounded-lg border px-3 py-2.5 text-sm font-medium inline-flex items-center justify-center gap-1.5 ${mode === m.key ? 'border-green-500 bg-green-50 text-green-800' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            <m.icon className="h-4 w-4" /> {m.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-gray-500">{activeHint}</p>

      <div>
        <Label>{mode === 'transfer' ? 'From store *' : 'Store *'}</Label>
        <select value={wh} onChange={e => setWh(e.target.value)} className="mt-1 h-10 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm">
          {warehouses.map(w => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
        </select>
      </div>
      {mode === 'transfer' && (
        <div>
          <Label>To store *</Label>
          <select value={wh2} onChange={e => setWh2(e.target.value)} className="mt-1 h-10 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm">
            {warehouses.map(w => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
          </select>
          {warehouses.length < 2 && <p className="text-[11px] text-amber-600 mt-1">You need at least two stores to transfer.</p>}
        </div>
      )}
      <div>
        <Label>Item *</Label>
        <div className="mt-1"><ItemPicker items={items} value={itemId} onChange={setItemId} /></div>
      </div>
      <div>
        <Label>{mode === 'adjust' ? 'New counted quantity *' : 'Quantity *'}</Label>
        <div className="mt-1 flex gap-2">
          <QtyInput value={qty} onChange={setQty} placeholder={mode === 'adjust' ? 'counted on-hand' : 'qty'} />
          <span className="inline-flex items-center text-sm text-gray-500 w-12">{item?.unit ?? ''}</span>
        </div>
      </div>
      <div>
        <Label>{mode === 'transfer' ? 'Remarks' : 'Reason *'}</Label>
        <Textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} className="mt-1"
          placeholder={mode === 'adjust' ? 'why the count differs' : mode === 'damage' ? 'what got damaged' : 'optional note'} />
      </div>

      {error && <p className="text-sm text-rose-600">{error}</p>}
      {ok && <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{ok}</p>}
      <Button onClick={run} disabled={busy || !itemId || !qty || (mode === 'transfer' && (wh === wh2 || warehouses.length < 2))}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {mode === 'adjust' ? 'Correct stock' : mode === 'transfer' ? 'Transfer stock' : 'Record write-off'}
      </Button>
    </div>
  )
}
