'use client'
import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MoneyInput } from '@/components/ui/money-input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card } from '@/components/ui/card'
import { Lock, Camera, Loader2, Truck, Users, Check, ArrowRight } from 'lucide-react'
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
  // For hourly items we now collect time-of-day (HH:MM) instead of a
  // numeric meter reading. Stored as decimal hours in start_meter /
  // end_meter (e.g. 08:00 → 8.0, 17:30 → 17.5) so the existing column
  // schema still works.
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [qty, setQty] = useState('')
  const [rate, setRate] = useState<number | null>(null)
  const [description, setDescription] = useState('')
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  // Entry date — defaults to today, but the engineer can back-date when
  // catching up on a missed day. Future dates are blocked at the input.
  const [entryDate, setEntryDate] = useState(todayISO())
  const today = todayISO()

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

  // Live thumbnail preview of the picked log-sheet photo (revoked on change).
  useEffect(() => {
    if (!photoFile) { setPhotoPreview(null); return }
    const url = URL.createObjectURL(photoFile)
    setPhotoPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [photoFile])

  // Convert "HH:MM" → decimal hours (e.g. "08:30" → 8.5). Empty → null.
  function timeToHours(t: string): number | null {
    if (!t) return null
    const [hh, mm] = t.split(':').map(Number)
    if (Number.isNaN(hh) || Number.isNaN(mm)) return null
    return hh + mm / 60
  }
  const startHours = timeToHours(startTime)
  const endHours = timeToHours(endTime)
  const hours = useMemo(() => {
    if (!isHourly) return null
    if (startHours == null || endHours == null) return null
    // Handle overnight wrap (e.g. 22:00 → 06:00 = 8 hr) — if end <= start,
    // assume the shift crossed midnight.
    const raw = endHours >= startHours ? endHours - startHours : (24 - startHours) + endHours
    if (raw <= 0 || raw > 24) return null
    return +raw.toFixed(2)
  }, [startHours, endHours, isHourly])

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
    const { data: inserted, error: insErr } = await supabase.from('jmr_daily_entries').insert({
      project_id: projectId,
      sub_project_id: subProjectId || null,
      contractor_id: contractorId,
      item_id: itemId,
      entry_date: entryDate,
      start_meter: isHourly && startHours != null ? startHours : null,
      end_meter:   isHourly && endHours   != null ? endHours   : null,
      quantity: effectiveQty,
      rate_snapshot: rate,
      amount: earned,
      work_description: description || null,
      log_sheet_photo_url: photoUrl,
      logged_by_user_id: user?.id ?? null,
      status: 'submitted',
    }).select('id').single()
    if (insErr) { setError(insErr.message); setSaving(false); return }

    // 3. Ping the approvers instantly that there's an entry to review.
    //    Fire-and-forget — the submit already succeeded; a notify hiccup must
    //    never block or fail the engineer's save.
    if (inserted?.id) {
      void fetch('/api/jmr/entries/notify-submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entryId: inserted.id }),
      }).catch(() => {})
    }

    // Reset form (keep project/sub-project/contractor for fast follow-up logging)
    setItemId(''); setStartTime(''); setEndTime(''); setQty('')
    setDescription(''); setPhotoFile(null); setRate(null)
    setSaving(false)
    router.refresh()
  }

  return (
    <Card className="p-5 mb-4 rounded-2xl shadow-sm ring-1 ring-gray-200/70">
      <div className="mb-4">
        <h2 className="text-base font-bold text-gray-900">Log the day</h2>
        <p className="text-xs text-gray-500 mt-0.5">{userName} · {fmt(new Date(entryDate), 'd MMM yy')}</p>
      </div>
      <form onSubmit={submit} className="space-y-3.5">
        <div>
          <Label>Entry date</Label>
          <Input
            type="date"
            value={entryDate}
            max={today}
            onChange={e => setEntryDate(e.target.value || today)}
            className="mt-1"
          />
          {entryDate !== today && (
            <p className="text-[11px] text-amber-700 mt-1">Back-dated entry — rate will be looked up for {entryDate}.</p>
          )}
        </div>
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
            <CategoryButton active={category === 'equipment'} onClick={() => setCategory('equipment')}><Truck className="h-4 w-4" /> Equipment</CategoryButton>
            <CategoryButton active={category === 'manpower'} onClick={() => setCategory('manpower')}><Users className="h-4 w-4" /> Manpower</CategoryButton>
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
          <div className="flex items-center justify-between bg-blue-50 ring-1 ring-blue-100 rounded-xl px-3 py-2 text-sm">
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
          <div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Start time</Label>
                <Input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label>End time</Label>
                <Input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} className="mt-1" />
              </div>
            </div>
            {startHours != null && endHours != null && endHours < startHours && (
              <p className="text-[11px] text-amber-700 mt-1">Night shift — end is the next morning.</p>
            )}
          </div>
        ) : selectedItem ? (
          <div>
            <Label>Quantity ({selectedItem.unit})</Label>
            <MoneyInput value={qty} onChange={setQty} className="mt-1" />
          </div>
        ) : null}
        {(effectiveQty != null || earned != null) && (
          <div className="flex items-center justify-between bg-gradient-to-br from-emerald-50 to-white ring-1 ring-emerald-200/70 rounded-xl px-4 py-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{isHourly ? 'Hours' : 'Qty'}</p>
              <p className="text-lg font-bold text-gray-900">{effectiveQty ?? '—'}{isHourly ? ' hr' : ''}</p>
            </div>
            <ArrowRight className="h-4 w-4 text-gray-300" />
            <div className="text-right">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700/70">Value</p>
              <p className="text-lg font-bold text-emerald-700">{earned != null ? formatINR(earned) : '—'}</p>
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
            {photoPreview ? (
              <div className="flex items-center gap-3 rounded-xl ring-1 ring-emerald-300 bg-emerald-50 p-2.5 cursor-pointer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photoPreview} alt="Log sheet preview" className="h-14 w-14 rounded-lg object-cover ring-1 ring-emerald-200 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-emerald-800 inline-flex items-center gap-1"><Check className="h-3.5 w-3.5" /> Log sheet attached</p>
                  <p className="text-[11px] text-emerald-700/70 truncate">{photoFile?.name} · tap to change</p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center border-2 border-dashed rounded-xl px-3 py-6 cursor-pointer border-gray-300 hover:border-blue-400 hover:bg-blue-50/40 transition-colors">
                <span className="h-10 w-10 rounded-full bg-gray-100 grid place-items-center mb-2"><Camera className="h-5 w-5 text-gray-500" /></span>
                <span className="text-sm font-medium text-gray-700">Photo of signed log sheet</span>
                <span className="text-[11px] text-rose-500 mt-0.5">required · tap to take or upload</span>
              </div>
            )}
            <input
              type="file" accept="image/jpeg,image/png" capture="environment"
              className="sr-only"
              onChange={e => setPhotoFile(e.target.files?.[0] ?? null)}
            />
          </label>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button type="submit" disabled={!canSubmit} className="w-full h-11">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Submit entry{earned != null ? ` · ${formatINR(earned)}` : ''}
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
      className="mt-1 flex h-10 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      {children}
    </select>
  )
}

function CategoryButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button" onClick={onClick}
      className={`h-10 rounded-xl text-sm font-medium border transition-all inline-flex items-center justify-center gap-1.5 ${active ? 'bg-blue-600 text-white border-blue-600 shadow-sm' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}
    >
      {children}
    </button>
  )
}
