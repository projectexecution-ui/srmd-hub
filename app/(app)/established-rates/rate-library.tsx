'use client'
// Library view — 3-level accordion (Discipline → Category → Sub-category rows)
// with multi-source unit rates per item (L1 / L2 / Ln highlights), search,
// filters and a "Past WOs" expander.

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ChevronDown, ChevronRight, Plus, Trash2, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AddRateModal } from './add-rate-modal'

interface Discipline   { id: string; code: string | null; name: string; display_order: number }
interface Category     { id: string; discipline_id: string; code: string | null; name: string; display_order: number }
interface Subcategory  { id: string; category_id: string; name: string; uom: string }
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
}
interface WoHistory {
  id: string
  wo_number: string
  contractor_name: string
  work_description: string | null
  subcategory_id: string | null
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
  canEdit: boolean
}

function fmtINR(n: number | null | undefined): string {
  if (n == null) return '—'
  return '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })
}

function rankLabel(idx: number, total: number): string {
  if (total === 1) return 'L1'
  return 'L' + (idx + 1)
}

function rankClasses(idx: number): string {
  if (idx === 0) return 'bg-emerald-100 text-emerald-800 border-emerald-200'
  if (idx === 1) return 'bg-amber-100 text-amber-800 border-amber-200'
  return 'bg-gray-100 text-gray-600 border-gray-200'
}

export function RateLibrary({
  disciplines, categories, subcategories, rates, woHistory, vendors, contractors, canEdit,
}: Props) {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [discFilter, setDiscFilter] = useState<string>('')
  const [vendorFilter, setVendorFilter] = useState<string>('')
  const [activeOnly, setActiveOnly] = useState(true)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [woExpanded, setWoExpanded] = useState<Set<string>>(new Set())
  const [addingForSub, setAddingForSub] = useState<Subcategory | null>(null)
  const [busyRate, setBusyRate] = useState<string | null>(null)

  // Build lookup maps
  const vendorById     = useMemo(() => new Map(vendors.map(v => [v.id, v])),     [vendors])
  const contractorById = useMemo(() => new Map(contractors.map(c => [c.id, c])), [contractors])
  const subById        = useMemo(() => new Map(subcategories.map(s => [s.id, s])), [subcategories])

  // Sub-categories grouped by category
  const subsByCategory = useMemo(() => {
    const m = new Map<string, Subcategory[]>()
    for (const s of subcategories) {
      if (!m.has(s.category_id)) m.set(s.category_id, [])
      m.get(s.category_id)!.push(s)
    }
    return m
  }, [subcategories])

  // Categories grouped by discipline
  const catsByDiscipline = useMemo(() => {
    const m = new Map<string, Category[]>()
    for (const c of categories) {
      if (!m.has(c.discipline_id)) m.set(c.discipline_id, [])
      m.get(c.discipline_id)!.push(c)
    }
    return m
  }, [categories])

  // Rates grouped by sub-category, sorted ascending. Filtered.
  const ratesBySub = useMemo(() => {
    const m = new Map<string, Rate[]>()
    const today = new Date().toISOString().slice(0, 10)
    for (const r of rates) {
      if (activeOnly && r.valid_till && r.valid_till < today) continue
      if (vendorFilter) {
        const matches = r.vendor_id === vendorFilter || r.contractor_id === vendorFilter
        if (!matches) continue
      }
      if (!m.has(r.subcategory_id)) m.set(r.subcategory_id, [])
      m.get(r.subcategory_id)!.push(r)
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => a.rate_per_unit - b.rate_per_unit)
    }
    return m
  }, [rates, activeOnly, vendorFilter])

  // WO history grouped by sub-category
  const woBySub = useMemo(() => {
    const m = new Map<string, WoHistory[]>()
    for (const w of woHistory) {
      if (!w.subcategory_id) continue
      if (!m.has(w.subcategory_id)) m.set(w.subcategory_id, [])
      m.get(w.subcategory_id)!.push(w)
    }
    return m
  }, [woHistory])

  // Search: which sub-categories match?
  const matchesSearch = useMemo(() => {
    if (!q.trim()) return null
    const lc = q.toLowerCase()
    const matches = new Set<string>()
    for (const s of subcategories) {
      if (s.name.toLowerCase().includes(lc)) matches.add(s.id)
    }
    return matches
  }, [q, subcategories])

  function toggleCollapse(key: string) {
    setCollapsed(s => {
      const next = new Set(s)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }
  function toggleWo(subId: string) {
    setWoExpanded(s => {
      const next = new Set(s)
      if (next.has(subId)) next.delete(subId); else next.add(subId)
      return next
    })
  }

  async function deleteRate(id: string) {
    if (!confirm('Delete this rate?')) return
    setBusyRate(id)
    const { error } = await createClient().from('est_rates').delete().eq('id', id)
    setBusyRate(null)
    if (error) { alert(error.message); return }
    router.refresh()
  }

  const filteredDisciplines = discFilter
    ? disciplines.filter(d => d.id === discFilter)
    : disciplines

  // Vendor/contractor combined options for filter
  const allParties = useMemo(() => {
    const out: Array<{ id: string; label: string }> = []
    for (const v of vendors)     out.push({ id: v.id, label: v.name })
    for (const c of contractors) out.push({ id: c.id, label: c.name + ' (contractor)' })
    return out.sort((a, b) => a.label.localeCompare(b.label))
  }, [vendors, contractors])

  return (
    <div className="space-y-4">
      {/* ── Filter strip ─────────────────────────────────────── */}
      <Card>
        <CardContent className="pt-4 pb-4 flex flex-col md:flex-row gap-2 md:items-center">
          <Input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search rate-item by name…"
            className="md:max-w-sm"
          />
          <select
            value={discFilter}
            onChange={e => setDiscFilter(e.target.value)}
            className="h-10 rounded-xl border border-gray-300 bg-white px-3 text-sm"
          >
            <option value="">All disciplines</option>
            {disciplines.map(d => (
              <option key={d.id} value={d.id}>{d.code ? `${d.code} ` : ''}{d.name}</option>
            ))}
          </select>
          <select
            value={vendorFilter}
            onChange={e => setVendorFilter(e.target.value)}
            className="h-10 rounded-xl border border-gray-300 bg-white px-3 text-sm"
          >
            <option value="">All vendors / contractors</option>
            {allParties.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          <label className="inline-flex items-center gap-1.5 text-sm text-gray-700 ml-auto">
            <input type="checkbox" checked={activeOnly} onChange={e => setActiveOnly(e.target.checked)} />
            Active only
          </label>
        </CardContent>
      </Card>

      {/* ── Accordions ──────────────────────────────────────── */}
      {filteredDisciplines.map(d => {
        const cats = catsByDiscipline.get(d.id) ?? []
        // Count sub-categories under this discipline (after search match)
        const allSubsInDisc = cats.flatMap(c => subsByCategory.get(c.id) ?? [])
        const visibleSubsInDisc = matchesSearch
          ? allSubsInDisc.filter(s => matchesSearch.has(s.id))
          : allSubsInDisc
        if (matchesSearch && visibleSubsInDisc.length === 0) return null

        const discCollapsed = collapsed.has(`d:${d.id}`)
        return (
          <Card key={d.id}>
            <CardContent className="pt-4 pb-4">
              <button
                type="button"
                onClick={() => toggleCollapse(`d:${d.id}`)}
                className="w-full flex items-center justify-between gap-2 text-left"
              >
                <span className="flex items-center gap-2">
                  {discCollapsed ? <ChevronRight className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                  {d.code && <span className="font-mono text-xs text-gray-400">{d.code}</span>}
                  <span className="font-bold text-gray-900">{d.name}</span>
                </span>
                <span className="text-xs text-gray-500">{visibleSubsInDisc.length} items</span>
              </button>

              {!discCollapsed && (
                <div className="mt-3 space-y-3">
                  {cats.map(cat => {
                    const subs = subsByCategory.get(cat.id) ?? []
                    const visibleSubs = matchesSearch
                      ? subs.filter(s => matchesSearch.has(s.id))
                      : subs
                    if (visibleSubs.length === 0) return null
                    const catCollapsed = collapsed.has(`c:${cat.id}`)
                    return (
                      <div key={cat.id} className="border-l-2 border-gray-100 pl-3">
                        <button
                          type="button"
                          onClick={() => toggleCollapse(`c:${cat.id}`)}
                          className="w-full flex items-center justify-between gap-2 text-left py-1"
                        >
                          <span className="flex items-center gap-2">
                            {catCollapsed ? <ChevronRight className="h-3.5 w-3.5 text-gray-400" /> : <ChevronDown className="h-3.5 w-3.5 text-gray-400" />}
                            {cat.code && <span className="font-mono text-[11px] text-gray-400">{cat.code}</span>}
                            <span className="text-sm font-semibold text-gray-700">{cat.name}</span>
                          </span>
                          <span className="text-[11px] text-gray-500">{visibleSubs.length} items</span>
                        </button>

                        {!catCollapsed && (
                          <div className="mt-2 space-y-2">
                            {visibleSubs.map(sub => {
                              const subRates = ratesBySub.get(sub.id) ?? []
                              const subWos = woBySub.get(sub.id) ?? []
                              const wosOpen = woExpanded.has(sub.id)
                              return (
                                <div key={sub.id} className="border border-gray-100 rounded-lg p-3 bg-white">
                                  <div className="flex items-start justify-between gap-2 mb-2">
                                    <p className="text-sm text-gray-900">
                                      <span className="font-medium">{sub.name}</span>
                                      <span className="text-xs text-gray-500"> · per {sub.uom}</span>
                                    </p>
                                    {canEdit && (
                                      <Button size="sm" variant="outline" onClick={() => setAddingForSub(sub)}>
                                        <Plus className="h-3.5 w-3.5" /> Add rate
                                      </Button>
                                    )}
                                  </div>

                                  {subRates.length === 0 ? (
                                    <p className="text-xs text-gray-400 italic mb-2">No rates yet.</p>
                                  ) : (
                                    <div className="space-y-1 mb-2">
                                      {subRates.map((r, idx) => {
                                        const partyName = r.source_type === 'vendor'
                                          ? vendorById.get(r.vendor_id ?? '')?.name
                                          : contractorById.get(r.contractor_id ?? '')?.name
                                        return (
                                          <div key={r.id} className="flex items-center gap-2 text-sm">
                                            <Badge className={cn('w-7 justify-center text-[10px] border', rankClasses(idx))}>
                                              {rankLabel(idx, subRates.length)}
                                            </Badge>
                                            <span className="text-gray-700 flex-1 truncate">{partyName || '—'}</span>
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
                                                onClick={() => deleteRate(r.id)}
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
                                  )}

                                  {subWos.length > 0 && (
                                    <div className="mt-2">
                                      <button
                                        type="button"
                                        onClick={() => toggleWo(sub.id)}
                                        className="text-[11px] text-blue-600 hover:underline inline-flex items-center gap-1"
                                      >
                                        {wosOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                                        Past WOs ({subWos.length})
                                      </button>
                                      {wosOpen && (
                                        <div className="mt-1 space-y-1 pl-4">
                                          {subWos.map(w => (
                                            <div key={w.id} className="text-[11px] text-gray-600 flex flex-wrap items-center gap-2">
                                              <span className="font-mono text-blue-600">{w.wo_number}</span>
                                              <span>{w.contractor_name}</span>
                                              {w.base_value != null && w.base_value > 0 && <span className="font-semibold">{fmtINR(w.base_value)}</span>}
                                              <span className="text-gray-400">{w.from_date} → {w.to_date}</span>
                                              {w.status && <Badge className="text-[10px]" variant="secondary">{w.status}</Badge>}
                                            </div>
                                          ))}
                                        </div>
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
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )
      })}

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
