'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Plus, Pencil, Archive, Check, X, Loader2, ChevronDown, ChevronRight, ArchiveRestore } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Discipline {
  id: string
  code: string
  name: string
  display_order: number | null
  is_archived: boolean
  usedInProjects: number
}
interface SubSkill {
  id: string
  discipline_id: string
  code: string
  name: string
  default_uom: string | null
  is_archived: boolean
  usedInProjects: number
}

export function DisciplinesAdmin({
  disciplines: initialDisciplines,
  subSkills: initialSubSkills,
}: {
  disciplines: Discipline[]
  subSkills: SubSkill[]
}) {
  const router = useRouter()
  const [disciplines, setDisciplines] = useState(initialDisciplines)
  const [subSkills, setSubSkills]     = useState(initialSubSkills)
  const [open, setOpen]               = useState<Set<string>>(new Set())
  const [editing, setEditing]         = useState<string | null>(null) // disciplineId being edited
  const [addingDiscipline, setAddingDiscipline] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [busy, setBusy]               = useState(false)
  const [error, setError]             = useState<string | null>(null)

  function toggleOpen(id: string) {
    setOpen(o => {
      const next = new Set(o)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const visibleDisciplines = disciplines.filter(d => showArchived || !d.is_archived)

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</p>}

      <div className="flex items-center justify-between gap-2">
        <label className="inline-flex items-center gap-1.5 text-xs text-gray-600">
          <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />
          Show archived
        </label>
        <Button size="sm" onClick={() => setAddingDiscipline(true)}>
          <Plus className="h-4 w-4" /> New discipline
        </Button>
      </div>

      {addingDiscipline && (
        <DisciplineForm
          onCancel={() => setAddingDiscipline(false)}
          onSaved={d => {
            setDisciplines(rs => [...rs, { ...d, usedInProjects: 0 }].sort((a, b) => (a.display_order ?? 999) - (b.display_order ?? 999)))
            setAddingDiscipline(false)
            router.refresh()
          }}
          existing={disciplines}
          setBusy={setBusy} setError={setError} busy={busy}
        />
      )}

      {visibleDisciplines.length === 0 ? (
        <p className="text-sm text-gray-500 italic">No disciplines yet. Add the first one.</p>
      ) : (
        visibleDisciplines.map(d => {
          const isOpen = open.has(d.id)
          const subs = subSkills.filter(s => s.discipline_id === d.id && (showArchived || !s.is_archived))
          if (editing === d.id) {
            return (
              <DisciplineForm
                key={d.id}
                initial={d}
                onCancel={() => setEditing(null)}
                onSaved={u => {
                  setDisciplines(ds => ds.map(x => x.id === u.id ? { ...x, ...u } : x).sort((a, b) => (a.display_order ?? 999) - (b.display_order ?? 999)))
                  setEditing(null)
                  router.refresh()
                }}
                existing={disciplines}
                setBusy={setBusy} setError={setError} busy={busy}
              />
            )
          }
          return (
            <Card key={d.id} className={cn('p-0 overflow-hidden', d.is_archived && 'opacity-60')}>
              <div className="flex items-center gap-2 p-3">
                <button onClick={() => toggleOpen(d.id)} className="text-gray-400 hover:text-gray-700">
                  {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
                <span className="font-mono text-xs text-gray-500 w-8">{d.code}</span>
                <span className="font-semibold text-gray-900 flex-1 truncate">{d.name}</span>
                <span className="text-[11px] text-gray-500 hidden md:inline">
                  {d.usedInProjects > 0 ? `${d.usedInProjects} project${d.usedInProjects === 1 ? '' : 's'}` : 'unused'}
                </span>
                {d.is_archived && <Badge variant="secondary">archived</Badge>}
                <span className="text-[11px] text-gray-400 hidden md:inline">order {d.display_order ?? '—'}</span>
                <Button size="sm" variant="ghost" onClick={() => setEditing(d.id)} title="Edit">
                  <Pencil className="h-4 w-4" />
                </Button>
                <ArchiveButton
                  isArchived={d.is_archived}
                  busy={busy}
                  onClick={async () => {
                    setBusy(true); setError(null)
                    const { error } = await createClient()
                      .from('cc_disciplines')
                      .update({ is_archived: !d.is_archived })
                      .eq('id', d.id)
                    setBusy(false)
                    if (error) { setError(error.message); return }
                    setDisciplines(ds => ds.map(x => x.id === d.id ? { ...x, is_archived: !x.is_archived } : x))
                    router.refresh()
                  }}
                />
              </div>

              {isOpen && (
                <div className="border-t border-gray-100 bg-gray-50/40 px-3 py-3 space-y-2">
                  {subs.length === 0 ? (
                    <p className="text-xs text-gray-500 italic">No sub-skills yet.</p>
                  ) : (
                    <ul className="space-y-1">
                      {subs.map(s => (
                        <SubSkillRow
                          key={s.id}
                          sub={s}
                          existing={subSkills.filter(x => x.discipline_id === d.id)}
                          onUpdated={u => setSubSkills(ss => ss.map(x => x.id === u.id ? { ...x, ...u } : x))}
                          setBusy={setBusy} setError={setError} busy={busy}
                        />
                      ))}
                    </ul>
                  )}
                  <SubSkillForm
                    disciplineId={d.id}
                    existing={subSkills.filter(x => x.discipline_id === d.id)}
                    onAdded={s => { setSubSkills(ss => [...ss, { ...s, usedInProjects: 0 }]); router.refresh() }}
                    setBusy={setBusy} setError={setError} busy={busy}
                  />
                </div>
              )}
            </Card>
          )
        })
      )}
    </div>
  )
}

function ArchiveButton({ isArchived, onClick, busy }: { isArchived: boolean; onClick: () => void; busy: boolean }) {
  return (
    <Button size="sm" variant="ghost" onClick={onClick} disabled={busy}
      title={isArchived ? 'Unarchive' : 'Archive'}
      className={isArchived ? 'text-emerald-700 hover:bg-emerald-50' : 'text-amber-700 hover:bg-amber-50'}>
      {isArchived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
    </Button>
  )
}

function DisciplineForm({
  initial, onCancel, onSaved, existing, setBusy, setError, busy,
}: {
  initial?: Discipline
  onCancel: () => void
  onSaved: (d: Discipline) => void
  existing: Discipline[]
  setBusy: (b: boolean) => void
  setError: (s: string | null) => void
  busy: boolean
}) {
  const [code, setCode]                 = useState(initial?.code ?? '')
  const [name, setName]                 = useState(initial?.name ?? '')
  const [displayOrder, setDisplayOrder] = useState<string>(initial?.display_order != null ? String(initial.display_order) : '')

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!code.trim() || !name.trim()) { setError('Code and name are required'); return }
    // Client-side dup check on code (case-sensitive — match DB unique)
    const dup = existing.find(d => d.code === code.trim() && d.id !== initial?.id)
    if (dup) { setError(`Code "${code.trim()}" is already used by "${dup.name}"`); return }

    setBusy(true); setError(null)
    const supabase = createClient()
    // display_order is NOT NULL (defaults to 0). Blank must become 0, never null —
    // an explicit null is rejected by the constraint and the add silently fails.
    const parsedOrder = displayOrder.trim() === '' ? 0 : Number(displayOrder)
    const payload = {
      code: code.trim(),
      name: name.trim(),
      display_order: Number.isFinite(parsedOrder) ? parsedOrder : 0,
    }
    const res = initial
      ? await supabase.from('cc_disciplines').update(payload).eq('id', initial.id).select('id, code, name, display_order, is_archived').single()
      : await supabase.from('cc_disciplines').insert(payload).select('id, code, name, display_order, is_archived').single()
    setBusy(false)
    if (res.error || !res.data) { setError(res.error?.message ?? 'Save failed'); return }
    onSaved({ ...(res.data as Discipline), usedInProjects: initial?.usedInProjects ?? 0 })
  }

  return (
    <form onSubmit={save} className="p-3 border-2 border-dashed border-blue-300 rounded-lg bg-blue-50/40 space-y-2">
      <div className="grid grid-cols-12 gap-2">
        <div className="col-span-2">
          <Input value={code} onChange={e => setCode(e.target.value)} placeholder="Code" className="font-mono text-sm" />
        </div>
        <div className="col-span-7">
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="Discipline name" />
        </div>
        <div className="col-span-2">
          <Input type="number" value={displayOrder} onChange={e => setDisplayOrder(e.target.value)} placeholder="Order" />
        </div>
        <div className="col-span-1 flex justify-end gap-1">
          <Button type="submit" size="sm" disabled={busy} title="Save">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onCancel} title="Cancel">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </form>
  )
}

function SubSkillRow({
  sub, existing, onUpdated, setBusy, setError, busy,
}: {
  sub: SubSkill
  existing: SubSkill[]
  onUpdated: (s: SubSkill) => void
  setBusy: (b: boolean) => void
  setError: (s: string | null) => void
  busy: boolean
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [code, setCode]   = useState(sub.code)
  const [name, setName]   = useState(sub.name)
  const [uom, setUom]     = useState(sub.default_uom ?? '')

  if (editing) {
    return (
      <li className="grid grid-cols-12 gap-2 items-center bg-blue-50/50 p-2 rounded">
        <div className="col-span-2"><Input value={code} onChange={e => setCode(e.target.value)} className="font-mono text-xs" /></div>
        <div className="col-span-6"><Input value={name} onChange={e => setName(e.target.value)} /></div>
        <div className="col-span-2"><Input value={uom} onChange={e => setUom(e.target.value)} placeholder="UoM" /></div>
        <div className="col-span-2 flex gap-1 justify-end">
          <Button size="sm" disabled={busy} onClick={async () => {
            if (!code.trim() || !name.trim()) { setError('Code + name required'); return }
            const dup = existing.find(s => s.code === code.trim() && s.id !== sub.id)
            if (dup) { setError(`Code "${code.trim()}" already used`); return }
            setBusy(true); setError(null)
            const { data, error } = await createClient()
              .from('cc_sub_skills')
              .update({ code: code.trim(), name: name.trim(), default_uom: uom.trim() || null })
              .eq('id', sub.id)
              .select('id, discipline_id, code, name, default_uom, is_archived')
              .single()
            setBusy(false)
            if (error || !data) { setError(error?.message ?? 'Save failed'); return }
            onUpdated({ ...(data as SubSkill), usedInProjects: sub.usedInProjects })
            setEditing(false)
            router.refresh()
          }}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setCode(sub.code); setName(sub.name); setUom(sub.default_uom ?? '') }}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </li>
    )
  }

  return (
    <li className={cn('grid grid-cols-12 gap-2 items-center text-sm p-2 rounded hover:bg-white', sub.is_archived && 'opacity-60')}>
      <span className="col-span-2 font-mono text-xs text-gray-500">{sub.code}</span>
      <span className="col-span-6 text-gray-800 truncate">{sub.name}</span>
      <span className="col-span-1 text-xs text-gray-500">{sub.default_uom ?? ''}</span>
      <span className="col-span-1 text-[11px] text-gray-400">{sub.usedInProjects > 0 ? `${sub.usedInProjects}p` : ''}</span>
      <div className="col-span-2 flex gap-1 justify-end">
        <Button size="sm" variant="ghost" onClick={() => setEditing(true)} title="Edit">
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button size="sm" variant="ghost" disabled={busy}
          className={sub.is_archived ? 'text-emerald-700' : 'text-amber-700'}
          title={sub.is_archived ? 'Unarchive' : 'Archive'}
          onClick={async () => {
            setBusy(true); setError(null)
            const { error } = await createClient()
              .from('cc_sub_skills')
              .update({ is_archived: !sub.is_archived })
              .eq('id', sub.id)
            setBusy(false)
            if (error) { setError(error.message); return }
            onUpdated({ ...sub, is_archived: !sub.is_archived })
            router.refresh()
          }}>
          {sub.is_archived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </li>
  )
}

function SubSkillForm({
  disciplineId, existing, onAdded, setBusy, setError, busy,
}: {
  disciplineId: string
  existing: SubSkill[]
  onAdded: (s: SubSkill) => void
  setBusy: (b: boolean) => void
  setError: (s: string | null) => void
  busy: boolean
}) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [uom, setUom]   = useState('')

  async function add() {
    if (!code.trim() || !name.trim()) { setError('Code + name required'); return }
    const dup = existing.find(s => s.code === code.trim())
    if (dup) { setError(`Code "${code.trim()}" already used in this discipline`); return }
    setBusy(true); setError(null)
    const { data, error } = await createClient()
      .from('cc_sub_skills')
      .insert({ discipline_id: disciplineId, code: code.trim(), name: name.trim(), default_uom: uom.trim() || null })
      .select('id, discipline_id, code, name, default_uom, is_archived')
      .single()
    setBusy(false)
    if (error || !data) { setError(error?.message ?? 'Add failed'); return }
    onAdded(data as SubSkill)
    setCode(''); setName(''); setUom('')
  }

  return (
    <div className="grid grid-cols-12 gap-2 items-center pt-2 border-t border-gray-200">
      <div className="col-span-2"><Input value={code} onChange={e => setCode(e.target.value)} placeholder="Code" className="font-mono text-xs" /></div>
      <div className="col-span-6"><Input value={name} onChange={e => setName(e.target.value)} placeholder="Sub-skill name" /></div>
      <div className="col-span-2"><Input value={uom} onChange={e => setUom(e.target.value)} placeholder="UoM" /></div>
      <div className="col-span-2 flex justify-end">
        <Button size="sm" onClick={add} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add
        </Button>
      </div>
    </div>
  )
}
