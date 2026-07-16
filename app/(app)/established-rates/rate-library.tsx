'use client'
// Flat, spreadsheet-style rate library. One row per rate-item.
//   ▸ Search box + Discipline chip strip (counts inline)
//   ▸ Sortable table: Item · UoM · L1 rate · Vendor · # quotes · # WOs · Updated
//   ▸ Click row → inline expand showing all rates (ranked L1/L2/Ln) + Past WOs
// Designed for the volume that an IN4 Abstract Report dumps in (600-1000 items).

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  ChevronDown, ChevronRight, Plus, Trash2, Loader2, Search, Filter,
  ArrowUpDown, ArrowUp, ArrowDown,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { confirm } from '@/components/ui/confirm-dialog'
import { recycleDelete } from '@/lib/recycle-bin'
import { AddRateModal } from './add-rate-modal'

interface Discipline   { id: string; code: string | null; name: string; display_order: number }
interface Category     { id: string; discipline_id: string; code: string | null; name: string; display_order: number }
interface Subcategory  { id: string; category_id: string; name: string; short_name: string | null; uom: string }
interface Rate {
  id: string
  subcategory_id: string
  source_type: 'vendor' | 'contractor'
  vendor_id: string | null
  contractor_id: string | null
  rate_per_unit: number
  gst_pct: number | null
  valid_from: string | null
  valid_till: string | null
  source: string
  source_ref: string | null
  project_id: string | null
  updated_at: string | null
}
interface Project { id: string; code: string | null; name: string; parent_project_id: string | null }
interface WoHistory {
  id: string
  wo_number: string
  contractor_name: string
  work_description: string | null
  subcategory_id: string | null
  project_id: string | null
  from_date: string | null
  to_date: string | null
  status: string | null
  base_value: number | null
}
interface Opt { id: string; name: string }

interface Props {
  disciplines: Discipline[]
  categories: Category[]
  subcategories: Subcategory[]
  rates: Rate[]
  woHistory: WoHistory[]
  vendors: Opt[]
  contractors: Opt[]
  projects: Project[]
  canEdit: boolean
}

type SortKey = 'item' | 'latest' | 'updated' | 'wos'
type SortDir = 'asc' | 'desc'

function fmtINR(n: number | null | undefined): string {
  if (n == null) return '—'
  return '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })
}

// Display short_name when present, else trim the long IN4 description.
function displayShort(sub: { name: string; short_name: string | null }): string {
  if (sub.short_name && sub.short_name.trim()) return sub.short_name
  const s = sub.name.trim()
  return s.length > 60 ? s.slice(0, 57).trimEnd() + '…' : s
}

// Tag the latest rate as the reference for new orders; older quotes go unlabelled.
function rankBadge(idx: number, total: number): { label: string; classes: string } | null {
  if (total === 0) return null
  if (idx === 0) return { label: 'Latest', classes: 'bg-emerald-100 text-emerald-800 border-emerald-200' }
  return null
}

export function RateLibrary({
  disciplines, categories, subcategories, rates, woHistory, vendors, contractors, projects, canEdit,
}: Props) {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [activeDisc, setActiveDisc] = useState<string>('all')
  const [activeProject, setActiveProject] = useState<string>('all')
  const [vendorFilter, setVendorFilter] = useState<string>('')
  const [activeOnly, setActiveOnly] = useState(true)
  const [showEmpty, setShowEmpty] = useState(false)
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'item', dir: 'asc' })
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [addingForSub, setAddingForSub] = useState<Subcategory | null>(null)
  const [busyRate, setBusyRate] = useState<string | null>(null)

  // ── Lookup maps ──────────────────────────────────────────────
  const vendorById     = useMemo(() => new Map(vendors.map(v => [v.id, v])),     [vendors])
  const contractorById = useMemo(() => new Map(contractors.map(c => [c.id, c])), [contractors])
  const catById        = useMemo(() => new Map(categories.map(c => [c.id, c])),  [categories])
  const discById       = useMemo(() => new Map(disciplines.map(d => [d.id, d])), [disciplines])
  const projectById    = useMemo(() => new Map(projects.map(p => [p.id, p])),    [projects])
  // Only show top-level projects (parents) in the chip strip; sub-projects roll up to their parent.
  // Parent id for a row → use parent_project_id if set, else self id.
  function rootProjectId(pid: string | null | undefined): string | null {
    if (!pid) return null
    const p = projectById.get(pid)
    if (!p) return null
    return p.parent_project_id ?? p.id
  }
  const parentProjects = useMemo(() => projects.filter(p => !p.parent_project_id), [projects])

  // ── Filtered rates (active-only + vendor filter applied) ─────
  const filteredRates = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    return rates.filter(r => {
      if (activeOnly && r.valid_till && r.valid_till < today) return false
      if (vendorFilter) {
        if (r.vendor_id !== vendorFilter && r.contractor_id !== vendorFilter) return false
      }
      if (activeProject !== 'all') {
        if (rootProjectId(r.project_id) !== activeProject) return false
      }
      return true
    })
  }, [rates, activeOnly, vendorFilter, activeProject, projectById])

  const ratesBySub = useMemo(() => {
    const m = new Map<string, Rate[]>()
    for (const r of filteredRates) {
      if (!m.has(r.subcategory_id)) m.set(r.subcategory_id, [])
      m.get(r.subcategory_id)!.push(r)
    }
    // Sort latest first (valid_from desc), tie-break by lower rate, then by id.
    // The first element is the "current going rate" for that sub-category.
    for (const arr of m.values()) arr.sort((a, b) => {
      const af = a.valid_from ?? ''
      const bf = b.valid_from ?? ''
      if (af !== bf) return bf.localeCompare(af)
      if (a.rate_per_unit !== b.rate_per_unit) return a.rate_per_unit - b.rate_per_unit
      return a.id.localeCompare(b.id)
    })
    return m
  }, [filteredRates])

  const woBySub = useMemo(() => {
    const m = new Map<string, WoHistory[]>()
    for (const w of woHistory) {
      if (!w.subcategory_id) continue
      if (!m.has(w.subcategory_id)) m.set(w.subcategory_id, [])
      m.get(w.subcategory_id)!.push(w)
    }
    return m
  }, [woHistory])

  // ── Per-discipline counts for the chip strip ─────────────────
  const discCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of subcategories) {
      const cat = catById.get(s.category_id)
      if (!cat) continue
      const d = cat.discipline_id
      m.set(d, (m.get(d) ?? 0) + 1)
    }
    return m
  }, [subcategories, catById])

  // Per-project rate counts (rolled up to parent project) for the project chip strip
  const projectRateCounts = useMemo(() => {
    const m = new Map<string, number>()
    let untagged = 0
    for (const r of rates) {
      const root = rootProjectId(r.project_id)
      if (!root) { untagged++; continue }
      m.set(root, (m.get(root) ?? 0) + 1)
    }
    return { byProject: m, untagged }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rates, projectById])

  // ── Compose rows ─────────────────────────────────────────────
  interface Row {
    sub: Subcategory
    catName: string
    catCode: string | null
    discId: string
    discName: string
    discCode: string | null
    rates: Rate[]
    wos: WoHistory[]
    latest?: Rate        // most-recent rate (first element of sorted rates)
    latestPartyName: string
    latestUpdated: string | null
  }

  const rows: Row[] = useMemo(() => {
    const out: Row[] = []
    for (const sub of subcategories) {
      const cat = catById.get(sub.category_id)
      if (!cat) continue
      const disc = discById.get(cat.discipline_id)
      if (!disc) continue
      if (activeDisc !== 'all' && activeDisc !== disc.id) continue
      const rs = ratesBySub.get(sub.id) ?? []
      const wos = woBySub.get(sub.id) ?? []
      // Vendor filter: also drop sub-cats with zero matching rates
      if (vendorFilter && rs.length === 0) continue
      // Default: hide items with no rates AND no WOs — they're noise.
      if (!showEmpty && rs.length === 0 && wos.length === 0) continue
      // First element is the latest rate (rates already sorted valid_from desc).
      const latest = rs[0]
      const latestPartyName = latest
        ? (latest.source_type === 'vendor'
            ? (vendorById.get(latest.vendor_id ?? '')?.name ?? '—')
            : (contractorById.get(latest.contractor_id ?? '')?.name ?? '—'))
        : ''
      const latestUpdated = rs.reduce<string | null>((acc, r) => {
        if (!r.updated_at) return acc
        if (!acc || r.updated_at > acc) return r.updated_at
        return acc
      }, null)
      out.push({
        sub, catName: cat.name, catCode: cat.code,
        discId: disc.id, discName: disc.name, discCode: disc.code,
        rates: rs, wos, latest, latestPartyName, latestUpdated,
      })
    }
    return out
  }, [subcategories, catById, discById, activeDisc, ratesBySub, woBySub, vendorFilter, vendorById, contractorById, showEmpty])

  // ── Search filter ────────────────────────────────────────────
  const searched = useMemo(() => {
    if (!q.trim()) return rows
    const lc = q.toLowerCase()
    return rows.filter(r =>
      r.sub.name.toLowerCase().includes(lc) ||
      (r.sub.short_name ?? '').toLowerCase().includes(lc) ||
      r.catName.toLowerCase().includes(lc) ||
      r.discName.toLowerCase().includes(lc) ||
      r.latestPartyName.toLowerCase().includes(lc),
    )
  }, [rows, q])

  // ── Sort ─────────────────────────────────────────────────────
  const sorted = useMemo(() => {
    const arr = [...searched]
    const mul = sort.dir === 'asc' ? 1 : -1
    arr.sort((a, b) => {
      switch (sort.key) {
        case 'item':    return mul * a.sub.name.localeCompare(b.sub.name)
        case 'latest':  return mul * ((a.latest?.rate_per_unit ?? Infinity) - (b.latest?.rate_per_unit ?? Infinity))
        case 'updated': return mul * String(a.latestUpdated ?? '').localeCompare(String(b.latestUpdated ?? ''))
        case 'wos':     return mul * (a.wos.length - b.wos.length)
      }
    })
    return arr
  }, [searched, sort])

  function toggleSort(key: SortKey) {
    setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' })
  }

  function toggleExpand(id: string) {
    setExpanded(s => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function deleteRate(id: string) {
    if (!(await confirm({ title: 'Delete this rate?', message: 'It moves to the Recycle Bin — an admin can restore it anytime from Admin › Recycle Bin.', confirmLabel: 'Delete' }))) return
    setBusyRate(id)
    const rate = rates.find(r => r.id === id)
    const sub = rate ? subcategories.find(s => s.id === rate.subcategory_id) : null
    const party = rate
      ? (rate.vendor_id ? vendors.find(v => v.id === rate.vendor_id)?.name
        : contractors.find(c => c.id === rate.contractor_id)?.name)
      : null
    const label = sub ? (sub.short_name || sub.name) : 'Rate'
    const context = [party, rate ? `₹${rate.rate_per_unit}/${sub?.uom ?? ''}` : null].filter(Boolean).join(' · ')
    const err = await recycleDelete(createClient(), {
      sourceTable: 'est_rates', entityId: id, entityType: 'Established rate',
      label, context: context || undefined, moduleSlug: 'established-rates',
    })
    setBusyRate(null)
    if (err) { toast.error(err); return }
    toast.success('Rate moved to Recycle Bin')
    router.refresh()
  }

  const totalShown = sorted.length
  const allParties = useMemo(() => {
    const out: Array<{ id: string; label: string }> = []
    for (const v of vendors)     out.push({ id: v.id, label: v.name })
    for (const c of contractors) out.push({ id: c.id, label: c.name + ' (contractor)' })
    return out.sort((a, b) => a.label.localeCompare(b.label))
  }, [vendors, contractors])

  return (
    <div className="space-y-3">
      {/* ── Filter strip ────────────────────────────────────── */}
      <Card>
        <CardContent className="pt-4 pb-3 space-y-3">
          <div className="flex flex-col md:flex-row gap-2 md:items-center">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Search item, category, vendor…"
                className="pl-8"
              />
            </div>
            <div className="flex items-center gap-2 md:ml-auto">
              <Filter className="h-4 w-4 text-gray-400" />
              <select
                value={vendorFilter}
                onChange={e => setVendorFilter(e.target.value)}
                className="h-10 rounded-xl border border-gray-300 bg-white px-3 text-sm"
              >
                <option value="">All vendors / contractors</option>
                {allParties.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
              <label className="inline-flex items-center gap-1.5 text-sm text-gray-700 whitespace-nowrap">
                <input type="checkbox" checked={activeOnly} onChange={e => setActiveOnly(e.target.checked)} />
                Active only
              </label>
              <label className="inline-flex items-center gap-1.5 text-sm text-gray-700 whitespace-nowrap" title="Items without any rates or WOs">
                <input type="checkbox" checked={showEmpty} onChange={e => setShowEmpty(e.target.checked)} />
                Show empty
              </label>
            </div>
          </div>

          {/* Project chip strip — only shown if there are projects worth filtering by */}
          {parentProjects.length > 0 && (
            <div className="overflow-x-auto -mx-1 px-1">
              <div className="flex items-center gap-1.5 min-w-min">
                <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400 whitespace-nowrap pr-1">Project</span>
                <Chip label="All projects" count={rates.length} active={activeProject === 'all'} onClick={() => setActiveProject('all')} />
                {parentProjects.map(p => (
                  <Chip
                    key={p.id}
                    label={(p.code ? `${p.code} ` : '') + p.name}
                    count={projectRateCounts.byProject.get(p.id) ?? 0}
                    active={activeProject === p.id}
                    onClick={() => setActiveProject(p.id)}
                  />
                ))}
                {projectRateCounts.untagged > 0 && (
                  <span className="text-[11px] text-gray-400 whitespace-nowrap pl-1">
                    · {projectRateCounts.untagged} rate{projectRateCounts.untagged === 1 ? '' : 's'} not yet linked to any project
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Discipline chip strip */}
          <div className="overflow-x-auto -mx-1 px-1">
            <div className="flex items-center gap-1.5 min-w-min">
              <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400 whitespace-nowrap pr-1">Discipline</span>
              <Chip label="All" count={subcategories.length} active={activeDisc === 'all'} onClick={() => setActiveDisc('all')} />
              {disciplines.map(d => (
                <Chip
                  key={d.id}
                  label={(d.code ? `${d.code} ` : '') + d.name}
                  count={discCounts.get(d.id) ?? 0}
                  active={activeDisc === d.id}
                  onClick={() => setActiveDisc(d.id)}
                />
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Table ──────────────────────────────────────────── */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 sticky top-0 z-10">
                <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500">
                  <th className="px-2 py-2 w-6"></th>
                  <SortableTh label="Item" k="item" sort={sort} onSort={toggleSort} className="min-w-[16rem]" />
                  <th className="px-2 py-2 w-16">UoM</th>
                  <SortableTh label="Latest rate" k="latest" sort={sort} onSort={toggleSort} className="text-right w-32" />
                  <th className="px-2 py-2 w-44">From vendor</th>
                  <th className="px-2 py-2 text-center w-20">Quotes</th>
                  <SortableTh label="WOs" k="wos" sort={sort} onSort={toggleSort} className="text-center w-16" />
                  <SortableTh label="Updated" k="updated" sort={sort} onSort={toggleSort} className="w-28 hidden md:table-cell" />
                  <th className="px-2 py-2 w-12 text-right">{canEdit ? 'Add' : ''}</th>
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-sm text-gray-400 italic">No items match the current filters.</td></tr>
                ) : sorted.map(row => {
                  const isOpen = expanded.has(row.sub.id)
                  return (
                    <ItemRow
                      key={row.sub.id}
                      row={row}
                      isOpen={isOpen}
                      onToggle={() => toggleExpand(row.sub.id)}
                      vendorById={vendorById}
                      contractorById={contractorById}
                      projectById={projectById}
                      canEdit={canEdit}
                      onAdd={() => setAddingForSub(row.sub)}
                      onDeleteRate={deleteRate}
                      busyRate={busyRate}
                    />
                  )
                })}
              </tbody>
            </table>
          </div>
          {sorted.length > 0 && (
            <div className="px-3 py-2 text-[11px] text-gray-500 border-t border-gray-100">
              Showing <b>{totalShown}</b> item{totalShown === 1 ? '' : 's'}
              {activeDisc !== 'all' && discById.get(activeDisc) && (
                <> in <b>{discById.get(activeDisc)!.name}</b></>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {addingForSub && (
        <AddRateModal
          subcategory={addingForSub}
          vendors={vendors}
          contractors={contractors}
          onClose={() => setAddingForSub(null)}
          onSaved={() => { setAddingForSub(null); router.refresh() }}
        />
      )}
    </div>
  )
}

function Chip({ label, count, active, onClick }: {
  label: string; count: number; active: boolean; onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-semibold whitespace-nowrap transition-colors',
        active
          ? 'bg-blue-600 text-white'
          : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50',
      )}
    >
      <span>{label}</span>
      <span className={cn('text-[10px] font-bold rounded-full px-1.5 py-0.5', active ? 'bg-blue-700' : 'bg-gray-100 text-gray-500')}>{count}</span>
    </button>
  )
}

function SortableTh({ label, k, sort, onSort, className }: {
  label: string; k: SortKey; sort: { key: SortKey; dir: 'asc' | 'desc' }; onSort: (k: SortKey) => void; className?: string
}) {
  const active = sort.key === k
  return (
    <th className={cn('px-2 py-2', className)}>
      <button type="button" onClick={() => onSort(k)} className="inline-flex items-center gap-1 hover:text-gray-700">
        {label}
        {active
          ? (sort.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)
          : <ArrowUpDown className="h-3 w-3 text-gray-300" />}
      </button>
    </th>
  )
}

function ItemRow({
  row, isOpen, onToggle, vendorById, contractorById, projectById, canEdit, onAdd, onDeleteRate, busyRate,
}: {
  row: {
    sub: Subcategory; catName: string; catCode: string | null;
    discName: string; discCode: string | null;
    rates: Rate[]; wos: WoHistory[]; latest?: Rate; latestPartyName: string; latestUpdated: string | null;
  }
  isOpen: boolean
  onToggle: () => void
  vendorById: Map<string, Opt>
  contractorById: Map<string, Opt>
  projectById: Map<string, Project>
  canEdit: boolean
  onAdd: () => void
  onDeleteRate: (id: string) => void
  busyRate: string | null
}) {
  const { sub, catName, catCode, discName, discCode, rates, wos, latest, latestPartyName, latestUpdated } = row
  const others = Math.max(0, rates.length - 1)

  return (
    <>
      <tr
        className={cn('border-t border-gray-100 hover:bg-gray-50 cursor-pointer', isOpen && 'bg-blue-50/40')}
        onClick={onToggle}
      >
        <td className="px-2 py-2 align-top">
          {isOpen ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
        </td>
        <td className="px-2 py-2 align-top">
          <p
            className="text-sm text-gray-900 font-medium line-clamp-1"
            title={sub.name !== displayShort(sub) ? sub.name : undefined}
          >
            {displayShort(sub)}
          </p>
          <p className="text-[11px] text-gray-500 mt-0.5">
            {discCode && <span className="font-mono">{discCode}</span>} {discName}
            <span className="text-gray-300 mx-1">›</span>
            {catCode && <span className="font-mono">{catCode}</span>} {catName}
          </p>
        </td>
        <td className="px-2 py-2 align-top text-xs text-gray-600">{sub.uom}</td>
        <td className="px-2 py-2 align-top text-right">
          {latest ? (
            <>
              <p className="tabular-nums font-semibold text-gray-900">{fmtINR(latest.rate_per_unit)}</p>
              {latest.valid_from && (
                <p className="text-[10px] text-gray-400 leading-tight">
                  {new Date(latest.valid_from).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })}
                </p>
              )}
            </>
          ) : (
            <span className="text-gray-300">—</span>
          )}
        </td>
        <td className="px-2 py-2 align-top text-sm text-gray-700 truncate max-w-[12rem]" title={latestPartyName}>
          {latestPartyName || <span className="text-gray-300">no quotes</span>}
        </td>
        <td className="px-2 py-2 align-top text-center">
          {rates.length === 0 ? (
            <span className="text-gray-300 text-xs">—</span>
          ) : others > 0 ? (
            <Badge variant="secondary" className="text-[10px]">{rates.length}</Badge>
          ) : (
            <Badge className="bg-emerald-100 text-emerald-800 text-[10px]">1</Badge>
          )}
        </td>
        <td className="px-2 py-2 align-top text-center">
          {wos.length > 0 ? (
            <Badge variant="default" className="text-[10px]">{wos.length}</Badge>
          ) : <span className="text-gray-300 text-xs">—</span>}
        </td>
        <td className="px-2 py-2 align-top text-[11px] text-gray-500 hidden md:table-cell">
          {latestUpdated ? new Date(latestUpdated).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'}
        </td>
        <td className="px-2 py-2 align-top text-right">
          {canEdit && (
            <Button
              size="sm"
              variant="ghost"
              onClick={(e) => { e.stopPropagation(); onAdd() }}
              className="h-7 w-7 p-0"
              title="Add rate"
            >
              <Plus className="h-4 w-4" />
            </Button>
          )}
        </td>
      </tr>

      {isOpen && (
        <tr className="bg-blue-50/30 border-t border-blue-100">
          <td></td>
          <td colSpan={8} className="px-3 py-3 space-y-3">
            {/* All rates ranked */}
            {rates.length === 0 ? (
              <p className="text-sm text-gray-500 italic">
                No rates yet for this item. {canEdit && <button onClick={onAdd} className="text-blue-600 hover:underline">Add the first one</button>}
              </p>
            ) : (
              <div>
                <p className="text-[11px] uppercase tracking-wide font-semibold text-gray-500 mb-1.5">
                  Rates ({rates.length})
                </p>
                <div className="space-y-1">
                  {rates.map((r, idx) => {
                    const party = r.source_type === 'vendor'
                      ? vendorById.get(r.vendor_id ?? '')?.name
                      : contractorById.get(r.contractor_id ?? '')?.name
                    const badge = rankBadge(idx, rates.length)
                    const proj = r.project_id ? projectById.get(r.project_id) : null
                    return (
                      <div key={r.id} className="flex items-center gap-2 text-sm bg-white border border-gray-100 rounded-md px-2 py-1.5">
                        {badge ? (
                          <Badge className={cn('text-[10px] border', badge.classes)}>{badge.label}</Badge>
                        ) : (
                          <span className="w-[68px]" />
                        )}
                        <span className="text-gray-700 flex-1 truncate" title={party}>{party || '—'}</span>
                        {proj && (
                          <Badge variant="secondary" className="text-[10px]" title={proj.name}>
                            {proj.code || proj.name}
                          </Badge>
                        )}
                        <span className="font-semibold text-gray-900 tabular-nums">{fmtINR(r.rate_per_unit)}</span>
                        {r.gst_pct != null && <span className="text-[11px] text-gray-500">+{r.gst_pct}%</span>}
                        <span className="text-[11px] text-gray-400 hidden md:inline">
                          {r.valid_from}{r.valid_till ? ` → ${r.valid_till}` : ' → open'}
                        </span>
                        {r.source !== 'manual' && (
                          <span className="text-[10px] text-gray-400 italic">{r.source}</span>
                        )}
                        {canEdit && (
                          <Button
                            type="button" size="sm" variant="ghost"
                            onClick={(e) => { e.stopPropagation(); onDeleteRate(r.id) }}
                            disabled={busyRate === r.id}
                            className="text-rose-600 hover:bg-rose-50 h-7 w-7 p-0"
                          >
                            {busyRate === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                          </Button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Past WOs */}
            {wos.length > 0 && (
              <div>
                <p className="text-[11px] uppercase tracking-wide font-semibold text-gray-500 mb-1.5">
                  Past WOs ({wos.length})
                </p>
                <div className="space-y-1">
                  {wos.map(w => {
                    const proj = w.project_id ? projectById.get(w.project_id) : null
                    return (
                      <div key={w.id} className="text-[11px] text-gray-600 flex flex-wrap items-center gap-2 bg-white border border-gray-100 rounded-md px-2 py-1.5">
                        <span className="font-mono text-blue-600">{w.wo_number}</span>
                        <span className="text-gray-800">{w.contractor_name}</span>
                        {proj && (
                          <Badge variant="secondary" className="text-[10px]" title={proj.name}>
                            {proj.code || proj.name}
                          </Badge>
                        )}
                        {w.base_value != null && w.base_value > 0 && <span className="font-semibold">{fmtINR(w.base_value)}</span>}
                        <span className="text-gray-400">{w.from_date} → {w.to_date}</span>
                        {w.status && <Badge className="text-[10px]" variant="secondary">{w.status}</Badge>}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}
