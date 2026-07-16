'use client'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Loader2, Plus, Trash2, Pencil, X, Check, Upload, ImageOff, ChevronDown, ChevronRight } from 'lucide-react'
import { INVENTORY_CATEGORIES } from '@/lib/inventory-categories'
import { confirm } from '@/components/ui/confirm-dialog'
import { recycleDelete } from '@/lib/recycle-bin'

interface Item {
  id: string
  code: string
  name: string
  description: string | null
  unit: string
  category: string | null
  image_url: string | null
  hsn_code: string | null
  is_active: boolean
}

const UNITS = ['nos', 'kg', 'bags', 'm', 'sq.m', 'cu.m', 'ltr', 'set', 'roll', 'sheet']

export function ItemList({ items: initial }: { items: Item[] }) {
  const router = useRouter()
  const [rows, setRows] = useState(initial)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [q, setQ] = useState('')
  const [activeCategory, setActiveCategory] = useState<string>('All')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Categories collapsed by default? Keep them all open — handy for browse.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  // Categories that actually have items + "Uncategorised"
  const categoryOrder = useMemo(() => {
    const used = new Set<string>()
    for (const r of rows) used.add(r.category || 'Uncategorised')
    // Standard order: as declared in INVENTORY_CATEGORIES, then any extras.
    const out: string[] = []
    for (const c of INVENTORY_CATEGORIES) if (used.has(c)) out.push(c)
    for (const c of Array.from(used).sort()) {
      if (!out.includes(c)) out.push(c)
    }
    return out
  }, [rows])

  const filtered = useMemo(() => {
    let out = rows
    if (activeCategory !== 'All') out = out.filter(r => (r.category || 'Uncategorised') === activeCategory)
    const lc = q.trim().toLowerCase()
    if (lc) {
      out = out.filter(r =>
        r.code.toLowerCase().includes(lc) ||
        r.name.toLowerCase().includes(lc) ||
        (r.category ?? '').toLowerCase().includes(lc),
      )
    }
    return out
  }, [rows, q, activeCategory])

  // Group filtered items by category for the rendered view
  const grouped = useMemo(() => {
    const map = new Map<string, Item[]>()
    for (const it of filtered) {
      const k = it.category || 'Uncategorised'
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(it)
    }
    // Preserve category order
    const ordered: Array<{ category: string; items: Item[] }> = []
    for (const c of categoryOrder) {
      if (map.has(c)) ordered.push({ category: c, items: map.get(c)! })
    }
    return ordered
  }, [filtered, categoryOrder])

  function toggleCollapse(cat: string) {
    setCollapsed(s => {
      const next = new Set(s)
      if (next.has(cat)) next.delete(cat); else next.add(cat)
      return next
    })
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-rose-600">{error}</p>}

      <div className="flex flex-col md:flex-row gap-2 md:items-center md:justify-between">
        <Input
          placeholder="Search by code, name or category…"
          value={q}
          onChange={e => setQ(e.target.value)}
          className="md:max-w-sm"
        />
        {!showAdd && (
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <Plus className="h-4 w-4" /> New item
          </Button>
        )}
      </div>

      {/* Category chips */}
      <div className="overflow-x-auto -mx-1 px-1">
        <div className="flex gap-1.5 min-w-min">
          <CategoryChip
            label="All"
            count={rows.length}
            active={activeCategory === 'All'}
            onClick={() => setActiveCategory('All')}
          />
          {categoryOrder.map(c => (
            <CategoryChip
              key={c}
              label={c}
              count={rows.filter(r => (r.category || 'Uncategorised') === c).length}
              active={activeCategory === c}
              onClick={() => setActiveCategory(c)}
            />
          ))}
        </div>
      </div>

      {showAdd && (
        <ItemForm
          onCancel={() => setShowAdd(false)}
          onSaved={(it) => {
            setRows(r => [...r, it].sort((a, b) => a.code.localeCompare(b.code)))
            setShowAdd(false)
            router.refresh()
          }}
          setBusy={setBusy} setError={setError} busy={busy}
        />
      )}

      {filtered.length === 0 && !showAdd ? (
        <p className="text-sm text-gray-500 italic py-4">No items found.</p>
      ) : (
        <div className="space-y-4">
          {grouped.map(g => {
            const isCollapsed = collapsed.has(g.category)
            return (
              <div key={g.category}>
                <button
                  type="button"
                  onClick={() => toggleCollapse(g.category)}
                  className="w-full flex items-center justify-between gap-2 px-1 py-1.5 text-xs font-bold uppercase tracking-wide text-gray-500 hover:text-gray-800"
                >
                  <span className="inline-flex items-center gap-1.5">
                    {isCollapsed
                      ? <ChevronRight className="h-3.5 w-3.5" />
                      : <ChevronDown className="h-3.5 w-3.5" />}
                    {g.category}
                    <span className="text-gray-400 normal-case">· {g.items.length}</span>
                  </span>
                </button>
                {!isCollapsed && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-1">
                    {g.items.map(it =>
                      editingId === it.id ? (
                        <div key={it.id} className="md:col-span-2">
                          <ItemForm
                            initial={it}
                            onCancel={() => setEditingId(null)}
                            onSaved={(updated) => {
                              setRows(rs => rs.map(r => r.id === updated.id ? updated : r))
                              setEditingId(null)
                              router.refresh()
                            }}
                            setBusy={setBusy} setError={setError} busy={busy}
                          />
                        </div>
                      ) : (
                        <ItemRow
                          key={it.id}
                          item={it}
                          onEdit={() => setEditingId(it.id)}
                          onDeleted={() => { setRows(rs => rs.filter(r => r.id !== it.id)); router.refresh() }}
                          setError={setError}
                        />
                      ),
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function CategoryChip({ label, count, active, onClick }: {
  label: string; count: number; active: boolean; onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 text-xs font-medium px-3 h-7 rounded-full whitespace-nowrap ${
        active ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
      }`}
    >
      {label}
      <span className={active ? 'text-blue-100' : 'text-gray-400'}>{count}</span>
    </button>
  )
}

function ItemRow({ item, onEdit, onDeleted, setError }: {
  item: Item
  onEdit: () => void
  onDeleted: () => void
  setError: (s: string | null) => void
}) {
  const [deleting, setDeleting] = useState(false)

  async function del() {
    if (!(await confirm({ title: `Delete item "${item.code} — ${item.name}"?`, message: 'It moves to the Recycle Bin — an admin can restore it from Admin › Recycle Bin.', confirmLabel: 'Delete' }))) return
    setDeleting(true); setError(null)
    const err = await recycleDelete(createClient(), {
      sourceTable: 'inv_items', entityId: item.id, entityType: 'Inventory item',
      label: `${item.code} — ${item.name}`, context: item.category ?? undefined,
      moduleSlug: 'inventory', alsoSet: { is_active: false },
    })
    setDeleting(false)
    if (err) { setError(err); return }
    onDeleted()
  }

  return (
    <div className="flex items-center gap-3 p-3 border border-gray-200 rounded-xl bg-white">
      <div className="h-14 w-14 flex-shrink-0 rounded-lg border border-gray-100 bg-gray-50 overflow-hidden flex items-center justify-center">
        {item.image_url ? (
          <Image src={item.image_url} alt={item.name} width={56} height={56} className="object-cover h-full w-full" unoptimized />
        ) : (
          <ImageOff className="h-5 w-5 text-gray-300" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-xs font-bold text-blue-700">{item.code}</span>
          <span className="font-semibold text-gray-900 truncate">{item.name}</span>
          {!item.is_active && <Badge variant="secondary">inactive</Badge>}
        </div>
        <p className="text-xs text-gray-500 mt-0.5 truncate">
          {item.unit}{item.hsn_code ? ` · HSN ${item.hsn_code}` : ''}
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

function ItemForm({ initial, onCancel, onSaved, setBusy, setError, busy }: {
  initial?: Item
  onCancel: () => void
  onSaved: (i: Item) => void
  setBusy: (b: boolean) => void
  setError: (s: string | null) => void
  busy: boolean
}) {
  const [code, setCode]               = useState(initial?.code ?? '')
  const [name, setName]               = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [unit, setUnit]               = useState(initial?.unit ?? 'nos')
  const [category, setCategory]       = useState(initial?.category ?? INVENTORY_CATEGORIES[0])
  const [hsnCode, setHsnCode]         = useState(initial?.hsn_code ?? '')
  const [isActive, setIsActive]       = useState(initial?.is_active ?? true)
  const [imageUrl, setImageUrl]       = useState(initial?.image_url ?? '')
  const [uploading, setUploading]     = useState(false)

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true); setError(null)
    const supabase = createClient()
    const ext = file.name.split('.').pop() ?? 'png'
    const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    const { error: upErr } = await supabase.storage.from('item-images').upload(path, file, { upsert: false })
    if (upErr) { setError(upErr.message); setUploading(false); return }
    const { data: pub } = supabase.storage.from('item-images').getPublicUrl(path)
    setImageUrl(pub.publicUrl)
    setUploading(false)
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    const supabase = createClient()
    const payload = {
      code: code.trim(),
      name: name.trim(),
      description: description.trim() || null,
      unit: unit.trim(),
      category: category.trim() || null,
      hsn_code: hsnCode.trim() || null,
      image_url: imageUrl || null,
      is_active: isActive,
    }
    const res = initial
      ? await supabase.from('inv_items').update(payload).eq('id', initial.id).select('*').single()
      : await supabase.from('inv_items').insert(payload).select('*').single()
    setBusy(false)
    if (res.error) { setError(res.error.message); return }
    onSaved(res.data as Item)
  }

  return (
    <form onSubmit={save} className="p-4 border border-blue-200 bg-blue-50/30 rounded-xl space-y-3">
      <div className="flex items-start gap-4">
        <div className="h-24 w-24 flex-shrink-0 rounded-lg border border-gray-200 bg-white overflow-hidden flex items-center justify-center">
          {imageUrl ? (
            <Image src={imageUrl} alt="preview" width={96} height={96} className="object-cover h-full w-full" unoptimized />
          ) : (
            <ImageOff className="h-6 w-6 text-gray-300" />
          )}
        </div>
        <div className="flex-1">
          <Label>Image</Label>
          <div className="mt-1 flex items-center gap-2">
            <label className="inline-flex items-center gap-1.5 text-sm border border-gray-300 hover:border-gray-400 rounded-lg px-3 h-9 cursor-pointer bg-white">
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              Upload
              <input type="file" accept="image/*" className="hidden" onChange={handleFile} disabled={uploading} />
            </label>
            {imageUrl && (
              <Button type="button" size="sm" variant="ghost" onClick={() => setImageUrl('')}>
                <X className="h-4 w-4" /> Clear
              </Button>
            )}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <Label>Code *</Label>
          <Input value={code} onChange={e => setCode(e.target.value)} required placeholder="e.g. CEM-OPC53" className="mt-1 font-mono" />
        </div>
        <div className="md:col-span-2">
          <Label>Name *</Label>
          <Input value={name} onChange={e => setName(e.target.value)} required placeholder="e.g. OPC 53 Grade Cement" className="mt-1" />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <Label>Unit *</Label>
          <select value={unit} onChange={e => setUnit(e.target.value)} required
            className="mt-1 flex h-10 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm">
            {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
        <div>
          <Label>Category *</Label>
          <select value={category} onChange={e => setCategory(e.target.value)} required
            className="mt-1 flex h-10 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm">
            {INVENTORY_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <Label>HSN code</Label>
          <Input value={hsnCode} onChange={e => setHsnCode(e.target.value)} placeholder="optional" className="mt-1" />
        </div>
      </div>
      <div>
        <Label>Description</Label>
        <Textarea value={description ?? ''} onChange={e => setDescription(e.target.value)} rows={2} className="mt-1" />
      </div>
      <label className="inline-flex items-center gap-2 text-sm">
        <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} />
        Active
      </label>
      <div className="flex gap-2 pt-1">
        <Button type="submit" size="sm" disabled={busy || uploading || !code || !name || !unit}>
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
