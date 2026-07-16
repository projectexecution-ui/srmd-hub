'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Loader2, Plus, Trash2, Pencil, X, Check } from 'lucide-react'
import { confirm } from '@/components/ui/confirm-dialog'
import { recycleDelete } from '@/lib/recycle-bin'

interface Warehouse {
  id: string
  code: string
  name: string
  location: string | null
  store_manager_id: string | null
  is_active: boolean
}

interface ManagerOption { id: string; label: string }

interface Props {
  warehouses: Warehouse[]
  managers: ManagerOption[]
}

export function WarehouseList({ warehouses: initial, managers }: Props) {
  const router = useRouter()
  const [rows, setRows] = useState(initial)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-rose-600">{error}</p>}

      <div className="flex justify-end">
        {!showAdd && (
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <Plus className="h-4 w-4" /> New warehouse
          </Button>
        )}
      </div>

      {showAdd && (
        <WarehouseForm
          managers={managers}
          onCancel={() => setShowAdd(false)}
          onSaved={(w) => {
            setRows(r => [...r, w].sort((a, b) => a.code.localeCompare(b.code)))
            setShowAdd(false)
            router.refresh()
          }}
          setBusy={setBusy}
          setError={setError}
          busy={busy}
        />
      )}

      {rows.length === 0 && !showAdd ? (
        <p className="text-sm text-gray-500 italic">No warehouses yet.</p>
      ) : (
        <div className="space-y-2">
          {rows.map(w =>
            editingId === w.id ? (
              <WarehouseForm
                key={w.id}
                initial={w}
                managers={managers}
                onCancel={() => setEditingId(null)}
                onSaved={(updated) => {
                  setRows(rs => rs.map(r => r.id === updated.id ? updated : r))
                  setEditingId(null)
                  router.refresh()
                }}
                setBusy={setBusy}
                setError={setError}
                busy={busy}
              />
            ) : (
              <WarehouseRow
                key={w.id}
                warehouse={w}
                managers={managers}
                onEdit={() => setEditingId(w.id)}
                onDeleted={() => {
                  setRows(rs => rs.filter(r => r.id !== w.id))
                  router.refresh()
                }}
                setError={setError}
              />
            ),
          )}
        </div>
      )}
    </div>
  )
}

function WarehouseRow({ warehouse, managers, onEdit, onDeleted, setError }: {
  warehouse: Warehouse
  managers: ManagerOption[]
  onEdit: () => void
  onDeleted: () => void
  setError: (s: string | null) => void
}) {
  const [deleting, setDeleting] = useState(false)
  const manager = managers.find(m => m.id === warehouse.store_manager_id)

  async function del() {
    if (!(await confirm({ title: `Delete warehouse "${warehouse.code} — ${warehouse.name}"?`, message: 'It moves to the Recycle Bin — an admin can restore it from Admin › Recycle Bin.', confirmLabel: 'Delete' }))) return
    setDeleting(true); setError(null)
    const err = await recycleDelete(createClient(), {
      sourceTable: 'inv_warehouses', entityId: warehouse.id, entityType: 'Warehouse',
      label: `${warehouse.code} — ${warehouse.name}`, context: warehouse.location ?? undefined,
      moduleSlug: 'inventory', alsoSet: { is_active: false },
    })
    setDeleting(false)
    if (err) { setError(err); return }
    onDeleted()
  }

  return (
    <div className="flex items-center justify-between gap-3 p-3 border border-gray-200 rounded-xl bg-white">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-xs font-bold text-blue-700">{warehouse.code}</span>
          <span className="font-semibold text-gray-900">{warehouse.name}</span>
          {!warehouse.is_active && <Badge variant="secondary">inactive</Badge>}
        </div>
        <p className="text-xs text-gray-500 mt-0.5">
          {warehouse.location || '—'}{manager ? ` · Store manager: ${manager.label}` : ''}
        </p>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <Button size="sm" variant="outline" onClick={onEdit}><Pencil className="h-4 w-4" /></Button>
        <Button size="sm" variant="outline" onClick={del} disabled={deleting}
          className="text-rose-700 hover:bg-rose-50 border-rose-200">
          {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  )
}

function WarehouseForm({ initial, managers, onCancel, onSaved, setBusy, setError, busy }: {
  initial?: Warehouse
  managers: ManagerOption[]
  onCancel: () => void
  onSaved: (w: Warehouse) => void
  setBusy: (b: boolean) => void
  setError: (s: string | null) => void
  busy: boolean
}) {
  const [code, setCode]         = useState(initial?.code ?? '')
  const [name, setName]         = useState(initial?.name ?? '')
  const [location, setLocation] = useState(initial?.location ?? '')
  const [managerId, setManagerId] = useState(initial?.store_manager_id ?? '')
  const [isActive, setIsActive]   = useState(initial?.is_active ?? true)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    const supabase = createClient()
    const payload = {
      code: code.trim(),
      name: name.trim(),
      location: location.trim() || null,
      store_manager_id: managerId || null,
      is_active: isActive,
    }
    const res = initial
      ? await supabase.from('inv_warehouses').update(payload).eq('id', initial.id).select('*').single()
      : await supabase.from('inv_warehouses').insert(payload).select('*').single()
    setBusy(false)
    if (res.error) { setError(res.error.message); return }
    onSaved(res.data as Warehouse)
  }

  return (
    <form onSubmit={save} className="p-4 border border-blue-200 bg-blue-50/30 rounded-xl space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <Label>Code *</Label>
          <Input value={code} onChange={e => setCode(e.target.value)} required placeholder="e.g. WH-DPR-01" className="mt-1 font-mono" />
        </div>
        <div>
          <Label>Name *</Label>
          <Input value={name} onChange={e => setName(e.target.value)} required placeholder="e.g. Dharampur Main Store" className="mt-1" />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <Label>Location</Label>
          <Input value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g. Dharampur Campus" className="mt-1" />
        </div>
        <div>
          <Label>Store manager</Label>
          <select value={managerId} onChange={e => setManagerId(e.target.value)}
            className="mt-1 flex h-10 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm">
            <option value="">— Not assigned —</option>
            {managers.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </div>
      </div>
      <label className="inline-flex items-center gap-2 text-sm">
        <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} />
        Active
      </label>
      <div className="flex gap-2 pt-1">
        <Button type="submit" size="sm" disabled={busy || !code || !name}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {initial ? 'Save' : 'Create'}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          <X className="h-4 w-4" /> Cancel
        </Button>
      </div>
    </form>
  )
}
