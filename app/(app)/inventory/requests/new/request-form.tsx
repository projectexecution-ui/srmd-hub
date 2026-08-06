'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { QtyInput } from '@/components/inventory/QtyInput'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Loader2, Plus, Trash2, Send, Store } from 'lucide-react'
import { ItemPicker, type PickerItem } from '@/components/inventory/ItemPicker'

interface Opt { id: string; code: string; name: string }

type LineDraft = {
  tempId: string
  item_id: string
  requested_qty: string
  remarks: string
  is_returnable: boolean
}

function newLine(): LineDraft {
  return { tempId: crypto.randomUUID(), item_id: '', requested_qty: '', remarks: '', is_returnable: false }
}

interface InitialDraft {
  projectId?: string
  warehouseId?: string
  urgency?: string
  purpose?: string
  requiredBy?: string
  lines: Array<{ item_id: string; requested_qty: number; remarks: string | null }>
  sourceRequestNo?: string
}

export function RequestForm({ projects, warehouses, items, projectStores = {}, stockByWh = {}, allowRequestNew = false, requirePurpose = false, initialDraft }: {
  projects: Opt[]
  warehouses: Opt[]
  items: PickerItem[]
  /** project_id → its site store (warehouse_id), from inv_project_setup. */
  projectStores?: Record<string, string>
  /** warehouse_id → { item_id → available_qty }. Shows the engineer what's on hand. */
  stockByWh?: Record<string, Record<string, number>>
  allowRequestNew?: boolean
  requirePurpose?: boolean
  initialDraft?: InitialDraft
}) {
  const router = useRouter()
  const firstProject = initialDraft?.projectId ?? projects[0]?.id ?? ''
  const [projectId, setProjectId]   = useState(firstProject)
  const [warehouseId, setWarehouseId] = useState(
    initialDraft?.warehouseId ?? projectStores[firstProject] ?? warehouses[0]?.id ?? '',
  )

  // When the engineer switches project, jump the warehouse to that project's
  // site store (if one is mapped). Their site store follows the project.
  function onProjectChange(nextProject: string) {
    setProjectId(nextProject)
    const mapped = projectStores[nextProject]
    if (mapped) setWarehouseId(mapped)
  }

  // The chosen project's mapped store, if any → we show it as a fixed chip
  // instead of a dropdown (no "which warehouse?" decision for the engineer).
  const mappedWarehouseId = projectStores[projectId]
  const mappedWarehouse = mappedWarehouseId ? warehouses.find(w => w.id === mappedWarehouseId) : undefined

  // Live stock at the selected store → the item picker shows what's on hand.
  const stockForWh = stockByWh[warehouseId] ?? {}
  const storeLabel = warehouses.find(w => w.id === warehouseId)?.name

  async function proposeItem(p: { name: string; unit: string; category: string }) {
    const supabase = createClient()
    const { error } = await supabase.rpc('inv_rpc_propose_item', { p_name: p.name, p_unit: p.unit, p_category: p.category || null })
    return error ? { ok: false, error: error.message } : { ok: true }
  }
  const [urgency, setUrgency]       = useState(initialDraft?.urgency ?? 'normal')
  const [purpose, setPurpose]       = useState(initialDraft?.purpose ?? '')
  const [requiredBy, setRequiredBy] = useState(initialDraft?.requiredBy ?? '')
  const [lines, setLines]           = useState<LineDraft[]>(
    initialDraft && initialDraft.lines.length > 0
      ? initialDraft.lines.map(l => ({
          tempId: crypto.randomUUID(),
          item_id: l.item_id,
          requested_qty: String(l.requested_qty),
          remarks: l.remarks ?? '',
          is_returnable: false,
        }))
      : [newLine()],
  )
  const [busy, setBusy]             = useState(false)
  const [error, setError]           = useState<string | null>(null)

  function update(tempId: string, patch: Partial<LineDraft>) {
    setLines(rs => rs.map(r => r.tempId === tempId ? { ...r, ...patch } : r))
  }
  function add()    { setLines(rs => [...rs, newLine()]) }
  function remove(tempId: string) { setLines(rs => rs.filter(r => r.tempId !== tempId)) }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)

    const validLines = lines
      .map(l => ({
        item_id: l.item_id,
        requested_qty: Number(l.requested_qty),
        remarks: l.remarks.trim() || null,
        is_returnable: l.is_returnable,
      }))
      .filter(l => l.item_id && Number.isFinite(l.requested_qty) && l.requested_qty > 0)

    if (validLines.length === 0) {
      setError('Add at least one item with a positive qty')
      setBusy(false)
      return
    }
    if (requirePurpose && !purpose.trim()) {
      setError('Please add a purpose for this request')
      setBusy(false)
      return
    }

    const supabase = createClient()
    // One atomic RPC: creates the request + lines + audit, applies the approval
    // dial (Atm Head first / straight to store / self-service issue), and never
    // orphans a half-written request the way the old 3-insert path could.
    const { data, error: rpcErr } = await supabase.rpc('inv_rpc_create_request', {
      p_project: projectId,
      p_warehouse: warehouseId,
      p_urgency: urgency,
      p_purpose: purpose.trim() || null,
      p_required_by: requiredBy || null,
      p_lines: validLines,
    })
    if (rpcErr) { setError(rpcErr.message); setBusy(false); return }
    const requestId = (data as { request_id?: string } | null)?.request_id
    if (!requestId) { setError('Could not create the request. Please try again.'); setBusy(false); return }

    router.push(`/inventory/requests/${requestId}`)
    router.refresh()
  }

  if (projects.length === 0 || warehouses.length === 0 || items.length === 0) {
    return (
      <p className="text-sm text-gray-600">
        Add at least one <b>project</b>, one <b>warehouse</b> and one <b>active item</b> first.
      </p>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <p className="text-sm text-rose-600">{error}</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <Label htmlFor="req-project">Project *</Label>
          <select id="req-project" value={projectId} onChange={e => onProjectChange(e.target.value)} required
            className="mt-1 flex h-10 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm">
            {projects.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="req-warehouse">Issuing warehouse *</Label>
          {mappedWarehouse ? (
            // This project has a site store — the request goes there. No pick.
            <div className="mt-1 flex h-10 w-full items-center gap-2 rounded-xl border border-green-200 bg-green-50/60 px-3 text-sm text-gray-800">
              <Store className="h-4 w-4 text-green-600 flex-shrink-0" />
              <span className="truncate"><b>{mappedWarehouse.code}</b> — {mappedWarehouse.name}</span>
              <span className="ml-auto text-[11px] text-green-700 whitespace-nowrap">your site store</span>
            </div>
          ) : (
            <select id="req-warehouse" value={warehouseId} onChange={e => setWarehouseId(e.target.value)} required
              className="mt-1 flex h-10 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm">
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
            </select>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <Label htmlFor="req-urgency">Urgency *</Label>
          <select id="req-urgency" value={urgency} onChange={e => setUrgency(e.target.value)}
            className="mt-1 flex h-10 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm">
            <option value="normal">Normal</option>
            <option value="urgent">Urgent</option>
          </select>
        </div>
        <div>
          <Label htmlFor="req-required-by">Required by</Label>
          <Input id="req-required-by" type="date" value={requiredBy} onChange={e => setRequiredBy(e.target.value)} className="mt-1" />
        </div>
      </div>

      <div>
        <Label htmlFor="req-purpose">{`Purpose${requirePurpose ? " *" : ""}`}</Label>
        <Textarea id="req-purpose" value={purpose} onChange={e => setPurpose(e.target.value)} rows={2} className="mt-1" placeholder="What's it for?" required={requirePurpose} />
      </div>

      <div className="space-y-2 pt-2 border-t border-gray-100">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-gray-700">Items</p>
          <Button type="button" size="sm" variant="outline" onClick={add}>
            <Plus className="h-4 w-4" /> Add row
          </Button>
        </div>
        {lines.map((l) => {
          const item = items.find(i => i.id === l.item_id)
          const avail = warehouseId ? stockByWh[warehouseId]?.[l.item_id] : undefined
          return (
            <div key={l.tempId} className="grid grid-cols-12 gap-2 items-start">
              <div className="col-span-12 md:col-span-6">
                <ItemPicker
                  items={items}
                  value={l.item_id}
                  onChange={(id) => update(l.tempId, { item_id: id })}
                  stockByItem={stockForWh}
                  storeLabel={storeLabel}
                  allowRequestNew={allowRequestNew}
                  onProposeItem={proposeItem}
                />
              </div>
              <div className="col-span-6 md:col-span-3">
                <div className="flex items-center gap-1">
                  <QtyInput value={l.requested_qty}
                    onChange={(v) => update(l.tempId, { requested_qty: v })} placeholder="qty" />
                  <span className="text-xs text-gray-500 w-12">{item?.unit ?? ''}</span>
                </div>
                {l.item_id && (
                  <p className={`text-[11px] mt-0.5 ${avail == null ? 'text-gray-400' : avail <= 0 ? 'text-rose-600' : 'text-gray-500'}`}>
                    {avail == null ? 'not stocked at this store' : `${avail.toLocaleString('en-IN')} on hand`}
                  </p>
                )}
                <label className="mt-1 inline-flex items-center gap-1 text-[11px] text-gray-600">
                  <input type="checkbox" checked={l.is_returnable} onChange={e => update(l.tempId, { is_returnable: e.target.checked })} />
                  Returnable (tool/formwork — must come back)
                </label>
              </div>
              <div className="col-span-12 md:col-span-2">
                <Input value={l.remarks} onChange={e => update(l.tempId, { remarks: e.target.value })} placeholder="remarks" />
              </div>
              <div className="col-span-2 md:col-span-1 flex justify-end">
                <Button type="button" variant="ghost" size="icon" onClick={() => remove(l.tempId)}
                  className="h-10 w-10 text-rose-600 hover:bg-rose-50">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )
        })}
      </div>

      <Button type="submit" disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        Submit request
      </Button>
    </form>
  )
}
