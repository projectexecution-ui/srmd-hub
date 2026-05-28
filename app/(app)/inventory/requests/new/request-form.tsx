'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Loader2, Plus, Trash2, Send } from 'lucide-react'
import { ItemPicker, type PickerItem } from '@/components/inventory/ItemPicker'

interface Opt { id: string; code: string; name: string }

type LineDraft = {
  tempId: string
  item_id: string
  requested_qty: string
  remarks: string
}

function newLine(): LineDraft {
  return { tempId: crypto.randomUUID(), item_id: '', requested_qty: '', remarks: '' }
}

export function RequestForm({ projects, warehouses, items }: {
  projects: Opt[]
  warehouses: Opt[]
  items: PickerItem[]
}) {
  const router = useRouter()
  const [projectId, setProjectId]   = useState(projects[0]?.id ?? '')
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? '')
  const [urgency, setUrgency]       = useState('normal')
  const [purpose, setPurpose]       = useState('')
  const [requiredBy, setRequiredBy] = useState('')
  const [lines, setLines]           = useState<LineDraft[]>([newLine()])
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
      }))
      .filter(l => l.item_id && Number.isFinite(l.requested_qty) && l.requested_qty > 0)

    if (validLines.length === 0) {
      setError('Add at least one item with a positive qty')
      setBusy(false)
      return
    }

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setError('Not signed in'); setBusy(false); return }

    const { data: reqRow, error: reqErr } = await supabase
      .from('inv_requests')
      .insert({
        engineer_id: user.id,
        project_id: projectId,
        warehouse_id: warehouseId,
        status: 'PENDING_BACKOFFICE',
        urgency,
        purpose: purpose.trim() || null,
        required_by_date: requiredBy || null,
      })
      .select('id')
      .single()
    if (reqErr || !reqRow) { setError(reqErr?.message ?? 'Failed to create request'); setBusy(false); return }

    const { error: linesErr } = await supabase.from('inv_request_items').insert(
      validLines.map(l => ({ ...l, request_id: reqRow.id })),
    )
    if (linesErr) {
      setError(`Lines failed: ${linesErr.message}`); setBusy(false); return
    }

    await supabase.from('inv_request_status_log').insert({
      request_id: reqRow.id,
      from_status: 'DRAFT',
      to_status: 'PENDING_BACKOFFICE',
      actor_id: user.id,
      remarks: 'Submitted by engineer',
    })

    router.push(`/inventory/requests/${reqRow.id}`)
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
          <Label>Project *</Label>
          <select value={projectId} onChange={e => setProjectId(e.target.value)} required
            className="mt-1 flex h-10 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm">
            {projects.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
          </select>
        </div>
        <div>
          <Label>Issuing warehouse *</Label>
          <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)} required
            className="mt-1 flex h-10 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm">
            {warehouses.map(w => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <Label>Urgency *</Label>
          <select value={urgency} onChange={e => setUrgency(e.target.value)}
            className="mt-1 flex h-10 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm">
            <option value="normal">Normal</option>
            <option value="urgent">Urgent</option>
            <option value="emergency">Emergency</option>
          </select>
        </div>
        <div>
          <Label>Required by</Label>
          <Input type="date" value={requiredBy} onChange={e => setRequiredBy(e.target.value)} className="mt-1" />
        </div>
      </div>

      <div>
        <Label>Purpose</Label>
        <Textarea value={purpose} onChange={e => setPurpose(e.target.value)} rows={2} className="mt-1" placeholder="What's it for?" />
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
          return (
            <div key={l.tempId} className="grid grid-cols-12 gap-2 items-center">
              <div className="col-span-12 md:col-span-6">
                <ItemPicker
                  items={items}
                  value={l.item_id}
                  onChange={(id) => update(l.tempId, { item_id: id })}
                />
              </div>
              <div className="col-span-6 md:col-span-3">
                <div className="flex items-center gap-1">
                  <Input type="number" step="any" inputMode="decimal" value={l.requested_qty}
                    onChange={e => update(l.tempId, { requested_qty: e.target.value })} placeholder="qty" />
                  <span className="text-xs text-gray-500 w-12">{item?.unit ?? ''}</span>
                </div>
              </div>
              <div className="col-span-5 md:col-span-2">
                <Input value={l.remarks} onChange={e => update(l.tempId, { remarks: e.target.value })} placeholder="remarks" />
              </div>
              <div className="col-span-1 flex justify-end">
                <Button type="button" variant="ghost" size="sm" onClick={() => remove(l.tempId)}
                  className="text-rose-600 hover:bg-rose-50">
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
