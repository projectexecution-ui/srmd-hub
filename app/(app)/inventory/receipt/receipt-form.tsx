'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { QtyInput } from '@/components/inventory/QtyInput'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Loader2, PackagePlus, Plus, Trash2 } from 'lucide-react'
import { ItemPicker, type PickerItem } from '@/components/inventory/ItemPicker'

interface WhOpt { id: string; code: string; name: string }
type Line = { tempId: string; item_id: string; qty: string }
function newLine(): Line { return { tempId: crypto.randomUUID(), item_id: '', qty: '' } }

export function ReceiptForm({ warehouses, items }: { warehouses: WhOpt[]; items: PickerItem[] }) {
  const router = useRouter()
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? '')
  const [remarks, setRemarks] = useState('')
  const [lines, setLines] = useState<Line[]>([newLine()])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  function update(id: string, patch: Partial<Line>) { setLines(rs => rs.map(r => r.tempId === id ? { ...r, ...patch } : r)) }
  function add() { setLines(rs => [...rs, newLine()]) }
  function remove(id: string) { setLines(rs => rs.filter(r => r.tempId !== id)) }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null); setSuccess(null)
    const valid = lines
      .map(l => ({ item_id: l.item_id, qty: Number(l.qty) }))
      .filter(l => l.item_id && Number.isFinite(l.qty) && l.qty > 0)
    if (valid.length === 0) { setError('Add at least one item with a positive quantity'); setBusy(false); return }

    const supabase = createClient()
    const { data, error: rpcErr } = await supabase.rpc('inv_rpc_stock_receipt_bulk', {
      p_warehouse_id: warehouseId,
      p_lines: valid,
      p_remarks: remarks.trim() || null,
    })
    setBusy(false)
    if (rpcErr) { setError(rpcErr.message); return }
    const n = (data as { lines?: number } | null)?.lines ?? valid.length
    setSuccess(`Recorded ${n} item${n === 1 ? '' : 's'} into ${warehouses.find(w => w.id === warehouseId)?.code ?? 'the store'}.`)
    setLines([newLine()]); setRemarks('')
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
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      {success && (
        <p role="alert" className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{success}</p>
      )}

      <div>
        <Label htmlFor="rcpt-wh">Receive into warehouse *</Label>
        <select id="rcpt-wh" value={warehouseId} onChange={e => setWarehouseId(e.target.value)} required
          className="mt-1 flex h-10 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm">
          {warehouses.map(w => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
        </select>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Items received</Label>
          <Button type="button" variant="outline" onClick={add}><Plus className="h-4 w-4" /> Add row</Button>
        </div>
        {lines.map(l => {
          const item = items.find(i => i.id === l.item_id)
          return (
            <div key={l.tempId} className="grid grid-cols-12 gap-2 items-center">
              <div className="col-span-12 md:col-span-7">
                <ItemPicker items={items} value={l.item_id} onChange={id => update(l.tempId, { item_id: id })} />
              </div>
              <div className="col-span-10 md:col-span-4 flex items-center gap-1">
                <QtyInput value={l.qty} onChange={v => update(l.tempId, { qty: v })} placeholder="qty" />
                <span className="text-xs text-gray-500 w-12">{item?.unit ?? ''}</span>
              </div>
              <div className="col-span-2 md:col-span-1 flex justify-end">
                <Button type="button" variant="ghost" size="icon" onClick={() => remove(l.tempId)} className="h-10 w-10 text-rose-600 hover:bg-rose-50">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )
        })}
      </div>

      <div>
        <Label htmlFor="rcpt-remarks">Delivery note / vendor (remarks)</Label>
        <Textarea id="rcpt-remarks" value={remarks} onChange={e => setRemarks(e.target.value)} rows={2} className="mt-1" placeholder="DC / invoice no, vendor, etc." />
      </div>

      <Button type="submit" disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackagePlus className="h-4 w-4" />}
        Record receipt
      </Button>
    </form>
  )
}
