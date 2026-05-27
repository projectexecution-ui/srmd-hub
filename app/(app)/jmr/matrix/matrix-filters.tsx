'use client'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Bookmark, Save, Trash2, X, Check } from 'lucide-react'

type Option = { id: string; name: string; code: string | null }

interface Props {
  projects: Option[]
  contractors: { id: string; name: string }[]
  subProjects: Option[]
  currentProjectIds: string[]
  currentContractorId: string
  currentCategory: 'equipment' | 'manpower' | 'both'
  currentDateFrom: string
  currentDateTo: string
  currentSubProjectIds: string[]
}

// ─── Saved-views helpers (localStorage) ────────────────────────────────
// Per-user, per-browser. Good enough for "I don't want to re-pick filters
// every time" without adding a DB table.
type SavedView = {
  id: string
  name: string
  query: {
    projects: string[]
    contractor: string
    category: 'equipment' | 'manpower' | 'both'
    from: string
    to: string
    sp: string[]
  }
}
const VIEWS_KEY = 'jmr_matrix_saved_views_v1'
function readViews(): SavedView[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(VIEWS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v: unknown): v is SavedView =>
      !!v && typeof v === 'object' && 'id' in v && 'name' in v && 'query' in v)
  } catch { return [] }
}
function writeViews(views: SavedView[]) {
  try { localStorage.setItem(VIEWS_KEY, JSON.stringify(views)) } catch { /* ignore */ }
}

export function MatrixFilters(p: Props) {
  const router = useRouter()
  const [projectIds, setProjectIds] = useState<Set<string>>(() => new Set(p.currentProjectIds))
  const [contractor, setContractor] = useState(p.currentContractorId)
  const [category, setCategory] = useState(p.currentCategory)
  const [from, setFrom] = useState(p.currentDateFrom)
  const [to, setTo] = useState(p.currentDateTo)
  const [subSet, setSubSet] = useState(() => new Set(p.currentSubProjectIds))

  const [views, setViews] = useState<SavedView[]>([])
  const [showSave, setShowSave] = useState(false)
  const [newName, setNewName] = useState('')
  useEffect(() => { setViews(readViews()) }, [])

  function apply() {
    const u = new URLSearchParams()
    for (const id of projectIds) u.append('project', id)
    if (contractor) u.set('contractor', contractor)
    if (category !== 'both') u.set('cat', category)
    if (from) u.set('from', from)
    if (to) u.set('to', to)
    for (const id of subSet) u.append('sp', id)
    router.push(`/jmr/matrix?${u.toString()}`)
  }

  function toggleProject(id: string) {
    const next = new Set(projectIds)
    if (next.has(id)) next.delete(id); else next.add(id)
    // When project selection changes, drop sub-project picks that no longer
    // belong to any selected parent (avoid stale chips). The sub-projects
    // prop only reflects the server-rendered set; conservative reset on
    // toggle is simplest.
    setProjectIds(next)
    setSubSet(new Set())
  }

  function toggleSub(id: string) {
    const next = new Set(subSet)
    if (next.has(id)) next.delete(id); else next.add(id)
    setSubSet(next)
  }

  function saveCurrent() {
    const name = newName.trim()
    if (!name) return
    const view: SavedView = {
      id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now()),
      name,
      query: {
        projects: Array.from(projectIds),
        contractor,
        category,
        from,
        to,
        sp: Array.from(subSet),
      },
    }
    const next = [...views.filter(v => v.name !== name), view]
    setViews(next); writeViews(next)
    setShowSave(false); setNewName('')
  }

  function loadView(view: SavedView) {
    setProjectIds(new Set(view.query.projects))
    setContractor(view.query.contractor)
    setCategory(view.query.category)
    setFrom(view.query.from)
    setTo(view.query.to)
    setSubSet(new Set(view.query.sp))
    // Navigate immediately so the table reloads with the saved filters.
    const u = new URLSearchParams()
    for (const id of view.query.projects) u.append('project', id)
    if (view.query.contractor) u.set('contractor', view.query.contractor)
    if (view.query.category !== 'both') u.set('cat', view.query.category)
    if (view.query.from) u.set('from', view.query.from)
    if (view.query.to)   u.set('to',   view.query.to)
    for (const id of view.query.sp) u.append('sp', id)
    router.push(`/jmr/matrix?${u.toString()}`)
  }

  function deleteView(id: string) {
    const next = views.filter(v => v.id !== id)
    setViews(next); writeViews(next)
  }

  return (
    <Card className="p-3 mb-2">
      {/* ─── Saved views row ──────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 mb-3 pb-3 border-b border-gray-100">
        <Bookmark className="h-4 w-4 text-gray-400" />
        <span className="text-xs font-semibold text-gray-600 mr-1">Saved views:</span>
        {views.length === 0 ? (
          <span className="text-xs text-gray-400 italic">none saved yet</span>
        ) : (
          views.map(v => (
            <span key={v.id} className="inline-flex items-center gap-1 bg-blue-50 border border-blue-200 rounded-full text-xs">
              <button
                type="button"
                onClick={() => loadView(v)}
                className="pl-2.5 pr-1 py-0.5 text-blue-800 hover:text-blue-900 font-medium"
                title="Load this view"
              >
                {v.name}
              </button>
              <button
                type="button"
                onClick={() => deleteView(v.id)}
                className="pr-1.5 py-0.5 text-blue-400 hover:text-rose-600"
                title="Delete this view"
                aria-label={`Delete view ${v.name}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))
        )}
        <div className="ml-auto">
          {!showSave ? (
            <Button type="button" size="sm" variant="outline" onClick={() => setShowSave(true)}>
              <Save className="h-3.5 w-3.5" /> Save current view
            </Button>
          ) : (
            <span className="inline-flex items-center gap-1">
              <Input
                autoFocus
                placeholder="e.g. NGH all sites, equipment only"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); saveCurrent() }
                  else if (e.key === 'Escape') { setShowSave(false); setNewName('') }
                }}
                className="h-8 text-xs w-56"
              />
              <Button type="button" size="sm" onClick={saveCurrent} disabled={!newName.trim()}>
                <Check className="h-3.5 w-3.5" />
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => { setShowSave(false); setNewName('') }}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </span>
          )}
        </div>
      </div>

      {/* ─── Projects (multi-select) ──────────────────────────────── */}
      <div className="mb-3">
        <Label className="text-xs">
          Projects {projectIds.size > 0 ? `(${projectIds.size} selected)` : '(pick one or more)'}
        </Label>
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {p.projects.map(x => {
            const on = projectIds.has(x.id)
            return (
              <button
                key={x.id}
                type="button"
                onClick={() => toggleProject(x.id)}
                className={`px-2.5 py-1 rounded text-xs border transition-colors ${on ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
              >
                {x.code || x.name}
              </button>
            )
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div>
          <Label className="text-xs">Contractor</Label>
          <select value={contractor} onChange={e => setContractor(e.target.value)} className="mt-1 flex h-9 w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm">
            <option value="">All contractors</option>
            {p.contractors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <Label className="text-xs">Category</Label>
          <select value={category} onChange={e => setCategory(e.target.value as 'equipment' | 'manpower' | 'both')} className="mt-1 flex h-9 w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm">
            <option value="both">Both</option>
            <option value="equipment">Equipment</option>
            <option value="manpower">Manpower</option>
          </select>
        </div>
        <div>
          <Label className="text-xs">From (optional)</Label>
          <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="mt-1 h-9 text-sm" />
        </div>
        <div>
          <Label className="text-xs">Cumulative till</Label>
          <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="mt-1 h-9 text-sm" />
        </div>
      </div>

      {p.subProjects.length > 0 && (
        <div className="mt-3">
          <Label className="text-xs">Sub-projects {subSet.size > 0 ? `(${subSet.size} selected)` : '(all)'}</Label>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {p.subProjects.map(sp => {
              const on = subSet.has(sp.id)
              return (
                <button
                  key={sp.id}
                  type="button"
                  onClick={() => toggleSub(sp.id)}
                  className={`px-2 py-1 rounded text-xs border transition-colors ${on ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
                >
                  {sp.code || sp.name}
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="mt-3">
        <Button size="sm" onClick={apply} disabled={projectIds.size === 0}>Apply filters</Button>
      </div>
    </Card>
  )
}
