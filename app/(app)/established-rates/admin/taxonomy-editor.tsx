'use client'
// Taxonomy editor — three flat tables (Disciplines / Categories /
// Sub-categories). Click a discipline to filter categories below;
// click a category to filter sub-categories. Inline add/edit.

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, Plus, Trash2, Check, X, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { confirm } from '@/components/ui/confirm-dialog'

interface Discipline   { id: string; code: string | null; name: string; display_order: number; is_archived: boolean }
interface Category     { id: string; discipline_id: string; code: string | null; name: string; display_order: number; is_archived: boolean }
interface Subcategory  { id: string; category_id: string; code: string | null; name: string; short_name: string | null; uom: string; display_order: number; is_archived: boolean }

interface Props {
  disciplines: Discipline[]
  categories: Category[]
  subcategories: Subcategory[]
}

export function TaxonomyEditor({ disciplines: initialD, categories: initialC, subcategories: initialS }: Props) {
  const router = useRouter()
  const [disciplines, setDisciplines] = useState(initialD)
  const [categories,  setCategories]  = useState(initialC)
  const [subcategories, setSubs]      = useState(initialS)
  const [selectedDisc, setSelectedDisc] = useState<string | null>(initialD[0]?.id ?? null)
  const [selectedCat,  setSelectedCat]  = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const filteredCats = useMemo(
    () => selectedDisc ? categories.filter(c => c.discipline_id === selectedDisc) : [],
    [categories, selectedDisc],
  )
  const filteredSubs = useMemo(
    () => selectedCat ? subcategories.filter(s => s.category_id === selectedCat) : [],
    [subcategories, selectedCat],
  )

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-rose-600 px-3">{error}</p>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Disciplines */}
        <Card>
          <CardContent className="pt-4 pb-4">
            <Header label="Disciplines" />
            <TaxonomyList
              kind="discipline"
              rows={disciplines}
              selectedId={selectedDisc}
              onSelect={(id) => { setSelectedDisc(id); setSelectedCat(null) }}
              onAdd={async (code, name) => {
                setBusy('add-disc'); setError(null)
                const { data, error } = await createClient().from('est_disciplines')
                  .insert({ code: code || null, name }).select('*').single()
                setBusy(null)
                if (error) { setError(error.message); return false }
                setDisciplines(rs => [...rs, data as Discipline])
                router.refresh()
                return true
              }}
              onRename={async (id, patch) => {
                setBusy(id); setError(null)
                const { error } = await createClient().from('est_disciplines').update(patch).eq('id', id)
                setBusy(null)
                if (error) { setError(error.message); return false }
                setDisciplines(rs => rs.map(r => r.id === id ? { ...r, ...patch } : r))
                router.refresh()
                return true
              }}
              onDelete={async (id) => {
                if (!(await confirm('Delete this discipline? Categories beneath block deletion if they exist.'))) return false
                setBusy(id); setError(null)
                const { error } = await createClient().from('est_disciplines').delete().eq('id', id)
                setBusy(null)
                if (error) { setError(error.message); return false }
                setDisciplines(rs => rs.filter(r => r.id !== id))
                if (selectedDisc === id) setSelectedDisc(null)
                router.refresh()
                return true
              }}
              busy={busy}
            />
          </CardContent>
        </Card>

        {/* Categories */}
        <Card>
          <CardContent className="pt-4 pb-4">
            <Header label="Categories" sub={selectedDisc ? (disciplines.find(d => d.id === selectedDisc)?.name ?? '') : 'Select a discipline →'} />
            {selectedDisc ? (
              <TaxonomyList
                kind="category"
                rows={filteredCats}
                selectedId={selectedCat}
                onSelect={setSelectedCat}
                onAdd={async (code, name) => {
                  setBusy('add-cat'); setError(null)
                  const { data, error } = await createClient().from('est_categories')
                    .insert({ discipline_id: selectedDisc, code: code || null, name }).select('*').single()
                  setBusy(null)
                  if (error) { setError(error.message); return false }
                  setCategories(rs => [...rs, data as Category])
                  router.refresh()
                  return true
                }}
                onRename={async (id, patch) => {
                  setBusy(id); setError(null)
                  const { error } = await createClient().from('est_categories').update(patch).eq('id', id)
                  setBusy(null)
                  if (error) { setError(error.message); return false }
                  setCategories(rs => rs.map(r => r.id === id ? { ...r, ...patch } : r))
                  router.refresh()
                  return true
                }}
                onDelete={async (id) => {
                  if (!(await confirm('Delete this category?'))) return false
                  setBusy(id); setError(null)
                  const { error } = await createClient().from('est_categories').delete().eq('id', id)
                  setBusy(null)
                  if (error) { setError(error.message); return false }
                  setCategories(rs => rs.filter(r => r.id !== id))
                  if (selectedCat === id) setSelectedCat(null)
                  router.refresh()
                  return true
                }}
                busy={busy}
              />
            ) : (
              <p className="text-xs text-gray-400 italic mt-3">Pick a discipline on the left.</p>
            )}
          </CardContent>
        </Card>

        {/* Sub-categories */}
        <Card>
          <CardContent className="pt-4 pb-4">
            <Header label="Sub-categories" sub={selectedCat ? (categories.find(c => c.id === selectedCat)?.name ?? '') : 'Select a category →'} />
            {selectedCat ? (
              <SubcategoryList
                rows={filteredSubs}
                onAdd={async (code, name, uom) => {
                  setBusy('add-sub'); setError(null)
                  const { data, error } = await createClient().from('est_subcategories')
                    .insert({ category_id: selectedCat, code: code || null, name, uom }).select('*').single()
                  setBusy(null)
                  if (error) { setError(error.message); return false }
                  setSubs(rs => [...rs, data as Subcategory])
                  router.refresh()
                  return true
                }}
                onRename={async (id, patch) => {
                  setBusy(id); setError(null)
                  const { error } = await createClient().from('est_subcategories').update(patch).eq('id', id)
                  setBusy(null)
                  if (error) { setError(error.message); return false }
                  setSubs(rs => rs.map(r => r.id === id ? { ...r, ...patch } : r))
                  router.refresh()
                  return true
                }}
                onDelete={async (id) => {
                  if (!(await confirm('Delete this sub-category? All rates beneath are also deleted.'))) return false
                  setBusy(id); setError(null)
                  const { error } = await createClient().from('est_subcategories').delete().eq('id', id)
                  setBusy(null)
                  if (error) { setError(error.message); return false }
                  setSubs(rs => rs.filter(r => r.id !== id))
                  router.refresh()
                  return true
                }}
                busy={busy}
              />
            ) : (
              <p className="text-xs text-gray-400 italic mt-3">Pick a category in the middle.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function Header({ label, sub }: { label: string; sub?: string }) {
  return (
    <div className="mb-2">
      <h3 className="text-sm font-bold uppercase tracking-wide text-gray-700">{label}</h3>
      {sub && <p className="text-xs text-gray-500 truncate">{sub}</p>}
    </div>
  )
}

interface TaxRow { id: string; code: string | null; name: string }
interface TaxListProps<R extends TaxRow> {
  kind: 'discipline' | 'category'
  rows: R[]
  selectedId: string | null
  onSelect: (id: string) => void
  onAdd: (code: string, name: string) => Promise<boolean>
  onRename: (id: string, patch: { code?: string | null; name?: string }) => Promise<boolean>
  onDelete: (id: string) => Promise<boolean>
  busy: string | null
}

function TaxonomyList<R extends TaxRow>({ rows, selectedId, onSelect, onAdd, onRename, onDelete, busy }: TaxListProps<R>) {
  const [adding, setAdding] = useState(false)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')

  async function commitAdd() {
    if (!name.trim()) return
    const ok = await onAdd(code.trim(), name.trim())
    if (ok) { setCode(''); setName(''); setAdding(false) }
  }

  return (
    <div className="space-y-1.5 mt-2">
      {rows.length === 0 && !adding && (
        <p className="text-xs text-gray-400 italic">None yet.</p>
      )}
      {rows.map(r => (
        <button
          key={r.id}
          type="button"
          onClick={() => onSelect(r.id)}
          className={cn(
            'w-full flex items-center justify-between gap-2 text-left px-2 py-1.5 rounded-md text-sm',
            selectedId === r.id ? 'bg-blue-50 text-blue-800 ring-1 ring-blue-200' : 'hover:bg-gray-50',
          )}
        >
          <span className="flex items-center gap-2 flex-1 min-w-0">
            {r.code && <span className="font-mono text-[11px] text-gray-400 flex-shrink-0">{r.code}</span>}
            <span className="truncate">{r.name}</span>
            <ArrowRight className="h-3 w-3 text-gray-300 flex-shrink-0" />
          </span>
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onDelete(r.id) }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onDelete(r.id) } }}
            className="text-rose-500 hover:text-rose-700 inline-flex items-center justify-center h-6 w-6 rounded cursor-pointer"
            title="Delete"
          >
            {busy === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          </span>
        </button>
      ))}
      {adding ? (
        <div className="p-2 border border-blue-200 bg-blue-50/40 rounded-md space-y-2">
          <div className="flex gap-2">
            <Input value={code} onChange={e => setCode(e.target.value)} placeholder="Code" className="h-8 w-20 text-xs font-mono" />
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Name" className="h-8 text-xs flex-1" autoFocus />
          </div>
          <div className="flex justify-end gap-1">
            <Button type="button" size="sm" variant="ghost" onClick={() => { setAdding(false); setCode(''); setName('') }}>
              <X className="h-3.5 w-3.5" />
            </Button>
            <Button type="button" size="sm" onClick={commitAdd} disabled={!name.trim()}>
              <Check className="h-3.5 w-3.5" /> Add
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" size="sm" variant="outline" onClick={() => setAdding(true)} className="w-full">
          <Plus className="h-3.5 w-3.5" /> Add
        </Button>
      )}
    </div>
  )
}

interface SubRow { id: string; code: string | null; name: string; uom: string }
interface SubListProps {
  rows: SubRow[]
  onAdd: (code: string, name: string, uom: string) => Promise<boolean>
  onRename: (id: string, patch: { code?: string | null; name?: string; uom?: string }) => Promise<boolean>
  onDelete: (id: string) => Promise<boolean>
  busy: string | null
}

function SubcategoryList({ rows, onAdd, onDelete, busy }: SubListProps) {
  const [adding, setAdding] = useState(false)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [uom, setUom]   = useState('Nos')

  async function commit() {
    if (!name.trim() || !uom.trim()) return
    const ok = await onAdd(code.trim(), name.trim(), uom.trim())
    if (ok) { setCode(''); setName(''); setUom('Nos'); setAdding(false) }
  }

  return (
    <div className="space-y-1.5 mt-2">
      {rows.length === 0 && !adding && (
        <p className="text-xs text-gray-400 italic">None yet.</p>
      )}
      {rows.map(r => (
        <div key={r.id} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md hover:bg-gray-50 text-sm">
          <div className="flex-1 min-w-0">
            <p className="text-gray-800 truncate">{r.name}</p>
            <p className="text-[11px] text-gray-400">per {r.uom}</p>
          </div>
          <button
            type="button"
            onClick={() => onDelete(r.id)}
            className="text-rose-500 hover:text-rose-700 inline-flex items-center justify-center h-6 w-6 rounded"
            title="Delete"
          >
            {busy === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          </button>
        </div>
      ))}
      {adding ? (
        <div className="p-2 border border-blue-200 bg-blue-50/40 rounded-md space-y-2">
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="Sub-category name" className="h-8 text-xs" autoFocus />
          <div className="flex gap-2">
            <Input value={code} onChange={e => setCode(e.target.value)} placeholder="Code (optional)" className="h-8 w-24 text-xs font-mono" />
            <select value={uom} onChange={e => setUom(e.target.value)} className="h-8 flex-1 rounded border border-gray-300 bg-white px-2 text-xs">
              {['Nos','Per Hr','Per Hrs','Day','Month','Lump Sum','SqM','SqFt','Cum','MT','kg','Per Trip','Set','Roll','Sheet'].map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-1">
            <Button type="button" size="sm" variant="ghost" onClick={() => { setAdding(false); setCode(''); setName(''); setUom('Nos') }}>
              <X className="h-3.5 w-3.5" />
            </Button>
            <Button type="button" size="sm" onClick={commit} disabled={!name.trim()}>
              <Check className="h-3.5 w-3.5" /> Add
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" size="sm" variant="outline" onClick={() => setAdding(true)} className="w-full">
          <Plus className="h-3.5 w-3.5" /> Add sub-category
        </Button>
      )}
    </div>
  )
}
