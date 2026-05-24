'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Loader2, Check, PackagePlus } from 'lucide-react'

interface Opt { id: string; code: string; name: string; unit?: string }

export function ReceiptForm({ warehouses, items }: { warehouses: Opt[]; items: Opt[] }) {
  const router = useRouter()
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? '')
  const [itemId, setItemId]           = useState('')
  const [qty, setQty]                 = useState('')
  const [remarks, setRemarks]         = useState('')
  const [busy, setBusy]               = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [success, setSuccess]         = useState<string | null>(null)

  const item = items.find(i => i.id === itemId)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null); setSuccess(null)
    const qtyNum = Number(qty)
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
      setError('Enter a positive quantity'); setBusy(false); return
    }
    const supabase = createClient()
    const { error: rpcErr } = await supabase.rpc('inv_rpc_stock_receipt', {
      p_warehouse_id: warehouseId,
      p_item_id: itemId,
      p_qty: qtyNum,
      p_remarks: remarks.trim() || null,
    })
    setBusy(false)
    if (rpcErr) { setError(rpcErr.message); return }
    setSuccess(`Recorded ${qtyNum} ${item?.unit ?? ''} of ${item?.code} into ${warehouses.find(w => w.id === warehouseId)?.code}.`)
    setQty(''); setRemarks('')
    router.refresh()
  }

  if (warehouses.length === 0 || items.length === 0) {
    return (
      <p className="text-sm text-gray-600">
        Add at least one <b>warehouse</b> and one <b>active item</b> first under the admin masters.
      </p>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <p className="text-sm text-rose-600">{error}</p>}
      {success && (
        <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
          {success}
        </p>
      )}

      <div>
        <Label>Warehouse *</Label>
        <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)} required
          className="mt-1 flex h-10 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm">
          {warehouses.map(w => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
        </select>
      </div>

      <div>
        <Label>Item *</Label>
        <select value={itemId} onChange={e => setItemId(e.target.value)} required
          className="mt-1 flex h-10 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm">
          <option value="">— Select item —</option>
          {items.map(it => <option key={it.id} value={it.id}>{it.code} — {it.name}{it.unit ? ` (${it.unit})` : ''}</option>)}
        </select>
      </div>

      <div>
        <Label>Quantity *</Label>
        <div className="mt-1 flex gap-2">
          <Input type="number" step="any" inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} required placeholder="e.g. 100" />
          <span className="inline-flex items-center text-sm text-gray-500 w-12">{item?.unit ?? ''}</span>
        </div>
      </div>

      <div>
        <Label>Remarks</Label>
        <Textarea value={remarks} onChange={e => setRemarks(e.target.value)} rows={2} className="mt-1" placeholder="DC / invoice no, vendor, etc." />
      </div>

      <Button type="submit" disabled={busy || !itemId || !qty}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackagePlus className="h-4 w-4" />}
        Record receipt
      </Button>
    </form>
  )
}
