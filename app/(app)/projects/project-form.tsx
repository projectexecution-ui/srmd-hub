'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { MoneyInput } from '@/components/ui/money-input'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import type { Project, ProjectFloor } from '@/lib/types'

interface Props {
  initial?: Partial<Project>
  initialFloors?: ProjectFloor[]
  projectId?: string
}

type FloorRow = {
  // tempId is used to key newly-added unsaved rows; id is set for rows already in DB
  tempId: string
  id?: string
  name: string
  built_up_sft: string
  carpet_sft: string
}

// Inputs hold strings (HTML quirk); numField parses to number-or-null on save.
function numField(v: string): number | null {
  const trimmed = v.trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

function strOrNum(n: number | null | undefined): string {
  return n == null ? '' : String(n)
}

function newFloorRow(): FloorRow {
  return { tempId: crypto.randomUUID(), name: '', built_up_sft: '', carpet_sft: '' }
}

export function ProjectForm({ initial, initialFloors, projectId }: Props) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [p, setP] = useState({
    code: initial?.code ?? '',
    name: initial?.name ?? '',
    description: initial?.description ?? '',
    status: initial?.status ?? 'active',
    location: initial?.location ?? '',
    project_type: initial?.project_type ?? 'individual',
    plot_area_sft:      strOrNum(initial?.plot_area_sft),
    built_up_sft:       strOrNum(initial?.built_up_sft),
    carpet_sft:         strOrNum(initial?.carpet_sft),
    super_built_up_sft: strOrNum(initial?.super_built_up_sft),
    fsi_permitted:      strOrNum(initial?.fsi_permitted),
    fsi_consumed:       strOrNum(initial?.fsi_consumed),
  })

  const [floors, setFloors] = useState<FloorRow[]>(
    (initialFloors ?? [])
      .sort((a, b) => a.sequence - b.sequence)
      .map(f => ({
        tempId: f.id,
        id: f.id,
        name: f.name,
        built_up_sft: strOrNum(f.built_up_sft),
        carpet_sft: strOrNum(f.carpet_sft),
      })),
  )

  function updateFloor(tempId: string, patch: Partial<FloorRow>) {
    setFloors(rs => rs.map(r => r.tempId === tempId ? { ...r, ...patch } : r))
  }

  function addFloor() {
    setFloors(rs => [...rs, newFloorRow()])
  }

  function removeFloor(tempId: string) {
    setFloors(rs => rs.filter(r => r.tempId !== tempId))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const supabase = createClient()

    const projectPayload = {
      code: p.code,
      name: p.name,
      description: p.description || null,
      status: p.status,
      location: p.location || null,
      project_type: p.project_type,
      plot_area_sft:      numField(p.plot_area_sft),
      built_up_sft:       numField(p.built_up_sft),
      carpet_sft:         numField(p.carpet_sft),
      super_built_up_sft: numField(p.super_built_up_sft),
      fsi_permitted:      numField(p.fsi_permitted),
      fsi_consumed:       numField(p.fsi_consumed),
    }

    let savedId = projectId
    if (projectId) {
      const { error } = await supabase.from('projects').update(projectPayload).eq('id', projectId)
      if (error) { setError(error.message); setSaving(false); return }
    } else {
      const { data, error } = await supabase.from('projects').insert(projectPayload).select('id').single()
      if (error) { setError(error.message); setSaving(false); return }
      savedId = data.id
    }

    // Sync floors. Simplest correct strategy: drop all existing floors for this
    // project and re-insert from the editor. Cheap because cardinality is tiny.
    if (savedId) {
      const { error: delErr } = await supabase.from('project_floors').delete().eq('project_id', savedId)
      if (delErr) { setError(delErr.message); setSaving(false); return }
      const rows = floors
        .filter(f => f.name.trim() !== '')
        .map((f, i) => ({
          project_id: savedId,
          sequence: i,
          name: f.name.trim(),
          built_up_sft: numField(f.built_up_sft),
          carpet_sft:   numField(f.carpet_sft),
        }))
      if (rows.length > 0) {
        const { error: insErr } = await supabase.from('project_floors').insert(rows)
        if (insErr) { setError(insErr.message); setSaving(false); return }
      }
    }

    router.push(`/projects/${savedId}`)
    router.refresh()
  }

  // Quick FSI ratio hint
  const fsiPct = (() => {
    const perm = numField(p.fsi_permitted)
    const used = numField(p.fsi_consumed)
    if (!perm || !used) return null
    return Math.round((used / perm) * 100)
  })()

  return (
    <form onSubmit={submit} className="space-y-6">
      {/* ─── Basics ───────────────────────────── */}
      <section className="space-y-4">
        <h3 className="text-sm font-bold uppercase tracking-wide text-gray-500">Basics</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label>Code *</Label>
            <Input value={p.code} onChange={e => setP({ ...p, code: e.target.value })} required placeholder="e.g. NGH" className="mt-1 font-mono" />
          </div>
          <div>
            <Label>Status</Label>
            <select
              value={p.status ?? 'active'}
              onChange={e => setP({ ...p, status: e.target.value })}
              className="mt-1 flex h-10 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="active">Active</option>
              <option value="on_hold">On hold</option>
              <option value="completed">Completed</option>
              <option value="archived">Archived</option>
            </select>
          </div>
        </div>
        <div>
          <Label>Name *</Label>
          <Input value={p.name} onChange={e => setP({ ...p, name: e.target.value })} required placeholder="e.g. New Guest House" className="mt-1" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label>Location</Label>
            <Input value={p.location} onChange={e => setP({ ...p, location: e.target.value })} placeholder="e.g. Dharampur Campus" className="mt-1" />
          </div>
          <div>
            <Label>Type</Label>
            <select
              value={p.project_type}
              onChange={e => setP({ ...p, project_type: e.target.value })}
              className="mt-1 flex h-10 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="individual">Individual project</option>
              <option value="group">Group (parent of sub-projects)</option>
            </select>
          </div>
        </div>
        <div>
          <Label>Description</Label>
          <Textarea value={p.description ?? ''} onChange={e => setP({ ...p, description: e.target.value })} rows={3} className="mt-1" />
        </div>
      </section>

      {/* ─── Area Statement ───────────────────── */}
      <section className="space-y-4 pt-2 border-t border-gray-100">
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wide text-gray-500">Area Statement</h3>
          <p className="text-xs text-gray-400 mt-0.5">All optional. Matches the Budget vs Actual template. Areas in sq ft.</p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <Label>Plot area</Label>
            <MoneyInput value={p.plot_area_sft}      onChange={v => setP({ ...p, plot_area_sft: v })}      placeholder="sq ft" className="mt-1" />
          </div>
          <div>
            <Label>Built-up</Label>
            <MoneyInput value={p.built_up_sft}       onChange={v => setP({ ...p, built_up_sft: v })}       placeholder="sq ft" className="mt-1" />
          </div>
          <div>
            <Label>Carpet</Label>
            <MoneyInput value={p.carpet_sft}         onChange={v => setP({ ...p, carpet_sft: v })}         placeholder="sq ft" className="mt-1" />
          </div>
          <div>
            <Label>Super built-up</Label>
            <MoneyInput value={p.super_built_up_sft} onChange={v => setP({ ...p, super_built_up_sft: v })} placeholder="sq ft" className="mt-1" />
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <Label>FSI permitted</Label>
            <Input type="number" inputMode="decimal" step="any" value={p.fsi_permitted} onChange={e => setP({ ...p, fsi_permitted: e.target.value })} placeholder="e.g. 1.5" className="mt-1" />
          </div>
          <div>
            <Label>FSI consumed</Label>
            <Input type="number" inputMode="decimal" step="any" value={p.fsi_consumed}  onChange={e => setP({ ...p, fsi_consumed: e.target.value })}  placeholder="e.g. 1.32" className="mt-1" />
          </div>
          {fsiPct != null && (
            <div className="col-span-2 md:col-span-2 self-end">
              <p className="text-xs text-gray-500 pb-2">FSI utilisation: <span className="font-semibold text-gray-800">{fsiPct}%</span></p>
            </div>
          )}
        </div>
      </section>

      {/* ─── Floor breakdown ──────────────────── */}
      <section className="space-y-3 pt-2 border-t border-gray-100">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wide text-gray-500">Floor Breakdown</h3>
            <p className="text-xs text-gray-400 mt-0.5">Optional. Add one row per floor with its built-up + carpet area.</p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={addFloor}>
            <Plus className="h-4 w-4" /> Add floor
          </Button>
        </div>

        {floors.length === 0 ? (
          <p className="text-sm text-gray-400 italic py-2">No floors added.</p>
        ) : (
          <div className="space-y-2">
            <div className="hidden md:grid md:grid-cols-12 gap-2 text-xs text-gray-500 font-semibold uppercase tracking-wide px-1">
              <div className="md:col-span-5">Floor name</div>
              <div className="md:col-span-3">Built-up (sq ft)</div>
              <div className="md:col-span-3">Carpet (sq ft)</div>
              <div className="md:col-span-1"></div>
            </div>
            {floors.map((f) => (
              <div key={f.tempId} className="grid grid-cols-1 md:grid-cols-12 gap-2 md:items-center border border-gray-100 md:border-0 rounded-xl p-3 md:p-0">
                <div className="md:col-span-5">
                  <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 md:hidden block mb-1">Floor name</label>
                  <Input value={f.name}        onChange={e => updateFloor(f.tempId, { name: e.target.value })}        placeholder="e.g. Ground / 1st Floor" />
                </div>
                <div className="md:col-span-3">
                  <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 md:hidden block mb-1">Built-up (sq ft)</label>
                  <MoneyInput value={f.built_up_sft} onChange={v => updateFloor(f.tempId, { built_up_sft: v })} placeholder="sq ft" />
                </div>
                <div className="md:col-span-3">
                  <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 md:hidden block mb-1">Carpet (sq ft)</label>
                  <MoneyInput value={f.carpet_sft}   onChange={v => updateFloor(f.tempId, { carpet_sft: v })}   placeholder="sq ft" />
                </div>
                <div className="md:col-span-1 flex justify-end">
                  <Button type="button" variant="ghost" size="sm" onClick={() => removeFloor(f.tempId)} className="text-rose-600 hover:text-rose-700 hover:bg-rose-50">
                    <Trash2 className="h-4 w-4" />
                    <span className="md:hidden">Remove floor</span>
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex items-center gap-2 pt-2">
        <Button type="submit" disabled={saving || !p.code || !p.name}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {projectId ? 'Save changes' : 'Create project'}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  )
}
