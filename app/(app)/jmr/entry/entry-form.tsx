'use client'
import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card } from '@/components/ui/card'
import { Lock, Camera, Loader2 } from 'lucide-react'
import { resolveRate } from '@/lib/jmr/rates'
import { formatINR, todayISO } from '@/lib/jmr/format'
import { format as fmt } from 'date-fns'
import type { JmrItemCategory } from '@/lib/types'

type Project = { id: string; name: string; code: string | null }
type Contractor = { id: string; name: string }
type Item = { id: string; name: string; category: 'equipment' | 'manpower'; unit: string }

interface Props {
  userName: string
  projects: Project[]
  contractors: Contractor[]
  items: Item[]
}

export function EntryForm({ userName, projects, contractors, items }: Props) {
  const router = useRouter()
  const supabase = createClient()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [projectId, setProjectId] = useState('')
  const [subProjects, setSubProjects] = useState<Project[]>([])
  const [subProjectId, setSubProjectId] = useState('')
  const [category, setCategory] = useState<JmrItemCategory>('equipment')
  const [contractorId, setContractorId] = useState('')
  const [itemId, setItemId] = useState('')
  const [startMeter, setStartMeter] = useState('')
  const [endMeter, setEndMeter] = useState('')
  const [qty, setQty] = useState('')
  const [rate, setRate] = useState<number | null>(null)
  const [description, setDescription] = useState('')
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [entryDate] = useState(todayISO())

  const filteredItems = useMemo(() => items.filter(i => i.category === category), [items, category])
  const selectedItem = useMemo(() => items.find(i => i.id === itemId), [items, itemId])
  const isHourly = selectedItem?.unit === 'hr'

  // Load sub-projects when project changes.
  useEffect(() => {
    if (!projectId) { setSubProjects([]); setSubProjectId(''); return }
    let alive = true
    ;(async () => {
      const { data } = await supabase
        .from('projects')
        .select('id, name, code')
        .eq('parent_project_id', projectId)
        .order('name')
      if (!alive) return
      setSubProjects(data ?? [])
      setSubProjectId('')
    })()
    return () => { alive = false }
  }, [projectId, supabase])

  // Resolve rate when contractor/item/project changes.
  useEffect(() => {
    if (!contractorId || !itemId) { setRate(null); return }
    let alive = true
    ;(async () => {
      const r = await resolveRate({
        contractorId, itemId, projectId: projectId || null, onDate: entryDate,
      })
      if (alive) setRate(r)
    })()
    return () => { alive = false }
  }, [contractorId, itemId, projectId, entryDate])

  // Reset item if category changes.
  useEffect(() => {
    if (itemId && !filteredItems.find(i => i.id === itemId)) setItemId('')
  }, [filteredItems, itemId])

  const hours = useMemo(() => {
    if (!isHourly) return null
    const s = Number(startMeter); const e = Number(endMeter)
    if (isNaN(s) || isNaN(e) || e <= s) return null
    return +(e - s).toFixed(2)
  }, [startMeter, endMeter, isHourly])

  const effectiveQty = isHourly ? hours : (qty ? Number(qty) : null)
  const earned = (rate != null && effectiveQty != null) ? +(rate * effectiveQty).toFixed(2) : null

  const canSubmit = !!(
    projectId && contractorId && itemId && rate != null && effectiveQty != null &&
    effectiveQty > 0 && (!isHourly || (hours != null && hours <= 24)) &&
    photoFile && !saving
  )

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!canSubmit) return
    setSaving(true)

    // 1. Upload photo
    let photoUrl: string | null = null
    if (photoFile) {
      const ext = photoFile.name.split('.').pop() || 'jpg'
      const path = `entries/${entryDate}/${crypto.randomUUID()}.${ext}`
      const { error: upErr } = await supabase.storage.from('jmr-photos').upload(path, photoFile, {
        cacheControl: '3600', contentType: photoFile.type || 'image/jpeg',
      })
      if (upErr) { setError(`Photo upload failed: ${upErr.message}`); setSaving(false); return }
      photoUrl = path
    }

    // 2. Insert entry
    const user = (await supabase.auth.getUser()).data.user
    const { error: insErr } = await supabase.from('jmr_daily_entries').insert({
      project_id: projectId,
      sub_project_id: subProjectId || null,
      contractor_id: contractorId,
      item_id: itemId,
      entry_date: entryDate,
      start_meter: isHourly && startMeter ? Number(startMeter) : null,
      end_meter: isHourly && endMeter ? Number(endMeter) : null,
      quantity: effectiveQty,
      rate_snapshot: rate,
      amount: earned,
      work_description: description || null,
      log_sheet_photo_url: photoUrl,
      logged_by_user_id: user?.id ?? null,
      status: 'submitted',
    })
    if (insErr) { setError(insErr.message); setSaving(false); return }

    // Reset form (keep project/sub-project/contractor for fast follow-up logging)
    setItemId(''); setStartMeter(''); setEndMeter(''); setQty('')
    setDescription(''); setPhotoFile(null); setRate(null)
    setSaving(false)
    router.refresh()
  }

  return (
    <Card className="p-4 mb-4">
      <div className="mb-3">
        <h2 className="text-base font-bold text-gray-900">Log machine hours</h2>
        <p className="text-xs text-gray-500 mt-0.5">{userName} · {fmt(new Date(entryDate), 'd MMM yy')}</p>
      </div>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <Label>Project</Label>
          <Select value={projectId} onChange={setProjectId} required>
            <option value="">— select project —</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.code ? `${p.code} — ` : ''}{p.name}</option>)}
          </Select>
        </div>
        {subProjects.length > 0 && (
          <div>
            <Label>Sub-project</Label>
            <Select value={subProjectId} onChange={setSubProjectId}>
              <option value="">— optional —</option>
              {subProjects.map(p => <option key={p.id} value={p.id}>{p.code ? `${p.code} — ` : ''}{p.name}</option>)}
            </Select>
          </div>
        )}
        <div>
          <Label>Category</Label>
          <div className="grid grid-cols-2 gap-2 mt-1">
            <CategoryButton active={category === 'equipment'} onClick={() => setCategory('equipment')}>Equipment</CategoryButton>
            <CategoryButton active={category === 'manpower'} onClick={() => setCategory('manpower')}>Manpower</CategoryButton>
          </div>
        </div>
        <div>
          <Label>Contractor</Label>
          <Select value={contractorId} onChange={setContractorId} required>
            <option value="">— select —</option>
            {contractors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </div>
        <div>
          <Label>Item</Label>
          <Select value={itemId} onChange={setItemId} required>
            <option value="">— select {category === 'equipment' ? 'equipment' : 'manpower'} —</option>
            {filteredItems.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
          </Select>
        </div>
        {rate != null && selectedItem && (
          <div className="flex items-center justify-between bg-blue-50 border border-blue-100 rounded-md px-3 py-2 text-sm">
            <span className="text-blue-900 inline-flex items-center gap-1.5">
              <Lock className="h-3.5 w-3.5" /> Auto rate
            </span>
            <span className="font-semibold text-blue-900">{formatINR(rate)}/{selectedItem.unit}</span>
          </div>
        )}
        {itemId && rate == null && (
          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-md px-3 py-2">
            No active rate card found for this contractor + item. Ask admin to add one.
          </div>
        )}
        {isHourly ? (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Start meter</Label>
              <Input type="number" inputMode="decimal" step="0.01" value={startMeter} onChange={e => setStartMeter(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>End meter</Label>
              <Input type="number" inputMode="decimal" step="0.01" value={endMeter} onChange={e => setEndMeter(e.target.value)} className="mt-1" />
            </div>
          </div>
        ) : selectedItem ? (
          <div>
            <Label>Quantity ({selectedItem.unit})</Label>
            <Input type="number" inputMode="decimal" step="0.01" min="0" value={qty} onChange={e => setQty(e.target.value)} className="mt-1" />
          </div>
        ) : null}
        {(effectiveQty != null || earned != null) && (
          <div className="flex items-center justify-between bg-gray-50 rounded-md px-3 py-2 text-sm">
            <div>
              <p className="text-xs text-gray-500">{isHourly ? 'Hours' : 'Qty'}</p>
              <p className="font-bold text-gray-900">{effectiveQty ?? '—'}{isHourly ? ' hr' : ''}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500">Earned today</p>
              <p className="font-bold text-emerald-700">{earned != null ? formatINR(earned) : '—'}</p>
            </div>
          </div>
        )}
        <div>
          <Label>Work / location</Label>
          <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} placeholder="e.g. Foundation pit, gridline 5-7" className="mt-1" />
        </div>
        <div>
          <label className="block">
            <span className="sr-only">Photo of signed log sheet</span>
            <div className={`flex flex-col items-center justify-center border-2 border-dashed rounded-md px-3 py-5 cursor-pointer ${photoFile ? 'border-emerald-300 bg-emerald-50' : 'border-gray-300 hover:border-gray-400'}`}>
              <Camera className="h-5 w-5 text-gray-500 mb-1" />
              <span className="text-sm text-gray-700">{photoFile ? photoFile.name : 'Photo of signed log sheet'}</span>
              <span className="text-[10px] text-gray-500 mt-0.5">required</span>
            </div>
            <input
              type="file" accept="image/jpeg,image/png" capture="environment"
              className="sr-only"
              onChange={e => setPhotoFile(e.target.files?.[0] ?? null)}
            />
          </label>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button type="submit" disabled={!canSubmit} className="w-full">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Submit entry
        </Button>
      </form>
    </Card>
  )
}

function Select({ value, onChange, children, required }: {
  value: string; onChange: (v: string) => void; children: React.ReactNode; required?: boolean
}) {
  return (
    <select
      value={value} required={required}
      onChange={e => onChange(e.target.value)}
      className="mt-1 flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      {children}
    </select>
  )
}

function CategoryButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button" onClick={onClick}
      className={`h-10 rounded-md text-sm font-medium border transition-colors ${active ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
    >
      {children}
    </button>
  )
}
