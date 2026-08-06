'use client'
import { useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ImageOff, AlertTriangle, Loader2, Check } from 'lucide-react'

interface Warehouse { id: string; code: string; name: string }
interface StockRow {
  id: string
  item_id: string
  warehouse_id: string
  item_code: string
  item_name: string
  unit: string
  image_url: string | null
  category: string | null
  physical_qty: number
  reserved_qty: number
  damaged_qty: number
  available_qty: number
  min_threshold: number | null
  is_low_stock: boolean
}

export function StockTable({ warehouses, selectedWarehouse, rows, canEdit = false }: {
  warehouses: Warehouse[]
  selectedWarehouse: string | null
  rows: StockRow[]
  canEdit?: boolean
}) {
  const router = useRouter()
  const sp = useSearchParams()
  const [q, setQ] = useState('')
  const [onlyLow, setOnlyLow] = useState(false)

  const filtered = useMemo(() => {
    let out = rows
    if (q.trim()) {
      const lc = q.toLowerCase()
      out = out.filter(r => r.item_code.toLowerCase().includes(lc) || r.item_name.toLowerCase().includes(lc))
    }
    if (onlyLow) out = out.filter(r => r.is_low_stock)
    return out
  }, [rows, q, onlyLow])

  function onChangeWh(id: string) {
    const p = new URLSearchParams(sp.toString())
    p.set('warehouse', id)
    router.push(`/inventory/stock?${p.toString()}`)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row gap-2 md:items-center">
        <select aria-label="Warehouse" value={selectedWarehouse ?? ''} onChange={e => onChangeWh(e.target.value)}
          className="h-10 rounded-xl border border-gray-300 bg-white px-3 text-sm min-w-[14rem]">
          {warehouses.length === 0 && <option value="">No warehouses</option>}
          {warehouses.map(w => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
        </select>
        <Input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search item code or name…" className="md:max-w-sm" />
        <label className="inline-flex items-center gap-1.5 py-2 min-h-10 text-sm text-gray-700">
          <input type="checkbox" checked={onlyLow} onChange={e => setOnlyLow(e.target.checked)} className="h-4 w-4" />
          Only low-stock
        </label>
      </div>

      {!selectedWarehouse ? (
        <p className="text-sm text-gray-500 italic py-4">Add a warehouse first under <b>Warehouses admin</b>.</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-gray-500 italic py-4">No items in stock for this filter.</p>
      ) : (
        <div className="overflow-x-auto -mx-1">
          <table className="min-w-[760px] text-sm">
            <thead className="bg-gray-50">
              <tr className="text-left text-xs uppercase tracking-wide text-gray-500 whitespace-nowrap">
                <th className="px-2 py-2 w-14"></th>
                <th className="px-2 py-2">Item</th>
                <th className="px-2 py-2 text-right">Physical</th>
                <th className="px-2 py-2 text-right">Reserved</th>
                <th className="px-2 py-2 text-right">Damaged</th>
                <th className="px-2 py-2 text-right">Available</th>
                <th className="px-2 py-2 text-right">Reorder at</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-2 py-2">
                    <div className="h-9 w-9 rounded-md border border-gray-200 bg-gray-50 overflow-hidden flex items-center justify-center">
                      {r.image_url ? (
                        <Image src={r.image_url} alt={r.item_name} width={36} height={36} className="object-cover h-full w-full" unoptimized />
                      ) : (
                        <ImageOff className="h-4 w-4 text-gray-300" />
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-[11px] font-bold text-blue-700">{r.item_code}</span>
                      <span className="font-medium text-gray-900">{r.item_name}</span>
                    </div>
                    <p className="text-xs text-gray-500">{r.unit}{r.category ? ` · ${r.category}` : ''}</p>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-gray-700">{Number(r.physical_qty).toLocaleString('en-IN')}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-amber-700">{Number(r.reserved_qty).toLocaleString('en-IN')}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-rose-700">{Number(r.damaged_qty).toLocaleString('en-IN')}</td>
                  <td className="px-2 py-2 text-right tabular-nums font-semibold text-gray-900">{Number(r.available_qty).toLocaleString('en-IN')}</td>
                  <td className="px-2 py-2 text-right"><ReorderCell row={r} canEdit={canEdit} /></td>
                  <td className="px-2 py-2">
                    {r.is_low_stock && (
                      <Badge className="bg-rose-100 text-rose-800 inline-flex items-center gap-1 text-[10px]">
                        <AlertTriangle className="h-3 w-3" /> low
                      </Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// Inline reorder-level editor. Editors set the "reorder at" number per item per
// store; when available drops to/below it the row is flagged low + the daily
// digest nudges the keeper.
function ReorderCell({ row, canEdit }: { row: StockRow; canEdit: boolean }) {
  const [val, setVal] = useState(row.min_threshold != null ? String(row.min_threshold) : '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    const n = Number(val)
    if (!Number.isFinite(n) || n < 0) { setErr('Enter 0 or more'); return }
    if (n === (row.min_threshold ?? 0)) return
    setSaving(true); setSaved(false); setErr(null)
    const supabase = createClient()
    const { error } = await supabase.rpc('inv_rpc_set_reorder', {
      p_warehouse_id: row.warehouse_id, p_item_id: row.item_id, p_min: n,
    })
    setSaving(false)
    if (error) { setErr(error.message); return }
    setSaved(true); setTimeout(() => setSaved(false), 1500)
  }

  if (!canEdit) {
    return <span className="tabular-nums text-gray-400">{row.min_threshold != null ? Number(row.min_threshold).toLocaleString('en-IN') : '—'}</span>
  }
  return (
    <div className="flex flex-col items-end gap-0.5">
      <div className="flex items-center gap-1 justify-end">
        <input
          aria-label={`Reorder level for ${row.item_name}`}
          type="number" min={0} value={val}
          onChange={e => setVal(e.target.value)}
          onBlur={save}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          className={`w-16 h-10 rounded border px-1.5 text-right text-sm tabular-nums ${err ? 'border-rose-300' : 'border-gray-200'}`}
          placeholder="—"
        />
        {saving && <Loader2 className="h-3 w-3 animate-spin text-gray-400" />}
        {saved && <Check className="h-3 w-3 text-green-600" />}
      </div>
      {err && <span className="text-[10px] text-rose-600 max-w-[8rem] text-right leading-tight">{err}</span>}
    </div>
  )
}
