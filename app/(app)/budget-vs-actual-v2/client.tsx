'use client'
// Budget vs Actual V2 — single-source preview client. Read-only over the BPH
// (budget) blob; writes only the per-project status, area override, and V2-extra
// placeholders. Every number — Budget, WO/PO Approved, Paid, Balance, Used% —
// comes straight from the uploaded budget report. No contractor/supplier overlay,
// no alias matching (that made the "Actual" untrue).
//
// HOD requirements baked in: one snapshot tree (Group → Project → Category →
// Sub-Category), ₹/sft under the money amounts, IN4-style Open/Closed with open
// on top, groups alphabetical, expandable/collapsible everywhere. "Modern" layer:
// live tree search, status filter chips, expand/collapse all, computed watchlist
// (categories over budget), per-project utilisation bars, indent guide lines.

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  ChevronRight, ChevronsUpDown, ChevronsDownUp, Building2, Folder,
  Sparkles, Loader2, Layers, Search, X, ListTree,
  Wallet, TrendingUp, Scale, FileCheck2, UploadCloud, Printer, Clock, Plus, Pencil, Check, HelpCircle,
  ArrowUp, ArrowDown, PencilLine, FolderTree,
} from 'lucide-react'
import { cn, istAgeLabel } from '@/lib/utils'
import type { ComposeResult, CatNode, ProjectNode, GroupNode, DeltaResult, Delta } from '@/lib/budget-v2'

// ─── formatting helpers ──────────────────────────────────────────────────────
// ≥ ₹1 Cr → compact crore (₹1.46 Cr). Under ₹1 Cr → the actual amount, Indian-
// grouped with a trailing "/-" (e.g. ₹89,00,000/-), per HOD preference.
function fmtINR(v: number): string {
  if (!isFinite(v) || v === 0) return '₹0'
  const sign = v < 0 ? '−' : ''
  const a = Math.abs(v)
  if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(2)} Cr`
  return `${sign}₹${Math.round(a).toLocaleString('en-IN')}/-`
}
function perSft(v: number, area: number | null): string {
  if (!area || area <= 0 || !isFinite(v) || v === 0) return ''
  return Math.round(v / area).toLocaleString('en-IN')
}
function utilPct(spent: number, budget: number): number | null {
  if (!budget || budget <= 0) return null
  return Math.round((spent / budget) * 100)
}
function utilColors(u: number) {
  if (u > 100) return { bg: '#FCEBEB', fg: '#A32D2D', bar: '#E24B4A' }
  if (u >= 85) return { bg: '#FAEEDA', fg: '#854F0B', bar: '#EF9F27' }
  return { bg: '#EAF3DE', fg: '#27500A', bar: '#639922' }
}
function sumBy<T>(arr: T[], f: (t: T) => number): number { return arr.reduce((s, t) => s + f(t), 0) }

function Cell({ value, area, dash, cls, subCls, dashCls, size = 'md', showSft = true }: {
  value: number | null; area: number | null; dash?: boolean
  /** colour class for the amount */
  cls?: string
  /** colour class for the ₹/sft pill */
  subCls?: string
  dashCls?: string
  /** Visual size — 'lg' for project/category header rows, 'md' default for sub-rows. */
  size?: 'md' | 'lg'
  /** Show the ₹/sft pill under the amount (off for Approved/Balance to declutter). */
  showSft?: boolean
}) {
  const isLg = size === 'lg'
  const widthCls = isLg ? 'w-[100px]' : 'w-[92px]'
  const amtCls = isLg ? 'text-[15px] font-semibold' : 'text-[13.5px]'
  if (value == null || dash) return <div className={cn(widthCls, 'text-right flex-shrink-0')}><span className={cn('text-sm', dashCls ?? 'text-gray-300')}>—</span></div>
  const sft = showSft ? perSft(value, area) : ''
  return (
    <div className={cn(widthCls, 'text-right flex-shrink-0')}>
      <div className={cn(amtCls, 'tabular-nums leading-tight', cls ?? 'text-gray-900')}>{fmtINR(value)}</div>
      {sft && (
        <div className="mt-1 flex justify-end">
          <span className={cn(
            'inline-flex items-baseline gap-0.5 text-[11px] tabular-nums px-1.5 py-0.5 rounded-md bg-gray-100/80 border border-gray-200/60',
            subCls ?? 'text-gray-500',
          )}>
            <span className="text-[9.5px] opacity-70">₹</span>
            <span className="font-semibold">{sft}</span>
            <span className="text-[9px] uppercase tracking-wider opacity-60 ml-0.5">/sft</span>
          </span>
        </div>
      )}
    </div>
  )
}
function UtilChip({ u }: { u: number }) {
  const c = utilColors(u)
  return <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: c.bg, color: c.fg }}>{u > 100 ? `${u}% over` : `${u}%`}</span>
}

// Colour for a Paid amount given how much of budget it's used.
function paidCls(spent: number, budget: number, light: boolean): string {
  const u = utilPct(spent, budget)
  if (u != null && u > 100) return light ? 'text-rose-700 font-medium' : 'text-rose-300 font-medium'
  return light ? 'text-emerald-700 font-medium' : 'text-emerald-300 font-medium'
}
// Colour for a Balance (Budget − Paid): negative = overspent = rose.
function balanceCls(balance: number): string {
  return balance < 0 ? 'text-rose-700 font-semibold' : 'text-gray-700 font-medium'
}

// ─── main client ─────────────────────────────────────────────────────────────
type StatusFilter = 'all' | 'open' | 'closed'

interface Freshness { budget: string | null }

// IST CALENDAR days, not elapsed ms. Dividing elapsed time by 24h reported a
// file uploaded at 3:49 pm yesterday as "uploaded today", because only ~15
// hours had passed. The staleness flag was off by up to a day for the same
// reason.
function fmtAge(iso: string | null): { text: string; stale: boolean } {
  if (!iso) return { text: 'no upload yet', stale: true }
  const { text, days } = istAgeLabel(iso, { short: true })
  if (days == null) return { text: 'unknown', stale: true }
  return { text, stale: days >= 14 }
}

export default function BudgetV2Client({
  result, knownGroupNames, currentUserId, isAdmin, freshness, delta, prevSnapshotWeek,
}: {
  result: ComposeResult
  knownGroupNames: string[]
  currentUserId: string
  isAdmin: boolean
  freshness: Freshness
  delta: DeltaResult
  prevSnapshotWeek: string | null
}) {
  const router = useRouter()
  const supabase = createClient()
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [busy, setBusy] = useState<string | null>(null)
  const [addProjectOpen, setAddProjectOpen] = useState(false)
  // Closed by default, and the choice is remembered — the guide is for the
  // first visit, not every visit. Reading localStorage in the initialiser (not
  // an effect) avoids the panel flashing open on every load.
  const [helpOpen, setHelpOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem('bva2_help_open') === '1'
  })
  const toggleHelp = () => setHelpOpen(o => {
    const next = !o
    try { window.localStorage.setItem('bva2_help_open', next ? '1' : '0') } catch { /* private mode */ }
    return next
  })
  const [error, setError] = useState<string | null>(null)
  const toggle = (k: string) => setOpen(p => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n })

  const q = query.trim().toLowerCase()
  const searching = q.length > 0

  // Search + status lens over the composed tree. Prunes non-matching branches;
  // node totals stay the REAL rollups (a lens, not a recompute).
  const visGroups = useMemo<GroupNode[]>(() => {
    const match = (s: string) => s.toLowerCase().includes(q)
    const filterProject = (p: ProjectNode): ProjectNode | null => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return null
      if (!searching) return p
      if (match(p.name)) return p
      const cats = p.categories
        .map(c => {
          if (match(c.label) || match(c.code)) return c
          const subcats = c.subcats.filter(sc => match(sc.label) || match(sc.code))
          return subcats.length ? { ...c, subcats } : null
        })
        .filter((c): c is CatNode => c !== null)
      return cats.length ? { ...p, categories: cats } : null
    }
    return result.groups
      .map(g => {
        const projects = g.projects.map(filterProject).filter((p): p is ProjectNode => p !== null)
        return projects.length ? { ...g, projects } : null
      })
      .filter((g): g is GroupNode => g !== null)
  }, [result, q, searching, statusFilter])

  function expandAll() {
    const keys = new Set<string>()
    for (const g of visGroups) for (const p of g.projects) {
      keys.add(`proj:${p.name}`)
      p.categories.forEach((c, i) => { keys.add(`cat:${p.name}:${c.code}:${i}`) })
    }
    setOpen(keys)
  }

  async function setStatus(projectName: string, next: 'open' | 'closed') {
    setBusy(`st:${projectName}`); setError(null)
    const { error } = await supabase.from('budget_v2_project_status')
      .upsert({ project_name: projectName, status: next, updated_by: currentUserId, updated_at: new Date().toISOString() }, { onConflict: 'project_name' })
    setBusy(null)
    if (error) { setError(error.message); return }
    router.refresh()
  }

  // Admin only — V2 area override (beats BPH areaStatement.builtUp).
  async function setArea(projectName: string, area_sft: number | null) {
    setBusy(`ar:${projectName}`); setError(null)
    let err: { message: string } | null = null
    if (area_sft == null) {
      const { error } = await supabase.from('budget_v2_project_area').delete().eq('project_name', projectName)
      err = error
    } else {
      const { error } = await supabase.from('budget_v2_project_area')
        .upsert({ project_name: projectName, area_sft, updated_by: currentUserId, updated_at: new Date().toISOString() }, { onConflict: 'project_name' })
      err = error
    }
    setBusy(null)
    if (err) { setError(err.message); return }
    router.refresh()
  }

  // Admin only — V2 extra project (hand-added; may carry hand-keyed numbers).
  async function addExtraProject(name: string, group_name: string | null, area_sft: number | null, nums: { budget: number | null; approved: number | null; paid: number | null }) {
    if (!name.trim()) { setError('Project name is required'); return }
    setBusy(`addp:${name}`); setError(null)
    const { error } = await supabase.from('budget_v2_extra_project').upsert(
      { name: name.trim(), group_name: group_name?.trim() || null, area_sft, budget: nums.budget, approved: nums.approved, paid: nums.paid, updated_by: currentUserId, updated_at: new Date().toISOString() },
      { onConflict: 'name' },
    )
    setBusy(null)
    if (error) { setError(error.message); return }
    router.refresh()
  }

  // Admin only — flagged manual override (BPH project) or hand-keyed numbers
  // (extra project). Writes to budget_v2_override / budget_v2_extra_project.
  async function saveNumbers(projectName: string, isExtra: boolean, vals: { budget: number | null; approved: number | null; paid: number | null; note: string | null }) {
    setBusy(`num:${projectName}`); setError(null)
    let err: { message: string } | null = null
    if (isExtra) {
      const { error } = await supabase.from('budget_v2_extra_project')
        .update({ budget: vals.budget, approved: vals.approved, paid: vals.paid, updated_by: currentUserId, updated_at: new Date().toISOString() })
        .eq('name', projectName)
      err = error
    } else if (vals.budget == null && vals.approved == null && vals.paid == null) {
      const { error } = await supabase.from('budget_v2_override').delete().eq('project_name', projectName)
      err = error
    } else {
      const { error } = await supabase.from('budget_v2_override').upsert(
        { project_name: projectName, budget: vals.budget, approved: vals.approved, paid: vals.paid, note: vals.note, updated_by: currentUserId, updated_at: new Date().toISOString() },
        { onConflict: 'project_name' },
      )
      err = error
    }
    setBusy(null)
    if (err) { setError(err.message); return }
    router.refresh()
  }

  // ── KPIs + computed watchlist (pure maths from the budget report) ──
  const t = result.totals
  const spentPct = t.budget > 0 ? Math.round((t.spent / t.budget) * 100) : 0
  const balance = t.budget - t.spent
  const allProjects = result.groups.flatMap(g => g.projects)
  const overruns = allProjects
    .flatMap(p => p.categories.filter(c => c.hasBudget).map(c => ({ proj: p.name, cat: c.label, u: utilPct(c.spent, c.budget) ?? 0 })))
    .filter(x => x.u > 100)
    .sort((a, b) => b.u - a.u)

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <PageHeader title="Budget vs Actual V2" back="/dashboard"
        subtitle="One snapshot from the budget report — Budget, WO/PO Approved, Paid, Balance & ₹/sft.">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Link href="/budget-vs-actual-v2/upload"
            className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-800">
            <UploadCloud className="h-3.5 w-3.5" /> Upload
          </Link>
          {/* Four print/export variants used to sit here as four separate
              chips. On a phone that wrapped into a wall of buttons above the
              numbers, and they are all the same intent — take this away as
              paper. One control, opened only when you actually want to print. */}
          <details className="relative group">
            <summary className="list-none cursor-pointer inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 min-h-[34px] rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-800 select-none">
              <Printer className="h-3.5 w-3.5" /> Print / Export
              <ChevronRight className="h-3.5 w-3.5 text-gray-400 transition-transform group-open:rotate-90" />
            </summary>
            <div className="absolute right-0 z-20 mt-1 w-[248px] rounded-xl border border-gray-200 bg-white shadow-lg overflow-hidden">
              {[
                { href: '/budget-vs-actual-v2/sc-presentation',    icon: Sparkles,   label: 'SC Presentation', hint: 'Pick projects · budget vs actual' },
                { href: '/budget-vs-actual-v2/weekly',             icon: Printer,    label: 'Weekly PDF',      hint: 'One line per project' },
                { href: '/budget-vs-actual-v2/weekly-category',    icon: FolderTree, label: 'By Category',     hint: 'One project per page' },
                { href: '/budget-vs-actual-v2/weekly-subcategory', icon: ListTree,   label: 'By Sub-category', hint: 'Category & sub-category' },
                { href: '/budget-vs-actual-v2/print',              icon: Printer,    label: 'Board view',      hint: 'Full snapshot to print' },
              ].map(o => {
                const Icon = o.icon
                return (
                  <Link key={o.href} href={o.href}
                    className="flex items-start gap-2 px-3 py-2.5 min-h-[44px] hover:bg-gray-50 border-b border-gray-50 last:border-0">
                    <Icon className="h-3.5 w-3.5 text-gray-500 mt-0.5 flex-shrink-0" />
                    <span className="min-w-0">
                      <span className="block text-[12.5px] font-medium text-gray-800">{o.label}</span>
                      <span className="block text-[11px] text-gray-500">{o.hint}</span>
                    </span>
                  </Link>
                )
              })}
            </div>
          </details>
          <span className="text-[11px] font-semibold px-2 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200">Preview · admin only</span>
        </div>
      </PageHeader>

      {/* Freshness — the budget report is the single source; flag it when stale */}
      <Link href="/budget-vs-actual-v2/upload"
        className={cn('rounded-xl border px-3 py-2.5 flex items-center gap-2.5 hover:shadow-sm transition-shadow',
          fmtAge(freshness.budget).stale ? 'border-amber-200 bg-amber-50/40' : 'border-gray-200 bg-white')}>
        <div className={cn('h-7 w-7 rounded-lg flex items-center justify-center flex-shrink-0',
          fmtAge(freshness.budget).stale ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500')}>
          <Clock className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-wide text-gray-500">Budget report (BPH) — the source for every number here</div>
          <div className={cn('text-[13px] font-medium tabular-nums', fmtAge(freshness.budget).stale ? 'text-amber-800' : 'text-gray-900')}>
            uploaded {fmtAge(freshness.budget).text}
          </div>
        </div>
        <UploadCloud className="h-4 w-4 text-gray-300 flex-shrink-0" />
      </Link>

      {error && <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-sm text-rose-700">{error}</div>}

      {/* ── KPI strip ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <Metric icon={<Wallet className="h-4 w-4" />} tone="slate" label="Total budget" value={fmtINR(t.budget)} />
        <Metric icon={<FileCheck2 className="h-4 w-4" />} tone="blue" label="WO/PO approved" value={fmtINR(t.approved)} />
        <Metric icon={<TrendingUp className="h-4 w-4" />} tone={spentPct > 100 ? 'rose' : 'emerald'} label={`Paid · ${spentPct}% of budget`} value={fmtINR(t.spent)} />
        <Metric icon={<Scale className="h-4 w-4" />} tone={balance < 0 ? 'rose' : 'amber'} label={balance < 0 ? 'Over budget' : 'Balance left'} value={fmtINR(Math.abs(balance))} />
      </div>

      {/* ── This week's movement (vs the previous upload) ── */}
      <MovementStrip delta={delta} prevSnapshotWeek={prevSnapshotWeek} />

      {/* ── How to read this — one collapsed panel, holding BOTH the hierarchy
             skeleton and the column/colour guide. They used to sit open above
             the data: two full cards of instructions before a single figure,
             which on a phone meant scrolling past the entire explanation every
             visit. Learn it once, then it stays out of the way. ── */}
      <HelpPanel open={helpOpen} onToggle={toggleHelp} />

      {/* ── Watchlist (computed) ── */}
      <div className="flex items-start gap-2.5 bg-white border border-gray-200 rounded-2xl px-3.5 py-3">
        <Sparkles className="h-4 w-4 text-violet-600 flex-shrink-0 mt-1" />
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[12px] font-semibold text-gray-700 mr-0.5">Watchlist</span>
          {overruns.length === 0 && <span className="text-[11px] px-2 py-1 rounded-full" style={{ background: '#EAF3DE', color: '#27500A' }}>All categories within budget</span>}
          {overruns.slice(0, 4).map((o, i) => (
            <button key={i} type="button" onClick={() => setQuery(o.cat)}
              className="text-[11px] px-2 py-1 rounded-full hover:opacity-80" style={{ background: '#FCEBEB', color: '#A32D2D' }}
              title={`${o.proj} · ${o.cat} is at ${o.u}% of budget — click to focus`}>
              {o.proj} · {o.cat} {o.u}%
            </button>
          ))}
          {overruns.length > 4 && <span className="text-[11px] text-gray-400">+{overruns.length - 4} more</span>}
        </div>
      </div>

      {/* ── Controls: search + status chips + expand/collapse ── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
          <Input value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search project or category…" className="pl-9 pr-8" />
          {query && (
            <button type="button" onClick={() => setQuery('')} aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="inline-flex bg-gray-100 rounded-lg p-0.5">
          {(['all', 'open', 'closed'] as const).map(s => (
            <button key={s} type="button" onClick={() => setStatusFilter(s)}
              className={cn('text-xs font-medium px-3 py-1.5 rounded-md capitalize transition-colors',
                statusFilter === s ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800')}>
              {s}
            </button>
          ))}
        </div>
        <div className="inline-flex gap-1">
          {isAdmin && (
            <Button size="sm" variant="outline" onClick={() => setAddProjectOpen(true)} title="Add a V2-only project (placeholder for upcoming work)">
              <Plus className="h-3.5 w-3.5" /> Add project
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={expandAll} title="Expand everything">
            <ChevronsUpDown className="h-3.5 w-3.5" /> Expand all
          </Button>
          <Button size="sm" variant="outline" onClick={() => setOpen(new Set())} title="Collapse everything">
            <ChevronsDownUp className="h-3.5 w-3.5" /> Collapse all
          </Button>
        </div>
      </div>

      {isAdmin && addProjectOpen && (
        <AddProjectInline
          knownGroupNames={knownGroupNames}
          onSubmit={async (name, gname, area, nums) => { await addExtraProject(name, gname, area, nums); setAddProjectOpen(false) }}
          onCancel={() => setAddProjectOpen(false)}
        />
      )}

      {/* ── Tree ── */}
      {visGroups.length === 0 && (
        <Card><CardContent className="py-10 text-center text-sm text-gray-500">No matches — try a different search or filter.</CardContent></Card>
      )}

      {visGroups.map(g => {
        const gBudget = sumBy(g.projects, p => p.budget)
        const gSpent = sumBy(g.projects, p => p.spent)
        const gu = utilPct(gSpent, gBudget)
        // group avg ₹/sft (spent ÷ total area of projects that HAVE an area)
        const withArea = g.projects.filter(p => p.area && p.area > 0)
        const gArea = sumBy(withArea, p => p.area ?? 0)
        const gAvgSft = gArea > 0 ? sumBy(withArea, p => p.spent) / gArea : null
        return (
          <section key={g.name}>
            <div className="flex items-end justify-between gap-3 px-1 mb-1.5">
              <div className="flex items-center gap-2 min-w-0">
                <Layers className="h-4 w-4 text-gray-400 flex-shrink-0" />
                <span className="text-[15px] font-semibold text-gray-900 truncate">{g.name}</span>
                <span className="text-[11px] text-gray-400 flex-shrink-0">{g.projects.length} project{g.projects.length === 1 ? '' : 's'}</span>
              </div>
              <span className="text-[11px] text-gray-400 flex-shrink-0 tabular-nums">
                budget {fmtINR(gBudget)} · paid {fmtINR(gSpent)}{gu != null ? ` · ${gu}%` : ''}{gAvgSft != null ? ` · avg ₹${Math.round(gAvgSft).toLocaleString('en-IN')}/sft` : ''}
              </span>
            </div>
            {gu != null && (
              <div className="h-[4px] rounded-full bg-gray-100 overflow-hidden mx-1 mb-2">
                <div className="h-full rounded-full" style={{ width: `${Math.min(gu, 100)}%`, background: utilColors(gu).bar }} />
              </div>
            )}
            {/* Horizontal scroll on narrow screens so the 4 amount columns never wrap/overflow */}
            <div className="overflow-x-auto">
              <div className="min-w-[760px]">
                <div className="flex items-center gap-2 px-4 mb-1">
                  <div className="flex-1 text-[10.5px] uppercase tracking-wide text-gray-400">Project · category</div>
                  <div className="w-[100px] text-right text-[10.5px] uppercase tracking-wide text-gray-400">Budget</div>
                  <div className="w-[100px] text-right text-[10.5px] uppercase tracking-wide text-gray-400">WO/PO Appr.</div>
                  <div className="w-[100px] text-right text-[10.5px] uppercase tracking-wide text-gray-400">Paid</div>
                  <div className="w-[100px] text-right text-[10.5px] uppercase tracking-wide text-gray-400">Balance</div>
                </div>
                <div className="space-y-2.5">
                  {g.projects.map(p => (
                    <ProjectCard key={p.name} p={p} open={open} toggle={toggle} forceOpen={searching}
                      groupAvgSft={gAvgSft} isAdmin={isAdmin}
                      onStatus={setStatus} statusBusy={busy === `st:${p.name}`}
                      onArea={setArea} areaBusy={busy === `ar:${p.name}`}
                      pdelta={delta.byProject[p.name]} hasBaseline={delta.hasBaseline}
                      onSaveNumbers={saveNumbers} numbersBusy={busy === `num:${p.name}`} />
                  ))}
                </div>
              </div>
            </div>
          </section>
        )
      })}

      <p className="text-[11px] text-gray-400 px-1 leading-relaxed">
        Every figure is read straight from the uploaded budget report. New here? Tap <b className="font-medium">“How to read this”</b> at the top.
      </p>
    </div>
  )
}

// ─── How this report is built — the tree skeleton, always visible ────────────
function StructureMap() {
  const levels = [
    { depth: 0, icon: <Layers className="h-3.5 w-3.5" />, name: 'Group', what: 'trust / cluster', eg: 'NGH · P2 Step Terrace · VV', tone: '#0f2a4a' },
    { depth: 1, icon: <Building2 className="h-3.5 w-3.5" />, name: 'Project', what: 'building / sub-project', eg: 'NGH A · A01 Building · SRAH', tone: '#12447e' },
    { depth: 2, icon: <Folder className="h-3.5 w-3.5" />, name: 'Category', what: 'work head', eg: 'Civil · Earthworks · Finishes', tone: '#854F0B' },
    { depth: 3, icon: <ChevronRight className="h-3 w-3" />, name: 'Work item', what: 'sub-line', eg: 'RCC · Excavation · Plaster', tone: '#27500A' },
  ]
  return (
    // Nested inside the help panel now, so no card of its own — a bordered box
    // inside a bordered box just reads as clutter.
    <div className="rounded-xl bg-gray-50/70 px-3 py-2.5">
      <div className="flex items-center gap-2 mb-2.5">
        <ListTree className="h-4 w-4 text-teal-600 flex-shrink-0" />
        <span className="text-[11px] uppercase tracking-wide font-semibold text-gray-500">How this report is built</span>
      </div>
      <div className="space-y-0">
        {levels.map((l, i) => (
          <div key={l.name} className="flex items-center gap-2 py-1.5" style={{ paddingLeft: l.depth * 18 }}>
            {l.depth > 0 && <span className="text-gray-300 -ml-3 flex-shrink-0">└</span>}
            <span className="inline-flex items-center justify-center h-6 w-6 rounded-lg flex-shrink-0"
              style={{ background: `${l.tone}14`, color: l.tone }}>{l.icon}</span>
            <span className="text-[13px] font-semibold text-gray-900 flex-shrink-0">{l.name}</span>
            <span className="text-[11.5px] text-gray-500 flex-shrink-0">{l.what}</span>
            <span className="text-[11px] text-gray-400 truncate hidden sm:inline">e.g. {l.eg}</span>
            {i === 0 && <span className="ml-auto text-[10px] font-medium text-gray-400 hidden md:inline flex-shrink-0">tap any row in the tree to open the next level ↓</span>}
          </div>
        ))}
      </div>
      <div className="mt-2.5 pt-2.5 border-t border-gray-100 text-[11.5px] text-gray-500 leading-relaxed">
        Every level totals <b className="font-medium text-gray-700">Budget</b> · <b className="font-medium" style={{ color: '#0C447C' }}>WO/PO Approved</b> · <b className="font-medium" style={{ color: '#27500A' }}>Paid</b> · <b className="font-medium text-gray-700">Balance</b> · <b className="font-medium text-gray-700">Used%</b> — so a group total is just the sum of its projects, a project the sum of its categories, and so on down to each work item.
      </div>
    </div>
  )
}

// ─── How to read this — collapsible basic instructions ───────────────────────
function HelpPanel({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-3.5 py-2.5 hover:bg-gray-50/70 transition-colors text-left"
      >
        <HelpCircle className="h-4 w-4 text-blue-600 flex-shrink-0" />
        <span className="text-[12.5px] font-semibold text-gray-700">How to read this</span>
        <span className="text-[11px] text-gray-400">tree · columns · numbers · ₹/sft · colours</span>
        <div className="flex-1" />
        <ChevronRight className={cn('h-4 w-4 text-gray-400 flex-shrink-0 transition-transform', open && 'rotate-90')} />
      </button>
      {open && (
        <div className="border-t border-gray-100 px-4 py-3 space-y-3 text-[12.5px] text-gray-600 leading-relaxed">
          <StructureMap />
          <div>
            <div className="text-[11px] uppercase tracking-wide font-semibold text-gray-500 mb-1">The tree</div>
            Tap a <b className="font-medium text-gray-800">project</b> to open its categories, and a <b className="font-medium text-gray-800">category</b> to see its work-item breakdown.
            Use <b className="font-medium text-gray-800">Expand all / Collapse all</b> above. Open projects sit on top; closed ones are dimmed.
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide font-semibold text-gray-500 mb-1">The five columns</div>
            <ul className="space-y-1">
              <li><b className="font-medium text-gray-800">Budget</b> — sanctioned amount for that line.</li>
              <li><b className="font-medium" style={{ color: '#0C447C' }}>WO/PO Approved</b> — value committed through work orders / purchase orders (may be less than budget).</li>
              <li><b className="font-medium" style={{ color: '#27500A' }}>Paid</b> — actually released so far (the “Actual”), straight from the budget report’s own Paid column.</li>
              <li><b className="font-medium text-gray-800">Balance</b> — Budget − Paid (what’s left; red if overspent).</li>
              <li><b className="font-medium text-gray-800">Used%</b> — Paid ÷ Budget, shown as the little pill + bar.</li>
            </ul>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide font-semibold text-gray-500 mb-1">Numbers &amp; ₹/sft</div>
            Amounts are Indian-style: <b className="font-medium text-gray-800">₹ Cr</b> = crore, <b className="font-medium text-gray-800">₹ L</b> = lakh, <b className="font-medium text-gray-800">₹ K</b> = thousand
            (e.g. ₹1.5 Cr, ₹12,34,567). The small <b className="font-medium text-gray-800">₹…/sft</b> pill under Budget &amp; Paid is that amount ÷ the project’s built-up area —
            tap the <b className="font-medium text-gray-800">sft</b> next to a project name to set or edit the area (admin).
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-0.5">
            <span className="text-[11px] uppercase tracking-wide font-semibold text-gray-500 w-full">Colours</span>
            <span className="inline-flex items-center gap-1.5 text-[12px]"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: '#639922' }} /> under 85% used</span>
            <span className="inline-flex items-center gap-1.5 text-[12px]"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: '#EF9F27' }} /> 85–100%</span>
            <span className="inline-flex items-center gap-1.5 text-[12px]"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: '#E24B4A' }} /> over budget</span>
          </div>
        </div>
      )}
    </div>
  )
}

function Metric({ icon, tone, label, value }: { icon: React.ReactNode; tone: 'slate' | 'emerald' | 'rose' | 'amber' | 'blue'; label: string; value: string }) {
  const tones: Record<string, string> = {
    slate: 'bg-slate-100 text-slate-700', emerald: 'bg-emerald-50 text-emerald-700', rose: 'bg-rose-50 text-rose-700',
    amber: 'bg-amber-50 text-amber-700', blue: 'bg-blue-50 text-blue-700',
  }
  return (
    <div className="rounded-2xl border border-gray-200 bg-white px-3.5 py-3 flex items-center gap-3">
      <div className={cn('h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0', tones[tone])}>{icon}</div>
      <div className="min-w-0">
        <div className="text-[11px] text-gray-500 truncate">{label}</div>
        <div className="text-xl font-semibold text-gray-900 tabular-nums">{value}</div>
      </div>
    </div>
  )
}

// ─── week-over-week + manual-override helpers ────────────────────────────────
function fmtSigned(v: number): string {
  if (v === 0) return '₹0'
  return (v > 0 ? '+' : '−') + fmtINR(Math.abs(v))
}
function fmtSnapDate(iso: string | null): string {
  if (!iso) return 'last snapshot'
  const t = Date.parse(iso + 'T00:00:00')
  if (!isFinite(t)) return iso
  return new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}
function DeltaChip({ label, v, muted }: { label: string; v: number; muted?: boolean }) {
  const up = v > 0
  const color = muted ? '#6b7280' : up ? '#166534' : '#9a3412'
  const bg = muted ? '#f3f4f6' : up ? '#dcfce7' : '#ffedd5'
  return (
    <span className="inline-flex items-center gap-0.5 text-[10.5px] font-semibold px-1.5 py-0.5 rounded-full tabular-nums" style={{ color, background: bg }}>
      {up ? <ArrowUp className="h-2.5 w-2.5" /> : <ArrowDown className="h-2.5 w-2.5" />}
      {fmtSigned(v)} {label}
    </span>
  )
}
function manualTitle(p: ProjectNode): string {
  if (p.isExtra) return `Hand-entered project (not in the IN4 upload)${p.manualNote ? ` — ${p.manualNote}` : ''}`
  const bits: string[] = []
  if (p.uploaded) {
    if (p.manual?.budget) bits.push(`Budget was ${fmtINR(p.uploaded.budget)}`)
    if (p.manual?.approved) bits.push(`Approved was ${fmtINR(p.uploaded.approved)}`)
    if (p.manual?.spent) bits.push(`Paid was ${fmtINR(p.uploaded.spent)}`)
  }
  return `Manually adjusted${p.manualNote ? ` — ${p.manualNote}` : ''}${bits.length ? ` (uploaded: ${bits.join(', ')})` : ''}`
}

function MovementStrip({ delta, prevSnapshotWeek }: {
  delta: DeltaResult; prevSnapshotWeek: string | null
}) {
  const d = delta.overall
  const anyMove = d.paid !== 0 || d.approved !== 0 || d.budget !== 0
  return (
    <div className="flex items-center gap-2.5 bg-white border border-gray-200 rounded-2xl px-3.5 py-2.5 flex-wrap">
      <TrendingUp className="h-4 w-4 text-emerald-600 flex-shrink-0" />
      {delta.hasBaseline ? (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[12px] font-semibold text-gray-700">Since previous upload ({fmtSnapDate(prevSnapshotWeek)}):</span>
          <DeltaChip label="paid" v={d.paid} />
          {d.approved !== 0 && <DeltaChip label="approved" v={d.approved} muted />}
          {!anyMove && <span className="text-[11px] text-gray-400">no change since last upload</span>}
        </div>
      ) : (
        <span className="text-[12px] text-gray-500">No earlier upload to compare against yet — the change vs last week appears once a second budget report is uploaded.</span>
      )}
    </div>
  )
}

function NumberEditor({ p, busy, onSave, onCancel }: {
  p: ProjectNode; busy: boolean
  onSave: (vals: { budget: number | null; approved: number | null; paid: number | null; note: string | null }) => void
  onCancel: () => void
}) {
  const seed = (v: number, manual?: boolean) => (p.isExtra || manual) ? (v ? String(v) : '') : ''
  const [budget, setBudget] = useState(seed(p.budget, p.manual?.budget))
  const [approved, setApproved] = useState(seed(p.approved, p.manual?.approved))
  const [paid, setPaid] = useState(seed(p.spent, p.manual?.spent))
  const [note, setNote] = useState(p.manualNote ?? '')
  const parse = (s: string): number | null => { const t = s.trim(); if (t === '') return null; const n = Number(t.replace(/,/g, '')); return isFinite(n) ? n : null }
  const preview = (s: string) => { const n = parse(s); return n == null ? '' : fmtINR(n) }
  const field = (label: string, val: string, set: (s: string) => void, color?: string) => (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wide text-gray-500" style={color ? { color } : undefined}>{label} (₹)</span>
      <input type="text" inputMode="numeric" value={val} onChange={e => set(e.target.value)}
        placeholder={p.isExtra ? 'e.g. 101522855' : 'blank = keep uploaded'}
        className="h-9 rounded-lg border border-gray-300 bg-white px-2.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-amber-200" />
      {preview(val) && <span className="text-[10.5px] text-gray-400 tabular-nums">= {preview(val)}</span>}
    </label>
  )
  return (
    <div className="border-t border-amber-200 bg-amber-50/50 px-3.5 py-3 space-y-2.5">
      <div className="text-[11px] text-amber-800 leading-relaxed">
        {p.isExtra
          ? 'Hand-entered project — key its figures in full ₹ (like the Excel). Shown with a “manual entry” flag.'
          : 'Correct a figure in full ₹. Leave a box blank to keep the uploaded value. The uploaded value stays underneath and the cell is flagged “adjusted”.'}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        {field('Budget', budget, setBudget)}
        {field('WO/PO Approved', approved, setApproved, '#0C447C')}
        {field('Paid', paid, setPaid, '#27500A')}
      </div>
      <input type="text" value={note} onChange={e => setNote(e.target.value)} placeholder="Note (why adjusted) — optional"
        className="w-full h-9 rounded-lg border border-gray-300 bg-white px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-200" />
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => onSave({ budget: parse(budget), approved: parse(approved), paid: parse(paid), note: note.trim() || null })} disabled={busy}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
        {!p.isExtra && (p.manual?.budget || p.manual?.approved || p.manual?.spent) && (
          <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => onSave({ budget: null, approved: null, paid: null, note: null })} disabled={busy}>
            Clear override
          </Button>
        )}
      </div>
    </div>
  )
}

// ─── project card ───────────────────────────────────────────────────────────
function ProjectCard({ p, open, toggle, forceOpen, groupAvgSft, isAdmin, onStatus, statusBusy, onArea, areaBusy, pdelta, hasBaseline, onSaveNumbers, numbersBusy }: {
  p: ProjectNode
  open: Set<string>
  toggle: (k: string) => void
  forceOpen: boolean
  groupAvgSft: number | null
  isAdmin: boolean
  onStatus: (name: string, next: 'open' | 'closed') => void
  statusBusy: boolean
  onArea: (name: string, area_sft: number | null) => void
  areaBusy: boolean
  pdelta?: Delta
  hasBaseline: boolean
  onSaveNumbers: (name: string, isExtra: boolean, vals: { budget: number | null; approved: number | null; paid: number | null; note: string | null }) => void
  numbersBusy: boolean
}) {
  const [editingArea, setEditingArea] = useState(false)
  const [areaDraft, setAreaDraft] = useState<string>(p.area ? String(p.area) : '')
  const [editingNumbers, setEditingNumbers] = useState(false)
  const pk = `proj:${p.name}`
  const isOpen = forceOpen || open.has(pk)
  const u = utilPct(p.spent, p.budget)
  const c = u != null ? utilColors(u) : null
  const mySft = p.area && p.area > 0 ? p.spent / p.area : null
  const balance = p.budget - p.spent
  const isManual = !!(p.manual && (p.manual.budget || p.manual.approved || p.manual.spent))

  // "11% of budget used · ₹719/sft paid · 11% above group avg · ▲ ₹X paid this week"
  let caption = ''
  if (u != null) caption += `${u}% of budget used`
  if (mySft != null) caption += `${caption ? ' · ' : ''}₹${Math.round(mySft).toLocaleString('en-IN')}/sft paid`
  if (mySft != null && groupAvgSft != null && groupAvgSft > 0) {
    const d = Math.round(((mySft - groupAvgSft) / groupAvgSft) * 100)
    caption += Math.abs(d) < 1 ? ' · at group avg' : ` · ${Math.abs(d)}% ${d > 0 ? 'above' : 'below'} group avg`
  }

  return (
    <div className={cn('border border-gray-200 rounded-2xl overflow-hidden bg-white transition-shadow hover:shadow-sm', p.status === 'closed' && 'opacity-55')}>
      <div className="px-3 py-2.5 cursor-pointer hover:bg-gray-50/70 transition-colors" onClick={() => toggle(pk)}>
        <div className="flex items-center gap-2">
          <ChevronRight className={cn('h-4 w-4 text-gray-400 flex-shrink-0 transition-transform', isOpen && 'rotate-90')} />
          <div className="h-7 w-7 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
            <Building2 className="h-4 w-4 text-gray-500" />
          </div>
          <span className="font-semibold text-sm text-gray-900 truncate">{p.name}</span>
          {isAdmin ? (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onStatus(p.name, p.status === 'open' ? 'closed' : 'open') }}
              disabled={statusBusy}
              className="text-[10px] font-medium px-2 py-0.5 rounded-full flex-shrink-0"
              style={p.status === 'open' ? { background: '#EAF3DE', color: '#27500A' } : { background: '#F1EFE8', color: '#444441' }}
              title="Saved per project — survives re-uploads"
            >
              {statusBusy ? '…' : p.status}
            </button>
          ) : (
            <span
              className="text-[10px] font-medium px-2 py-0.5 rounded-full flex-shrink-0"
              style={p.status === 'open' ? { background: '#EAF3DE', color: '#27500A' } : { background: '#F1EFE8', color: '#444441' }}
              title="Status — admin can change this"
            >
              {p.status}
            </span>
          )}
          {/* Area — inline editable for admin, read-only for others */}
          {editingArea && isAdmin ? (
            <span className="inline-flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
              <input
                type="number" min={0} value={areaDraft}
                onChange={e => setAreaDraft(e.target.value)}
                placeholder="sft" autoFocus
                className="h-6 w-20 text-[11px] tabular-nums rounded border border-gray-300 px-1.5 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
              <button type="button" disabled={areaBusy}
                onClick={() => { const n = areaDraft.trim() === '' ? null : Number(areaDraft); onArea(p.name, n); setEditingArea(false) }}
                className="text-emerald-600 hover:bg-emerald-50 rounded p-0.5"
                title="Save area"><Check className="h-3.5 w-3.5" /></button>
              <button type="button" disabled={areaBusy}
                onClick={() => { setAreaDraft(p.area ? String(p.area) : ''); setEditingArea(false) }}
                className="text-gray-400 hover:bg-gray-100 rounded p-0.5" title="Cancel"><X className="h-3.5 w-3.5" /></button>
            </span>
          ) : (
            <span
              className={cn('inline-flex items-center gap-1 text-[10px] text-gray-400 flex-shrink-0', isAdmin && 'cursor-pointer hover:text-gray-700 hover:underline')}
              onClick={e => { if (isAdmin) { e.stopPropagation(); setAreaDraft(p.area ? String(p.area) : ''); setEditingArea(true) } }}
              title={isAdmin ? 'Click to edit built-up area (saved in V2)' : ''}
            >
              {p.area ? `${p.area.toLocaleString('en-IN')} sft` : (isAdmin ? '+ set area' : 'no area')}
              {isAdmin && <Pencil className="h-2.5 w-2.5 opacity-0 group-hover:opacity-100" />}
            </span>
          )}
          {u != null && <UtilChip u={u} />}
          {isManual && (
            <span className="inline-flex items-center gap-1 text-[9.5px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0"
              style={{ background: '#FEF3C7', color: '#92400E' }}
              title={manualTitle(p)}>
              <PencilLine className="h-2.5 w-2.5" /> {p.isExtra ? 'manual entry' : 'adjusted'}
            </span>
          )}
          {isAdmin && (
            <button type="button" onClick={e => { e.stopPropagation(); setEditingNumbers(v => !v) }}
              disabled={numbersBusy}
              className="text-[10px] font-medium px-1.5 py-0.5 rounded-md text-gray-500 hover:bg-gray-100 flex-shrink-0 inline-flex items-center gap-1"
              title={p.isExtra ? 'Edit this project’s numbers' : 'Manually correct Budget / Approved / Paid (flagged)'}>
              {numbersBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Pencil className="h-3 w-3" />} ₹
            </button>
          )}
          <div className="flex-1" />
          <Cell value={p.budget} area={p.area} size="lg" />
          <Cell value={p.approved || null} area={p.area} size="lg" cls="text-blue-800" />
          <Cell value={p.spent} area={p.area} cls={paidCls(p.spent, p.budget, true)} size="lg" />
          <Cell value={p.budget ? balance : null} area={p.area} cls={balanceCls(balance)} size="lg" />
        </div>
        {u != null && c && (
          <div className="mt-2 h-[5px] rounded-full bg-gray-100 overflow-hidden">
            <div className="h-full rounded-full transition-[width]" style={{ width: `${Math.min(u, 100)}%`, background: c.bar }} />
          </div>
        )}
        <div className="mt-1.5 flex items-center gap-2 flex-wrap">
          {caption && <span className="text-[11px] text-gray-500">{caption}</span>}
          {hasBaseline && pdelta && pdelta.paid !== 0 && <DeltaChip label="paid" v={pdelta.paid} />}
          {hasBaseline && pdelta && pdelta.approved !== 0 && <DeltaChip label="approved" v={pdelta.approved} muted />}
        </div>
      </div>
      {isAdmin && editingNumbers && (
        <NumberEditor p={p} busy={numbersBusy}
          onSave={vals => { onSaveNumbers(p.name, !!p.isExtra, vals); setEditingNumbers(false) }}
          onCancel={() => setEditingNumbers(false)} />
      )}

      {isOpen && (
        <div className="border-t border-gray-100">
          {p.categories.length === 0 && <div className="px-4 py-2.5 text-xs text-gray-400 italic">No budget lines.</div>}
          {p.categories.map((cat, i) => (
            <CategoryBlock key={cat.code + ':' + i} cat={cat} project={p} idx={i} open={open} toggle={toggle} forceOpen={forceOpen} />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── category block (with indent guides) ─────────────────────────────────────
function CategoryBlock({ cat, project, idx, open, toggle, forceOpen }: {
  cat: CatNode; project: ProjectNode; idx: number; open: Set<string>; toggle: (k: string) => void; forceOpen: boolean
}) {
  const ck = `cat:${project.name}:${cat.code}:${idx}`
  const isOpen = forceOpen || open.has(ck)
  const u = utilPct(cat.spent, cat.budget)
  const hasChildren = cat.subcats.length > 0
  const balance = cat.budget - cat.spent
  // BPH exports many empty placeholder sub-rows (IN4 stores the full work-item
  // checklist even when nothing's been spent on most of them). They drown the
  // real numbers, so hide zero-only rows by default; user can reveal.
  const subcatsWithValue = cat.subcats.filter(sc => sc.budget !== 0 || sc.spent !== 0 || sc.approved !== 0)
  const hiddenCount = cat.subcats.length - subcatsWithValue.length
  const showAllKey = ck + ':allsubs'
  const showAll = forceOpen || open.has(showAllKey)
  const shownSubcats = showAll ? cat.subcats : subcatsWithValue
  return (
    <div>
      {/* category row — refined header */}
      <div className={cn('flex items-center gap-2.5 pr-3 py-2.5 border-t border-gray-100', hasChildren && 'cursor-pointer hover:bg-gray-50/60', isOpen && 'bg-gray-50/40')}
        onClick={() => hasChildren && toggle(ck)} style={{ paddingLeft: 30 }}>
        {hasChildren
          ? <ChevronRight className={cn('h-3.5 w-3.5 text-gray-400 flex-shrink-0 transition-transform', isOpen && 'rotate-90')} />
          : <span className="w-3.5 flex-shrink-0" />}
        <Folder className={cn('h-3.5 w-3.5 flex-shrink-0', isOpen ? 'text-gray-600' : 'text-gray-400')} />
        {cat.code && <span className="font-mono text-[10px] text-gray-500 bg-white border border-gray-200 rounded px-1 py-px flex-shrink-0">{cat.code}</span>}
        <span className={cn('text-[13px] truncate', isOpen ? 'font-semibold text-gray-900' : 'font-medium text-gray-800')}>{cat.label}</span>
        {u != null && <UtilChip u={u} />}
        <div className="flex-1" />
        <Cell value={cat.budget || null} area={project.area} size="lg" />
        <Cell value={cat.approved || null} area={project.area} size="lg" cls="text-blue-800" />
        <Cell value={cat.spent || null} area={project.area} cls={paidCls(cat.spent, cat.budget, true)} size="lg" />
        <Cell value={cat.budget ? balance : null} area={project.area} cls={balanceCls(balance)} size="lg" />
      </div>

      {isOpen && cat.subcats.length > 0 && (
        <div className="ml-[37px] border-l-2 border-gray-100">
          <div className="pl-4 pt-2 pb-1 flex items-center justify-between gap-2 border-b border-gray-100">
            <span className="text-[10px] uppercase tracking-[0.08em] font-semibold text-gray-500">
              Budget breakdown <span className="font-normal tracking-normal normal-case text-gray-400">· by work item</span>
            </span>
            {hiddenCount > 0 && (
              <button
                type="button"
                onClick={() => toggle(showAllKey)}
                className="text-[10px] font-medium px-2 py-0.5 rounded-md text-gray-500 hover:text-gray-800 hover:bg-gray-100"
                title={showAll ? 'Hide empty work-items' : `Show ${hiddenCount} empty work-items in the BPH template`}
              >
                {showAll ? `Hide ${hiddenCount} empty` : `Show all (${hiddenCount} empty hidden)`}
              </button>
            )}
          </div>
          {shownSubcats.map((sc, j) => {
            const scBal = sc.budget - sc.spent
            return (
              <div key={'sc' + j} className={cn('flex items-center gap-2 pr-3 pl-4 py-1.5 hover:bg-gray-50/60', j > 0 && 'border-t border-gray-50')}>
                {sc.code && <span className="font-mono text-[11px] text-gray-400 flex-shrink-0">{sc.code}</span>}
                <span className="text-[12px] text-gray-600 truncate">{sc.label}</span>
                <div className="flex-1" />
                <Cell value={sc.budget || null} area={project.area} />
                <Cell value={sc.approved || null} area={project.area} cls="text-blue-700" />
                <Cell value={sc.spent || null} area={project.area} />
                <Cell value={sc.budget ? scBal : null} area={project.area} cls={balanceCls(scBal)} />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Admin-only: inline form to add a V2 project (with optional numbers) ─────
function AddProjectInline({ knownGroupNames, onSubmit, onCancel }: {
  knownGroupNames: string[]
  onSubmit: (name: string, group: string | null, area: number | null, nums: { budget: number | null; approved: number | null; paid: number | null }) => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [group, setGroup] = useState<string>('')   // '' = standalone, '__new__' = type-in
  const [newGroup, setNewGroup] = useState('')
  const [area, setArea] = useState('')
  const [budget, setBudget] = useState('')
  const [approved, setApproved] = useState('')
  const [paid, setPaid] = useState('')
  const [busy, setBusy] = useState(false)
  const parse = (s: string): number | null => { const t = s.trim(); if (t === '') return null; const n = Number(t.replace(/,/g, '')); return isFinite(n) ? n : null }

  async function go() {
    if (!name.trim()) return
    setBusy(true)
    const g = group === '__new__' ? (newGroup.trim() || null) : (group || null)
    const a = area.trim() === '' ? null : Number(area)
    try { await onSubmit(name, g, isFinite(a as number) ? (a as number) : null, { budget: parse(budget), approved: parse(approved), paid: parse(paid) }) }
    finally { setBusy(false) }
  }

  return (
    <Card className="border-emerald-300 bg-emerald-50/40">
      <CardContent className="pt-4 space-y-3">
        <div className="flex items-center gap-2">
          <Plus className="h-4 w-4 text-emerald-700" />
          <span className="text-sm font-semibold text-emerald-900">Add a project</span>
          <span className="text-[11px] text-emerald-800">— hand-add one that isn’t in the IN4 upload (e.g. Raj Uphaar); key its numbers in full ₹</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="Project name (e.g. Raj Uphaar)" />
          <select value={group} onChange={e => setGroup(e.target.value)}
            className="h-10 rounded-xl border border-gray-300 bg-white px-3 text-sm">
            <option value="">— Standalone (no group) —</option>
            {knownGroupNames.map(g => <option key={g} value={g}>{g}</option>)}
            <option value="__new__">+ New group…</option>
          </select>
          <Input type="number" min={0} value={area} onChange={e => setArea(e.target.value)} placeholder="Built-up area (sft, optional)" />
        </div>
        {group === '__new__' && (
          <Input value={newGroup} onChange={e => setNewGroup(e.target.value)} placeholder="New group name (e.g. Raj Uphaar)" />
        )}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <Input type="text" inputMode="numeric" value={budget} onChange={e => setBudget(e.target.value)} placeholder="Budget ₹ (e.g. 1015228556)" />
          <Input type="text" inputMode="numeric" value={approved} onChange={e => setApproved(e.target.value)} placeholder="WO/PO Approved ₹" />
          <Input type="text" inputMode="numeric" value={paid} onChange={e => setPaid(e.target.value)} placeholder="Paid ₹" />
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={go} disabled={busy || !name.trim() || (group === '__new__' && !newGroup.trim())}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Add project
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
        </div>
      </CardContent>
    </Card>
  )
}
