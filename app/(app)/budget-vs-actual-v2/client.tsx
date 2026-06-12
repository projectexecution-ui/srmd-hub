'use client'
// Budget vs Actual V2 — modern preview client. Read-only over the 3 source
// modules; writes only the per-project status + the confirmed alias map.
//
// HOD requirements baked in: one snapshot tree (Group → Project → Category →
// Sub-Category → Party), ₹/sft under every amount, IN4-style Open/Closed with
// open on top, groups alphabetical, expandable/collapsible everywhere.
// "Modern" layer: live tree search, status filter chips, expand/collapse all,
// computed watchlist (top overruns + biggest outstanding), per-category
// utilisation bars, indent guide lines.

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  ChevronRight, ChevronDown, ChevronsUpDown, ChevronsDownUp, Building2, Folder,
  User, Users, Sparkles, Loader2, Layers, AlertTriangle, ListTree, Search, X,
  Wallet, TrendingUp, Hourglass, Ruler,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ComposeResult, CatNode, ProjectNode, GroupNode, UnmatchedProject, UnmatchedLine } from '@/lib/budget-v2'

// ─── formatting helpers ──────────────────────────────────────────────────────
function fmtINR(v: number): string {
  if (!isFinite(v) || v === 0) return '₹0'
  const a = Math.abs(v)
  if (a >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`
  if (a >= 1e5) return `₹${(v / 1e5).toFixed(2)} L`
  if (a >= 1e3) return `₹${(v / 1e3).toFixed(1)} K`
  return `₹${Math.round(v).toLocaleString('en-IN')}`
}
function perSft(v: number, area: number | null): string {
  if (!area || area <= 0 || !isFinite(v) || v === 0) return ''
  return `₹${Math.round(v / area).toLocaleString('en-IN')}/sft`
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

function Cell({ value, area, dash, cls, subCls, dashCls }: {
  value: number | null; area: number | null; dash?: boolean
  /** colour class for the amount (e.g. emerald for healthy spend, rose for over) */
  cls?: string
  /** colour class for the ₹/sft line */
  subCls?: string
  dashCls?: string
}) {
  if (value == null || dash) return <div className="w-[88px] text-right flex-shrink-0"><span className={cn('text-xs', dashCls ?? 'text-gray-300')}>—</span></div>
  const sft = perSft(value, area)
  return (
    <div className="w-[88px] text-right flex-shrink-0">
      <div className={cn('text-[13px] tabular-nums', cls ?? 'text-gray-900')}>{fmtINR(value)}</div>
      {sft && <div className={cn('text-[11px] tabular-nums', subCls ?? 'text-gray-400')}>{sft}</div>}
    </div>
  )
}
function UtilChip({ u }: { u: number }) {
  const c = utilColors(u)
  return <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: c.bg, color: c.fg }}>{u > 100 ? `${u}% over` : `${u}%`}</span>
}
function SourceTag({ source }: { source: 'contractor' | 'supplier' }) {
  return (
    <span className="text-[9px] px-1.5 py-0.5 rounded flex-shrink-0"
      style={source === 'contractor' ? { background: '#EEEDFE', color: '#3C3489' } : { background: '#E6F1FB', color: '#0C447C' }}>
      {source}
    </span>
  )
}

// ─── main client ─────────────────────────────────────────────────────────────
type StatusFilter = 'all' | 'open' | 'closed'

export default function BudgetV2Client({
  result, budgetProjectNames, currentUserId,
}: {
  result: ComposeResult
  budgetProjectNames: string[]
  currentUserId: string
}) {
  const router = useRouter()
  const supabase = createClient()
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [busy, setBusy] = useState<string | null>(null)
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
          const parties = c.parties.filter(pt => match(pt.name))
          return (subcats.length || parties.length) ? { ...c, subcats, parties } : null
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
      p.categories.forEach((c, i) => { keys.add(`cat:${p.name}:${c.code}:${i}`); keys.add(`cat:${p.name}:${c.code}:${i}:parties`) })
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

  // ── KPIs + computed watchlist (no AI call needed — pure maths) ──
  const t = result.totals
  const spentPct = t.budget > 0 ? Math.round((t.spent / t.budget) * 100) : 0
  const avgSft = t.area > 0 ? Math.round(t.spent / t.area) : 0
  const allProjects = result.groups.flatMap(g => g.projects)
  const overruns = allProjects
    .flatMap(p => p.categories.filter(c => c.hasBudget).map(c => ({ proj: p.name, cat: c.label, u: utilPct(c.spent, c.budget) ?? 0 })))
    .filter(x => x.u > 100)
    .sort((a, b) => b.u - a.u)
  const topOut = [...allProjects].sort((a, b) => b.outstanding - a.outstanding)[0]
  const needsMapping = result.unmatchedProjects.length + result.unmatchedLines.length
  const groupNames = result.groups.map(g => g.name).filter(n => n !== '— Ungrouped')
  const projectsByGroup: Record<string, string[]> = {}
  for (const g of result.groups) projectsByGroup[g.name] = g.projects.map(p => p.name)

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <PageHeader title="Budget vs Actual V2" back="/dashboard"
        subtitle="One snapshot — budget, contractor & supplier payments in a single tree, with ₹/sft.">
        <span className="text-[11px] font-semibold px-2 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200">Preview · admin only</span>
      </PageHeader>

      {error && <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-sm text-rose-700">{error}</div>}

      {/* ── KPI strip ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <Metric icon={<Wallet className="h-4 w-4" />} tone="slate" label="Total budget" value={fmtINR(t.budget)} />
        <Metric icon={<TrendingUp className="h-4 w-4" />} tone={spentPct > 100 ? 'rose' : 'emerald'} label={`Spent · ${spentPct}% of budget`} value={fmtINR(t.spent)} />
        <Metric icon={<Hourglass className="h-4 w-4" />} tone="amber" label="Outstanding" value={fmtINR(t.outstanding)} />
        <Metric icon={<Ruler className="h-4 w-4" />} tone="blue" label="Avg ₹/sft spent" value={avgSft > 0 ? `₹${avgSft.toLocaleString('en-IN')}` : '—'} />
      </div>

      {/* ── Watchlist (computed) ── */}
      <div className="flex items-start gap-2.5 bg-white border border-gray-200 rounded-2xl px-3.5 py-3">
        <Sparkles className="h-4 w-4 text-violet-600 flex-shrink-0 mt-1" />
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[12px] font-semibold text-gray-700 mr-0.5">Watchlist</span>
          {overruns.length === 0 && <span className="text-[11px] px-2 py-1 rounded-full" style={{ background: '#EAF3DE', color: '#27500A' }}>All categories within budget</span>}
          {overruns.slice(0, 3).map((o, i) => (
            <button key={i} type="button" onClick={() => setQuery(o.cat)}
              className="text-[11px] px-2 py-1 rounded-full hover:opacity-80" style={{ background: '#FCEBEB', color: '#A32D2D' }}
              title={`${o.proj} · ${o.cat} is at ${o.u}% of budget — click to focus`}>
              {o.proj} · {o.cat} {o.u}%
            </button>
          ))}
          {overruns.length > 3 && <span className="text-[11px] text-gray-400">+{overruns.length - 3} more</span>}
          {topOut && topOut.outstanding > 0 && (
            <button type="button" onClick={() => setQuery(topOut.name)}
              className="text-[11px] px-2 py-1 rounded-full hover:opacity-80" style={{ background: '#FAEEDA', color: '#854F0B' }}
              title="Largest outstanding — click to focus">
              Most outstanding: {topOut.name} {fmtINR(topOut.outstanding)}
            </button>
          )}
        </div>
      </div>

      {/* ── Controls: search + status chips + expand/collapse ── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
          <Input value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search project, category or party…" className="pl-9 pr-8" />
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
          <Button size="sm" variant="outline" onClick={expandAll} title="Expand everything">
            <ChevronsUpDown className="h-3.5 w-3.5" /> Expand all
          </Button>
          <Button size="sm" variant="outline" onClick={() => setOpen(new Set())} title="Collapse everything">
            <ChevronsDownUp className="h-3.5 w-3.5" /> Collapse all
          </Button>
        </div>
      </div>

      {needsMapping > 0 && (
        <MappingPanel
          unmatchedProjects={result.unmatchedProjects}
          unmatchedLines={result.unmatchedLines}
          groupNames={groupNames}
          projectNames={budgetProjectNames}
          projectsByGroup={projectsByGroup}
          currentUserId={currentUserId}
          onError={setError}
          onSaved={() => router.refresh()}
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
                budget {fmtINR(gBudget)} · spent {fmtINR(gSpent)}{gu != null ? ` · ${gu}%` : ''}{gAvgSft != null ? ` · avg ₹${Math.round(gAvgSft).toLocaleString('en-IN')}/sft` : ''}
              </span>
            </div>
            {gu != null && (
              <div className="h-[4px] rounded-full bg-gray-100 overflow-hidden mx-1 mb-2">
                <div className="h-full rounded-full" style={{ width: `${Math.min(gu, 100)}%`, background: utilColors(gu).bar }} />
              </div>
            )}
            {/* Horizontal scroll on narrow screens so the 3 amount columns never wrap/overflow */}
            <div className="overflow-x-auto">
              <div className="min-w-[640px]">
                <div className="flex items-center gap-2 px-4 mb-1">
                  <div className="flex-1 text-[10px] uppercase tracking-wide text-gray-400">Project · category · party</div>
                  <div className="w-[88px] text-right text-[10px] uppercase tracking-wide text-gray-400">Budget</div>
                  <div className="w-[88px] text-right text-[10px] uppercase tracking-wide text-gray-400">Spent</div>
                  <div className="w-[88px] text-right text-[10px] uppercase tracking-wide text-gray-400">Outstanding</div>
                </div>
                <div className="space-y-2.5">
                  {g.projects.map(p => (
                    <ProjectCard key={p.name} p={p} open={open} toggle={toggle} forceOpen={searching}
                      groupAvgSft={gAvgSft} onStatus={setStatus} statusBusy={busy === `st:${p.name}`} />
                  ))}
                </div>
              </div>
            </div>
          </section>
        )
      })}

      <p className="text-[11px] text-gray-400 px-1 leading-relaxed">
        ₹/sft under every amount · open on top, closed dimmed · status saved per project, survives re-uploads.
        Inside a category, <b className="font-medium">Budget breakdown</b> (by work item) and <b className="font-medium">Paid to</b> (by
        contractor/supplier) are two views of the same category total — each reconciles to the category, they don’t add to each other.
      </p>
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

// ─── project card — dark header band (Contractor-Report style) ──────────────
function ProjectCard({ p, open, toggle, forceOpen, groupAvgSft, onStatus, statusBusy }: {
  p: ProjectNode
  open: Set<string>
  toggle: (k: string) => void
  forceOpen: boolean
  groupAvgSft: number | null
  onStatus: (name: string, next: 'open' | 'closed') => void
  statusBusy: boolean
}) {
  const pk = `proj:${p.name}`
  const isOpen = forceOpen || open.has(pk)
  const u = utilPct(p.spent, p.budget)
  const c = u != null ? utilColors(u) : null
  const mySft = p.area && p.area > 0 ? p.spent / p.area : null

  // "₹719/sft spent · 11% above group avg" caption
  let caption = ''
  if (u != null) caption += `${u}% of budget used`
  if (mySft != null) caption += `${caption ? ' · ' : ''}₹${Math.round(mySft).toLocaleString('en-IN')}/sft spent`
  if (mySft != null && groupAvgSft != null && groupAvgSft > 0) {
    const d = Math.round(((mySft - groupAvgSft) / groupAvgSft) * 100)
    caption += Math.abs(d) < 1 ? ' · at group avg' : ` · ${Math.abs(d)}% ${d > 0 ? 'above' : 'below'} group avg`
  }

  const spentCls = u != null && u > 100 ? 'text-rose-300 font-medium' : 'text-emerald-300 font-medium'
  return (
    <div className={cn('border border-slate-200 rounded-2xl overflow-hidden bg-white transition-shadow hover:shadow-md', p.status === 'closed' && 'opacity-55')}>
      {/* dark header band */}
      <div className="bg-slate-800 px-3 py-2.5 cursor-pointer hover:bg-slate-700/90 transition-colors" onClick={() => toggle(pk)}>
        <div className="flex items-center gap-2">
          <ChevronRight className={cn('h-4 w-4 text-slate-400 flex-shrink-0 transition-transform', isOpen && 'rotate-90')} />
          <div className="h-7 w-7 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
            <Building2 className="h-4 w-4 text-slate-200" />
          </div>
          <span className="font-semibold text-sm text-white truncate">{p.name}</span>
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
          {p.area && <span className="text-[10px] text-slate-400 flex-shrink-0">{p.area.toLocaleString('en-IN')} sft</span>}
          {u != null && <UtilChip u={u} />}
          <div className="flex-1" />
          <Cell value={p.budget} area={p.area} cls="text-white font-medium" subCls="text-slate-400" dashCls="text-slate-500" />
          <Cell value={p.spent} area={p.area} cls={spentCls} subCls="text-slate-400" dashCls="text-slate-500" />
          <Cell value={p.outstanding || null} area={p.area} cls="text-amber-300 font-medium" subCls="text-slate-400" dashCls="text-slate-500" />
        </div>
        {u != null && c && (
          <div className="mt-2 h-[5px] rounded-full bg-white/15 overflow-hidden">
            <div className="h-full rounded-full transition-[width]" style={{ width: `${Math.min(u, 100)}%`, background: c.bar }} />
          </div>
        )}
        {caption && <div className="mt-1.5 text-[11px] text-slate-400">{caption}</div>}
      </div>

      {isOpen && (
        <div>
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
  const u = cat.hasBudget ? utilPct(cat.spent, cat.budget) : null
  const hasChildren = cat.subcats.length > 0 || cat.parties.length > 0
  const spentCls = u != null && u > 100 ? 'text-rose-600 font-medium' : 'text-emerald-700 font-medium'
  return (
    <div>
      {/* category band — light slate-blue, like the Contractor Report category headers */}
      <div className={cn('flex items-center gap-2 pr-3 py-2 border-t border-slate-200/60 bg-slate-100/70', hasChildren && 'cursor-pointer hover:bg-slate-200/50')}
        onClick={() => hasChildren && toggle(ck)} style={{ paddingLeft: 30 }}>
        {hasChildren
          ? <ChevronRight className={cn('h-3.5 w-3.5 text-slate-400 flex-shrink-0 transition-transform', isOpen && 'rotate-90')} />
          : <span className="w-3.5 flex-shrink-0" />}
        <Folder className="h-3.5 w-3.5 text-slate-500 flex-shrink-0" />
        {cat.code && <span className="font-mono text-[10px] text-slate-600 bg-white border border-slate-200 rounded px-1 py-px flex-shrink-0">{cat.code}</span>}
        <span className="text-[13px] font-medium text-slate-800 truncate">{cat.label}</span>
        {!cat.hasBudget && <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-100 flex-shrink-0">payments only</span>}
        {u != null && <UtilChip u={u} />}
        <div className="flex-1" />
        <Cell value={cat.hasBudget ? cat.budget : null} area={project.area} dash={!cat.hasBudget} />
        <Cell value={cat.hasBudget ? cat.spent : null} area={project.area} dash={!cat.hasBudget} cls={spentCls} />
        <Cell value={cat.outstanding || null} area={project.area} cls="text-amber-700 font-medium" />
      </div>

      {isOpen && (
        <div className="ml-[37px] border-l-2 border-gray-100">
          {cat.subcats.length > 0 && (
            <div className="pl-4 pt-1.5 text-[10px] uppercase tracking-wide text-gray-400">
              Budget breakdown <span className="normal-case text-gray-300">(by work item)</span>
            </div>
          )}
          {cat.subcats.map((sc, j) => (
            <div key={'sc' + j} className="flex items-center gap-2 pr-3 pl-4 py-1.5 border-t border-gray-50 first:border-t-0">
              {sc.code && <span className="font-mono text-[11px] text-gray-400 flex-shrink-0">{sc.code}</span>}
              <span className="text-[12px] text-gray-600 truncate">{sc.label}</span>
              <div className="flex-1" />
              <Cell value={sc.budget} area={project.area} />
              <Cell value={sc.spent} area={project.area} />
              <Cell value={null} area={project.area} dash />
            </div>
          ))}
          {cat.parties.length > 0 && (() => {
            const pkk = ck + ':parties'
            const pOpen = forceOpen || open.has(pkk)
            const paidSum = cat.parties.reduce((s, p) => s + p.paid, 0)
            const outSum = cat.parties.reduce((s, p) => s + p.outstanding, 0)
            const conN = cat.parties.filter(p => p.source === 'contractor').length
            const supN = cat.parties.length - conN
            return (
              <>
                <div className="flex items-center gap-2 pr-3 pl-4 py-1.5 border-t border-gray-50 cursor-pointer hover:bg-gray-50" onClick={() => toggle(pkk)}>
                  <ChevronRight className={cn('h-3.5 w-3.5 text-gray-400 flex-shrink-0 transition-transform', pOpen && 'rotate-90')} />
                  <Users className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                  <span className="text-[10px] uppercase tracking-wide text-gray-400 flex-shrink-0">Paid to</span>
                  <span className="text-[12px] text-gray-500">
                    {conN > 0 && `${conN} contractor${conN === 1 ? '' : 's'}`}{conN > 0 && supN > 0 && ' · '}{supN > 0 && `${supN} supplier${supN === 1 ? '' : 's'}`}{conN === 0 && supN === 0 && 'parties'}
                  </span>
                  <div className="flex-1" />
                  <Cell value={null} area={project.area} dash />
                  <Cell value={paidSum || null} area={project.area} cls="text-gray-800 font-medium" />
                  <Cell value={outSum || null} area={project.area} cls="text-amber-700 font-medium" />
                </div>
                {pOpen && cat.parties.map((pt, j) => (
                  <div key={'pt' + j} className="flex items-center gap-2 pr-3 pl-9 py-1.5 border-t border-gray-50 hover:bg-gray-50/60">
                    <User className="h-3 w-3 text-gray-400 flex-shrink-0" />
                    <span className="text-[12px] text-gray-700 truncate">{pt.name}</span>
                    <SourceTag source={pt.source} />
                    <div className="flex-1" />
                    <Cell value={null} area={project.area} dash />
                    <Cell value={pt.paid} area={project.area} />
                    <Cell value={pt.outstanding || null} area={project.area} cls="text-amber-600" />
                  </div>
                ))}
              </>
            )
          })()}
        </div>
      )}
    </div>
  )
}

// ─── AI-assisted mapping panel (project-level + leftover lines) ──────────────
function MappingPanel({ unmatchedProjects, unmatchedLines, groupNames, projectNames, projectsByGroup, currentUserId, onError, onSaved }: {
  unmatchedProjects: UnmatchedProject[]
  unmatchedLines: UnmatchedLine[]
  groupNames: string[]
  projectNames: string[]
  projectsByGroup: Record<string, string[]>
  currentUserId: string
  onError: (m: string) => void
  onSaved: () => void
}) {
  const supabase = createClient()
  const [picks, setPicks] = useState<Record<string, string>>({})
  const [aiBusy, setAiBusy] = useState(false)
  const [saveBusy, setSaveBusy] = useState(false)
  const pk = (source: string, name: string) => `${source}::${name}`

  async function autoMap() {
    setAiBusy(true); onError('')
    try {
      const res = await fetch('/api/budget-v2/suggest-aliases', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          payments: unmatchedProjects.map(u => ({ source: u.source, name: u.projectName })),
          budgetProjects: [...groupNames, ...projectNames],
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || 'AI failed')
      const next: Record<string, string> = {}
      for (const s of json.suggestions ?? []) if (s.budget_project) next[pk(s.source, s.name)] = s.budget_project
      setPicks(p => ({ ...next, ...p }))
    } catch (e) { onError(e instanceof Error ? e.message : 'AI failed') }
    finally { setAiBusy(false) }
  }

  async function save() {
    const rows: { source: string; payment_name: string; budget_project: string | null; confirmed: boolean; updated_by: string; updated_at: string }[] = []
    const push = (source: string, name: string) => {
      const v = picks[pk(source, name)]
      if (!v) return
      rows.push({ source, payment_name: name, budget_project: v === '__ignore__' ? null : v, confirmed: true, updated_by: currentUserId, updated_at: new Date().toISOString() })
    }
    unmatchedProjects.forEach(u => push(u.source, u.projectName))
    unmatchedLines.forEach(u => push(u.source, u.subprojectName))
    if (rows.length === 0) { onError('Pick at least one match (or “ignore”) first.'); return }
    setSaveBusy(true); onError('')
    const { error } = await supabase.from('budget_v2_alias').upsert(rows, { onConflict: 'source,payment_name' })
    setSaveBusy(false)
    if (error) { onError(error.message); return }
    onSaved()
  }

  return (
    <Card className="border-amber-300 bg-amber-50/40">
      <CardContent className="pt-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <span className="font-semibold text-sm text-amber-900">Match payments to budget projects</span>
          </div>
          {unmatchedProjects.length > 0 && (
            <Button size="sm" variant="outline" onClick={autoMap} disabled={aiBusy} className="text-violet-700 border-violet-200 hover:bg-violet-50">
              {aiBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Auto-map with AI
            </Button>
          )}
        </div>

        {unmatchedProjects.length > 0 && (
          <div>
            <p className="text-[11px] text-amber-800 mb-1">
              Map each <b>payment project</b> to a budget <b>group</b> (the A/B/C blocks sort themselves out) — tap <b>Auto-map</b>, glance, save.
            </p>
            <div className="divide-y divide-amber-200">
              {unmatchedProjects.map(u => (
                <div key={pk(u.source, u.projectName)} className="flex items-center gap-2 py-2 flex-wrap">
                  <SourceTag source={u.source} />
                  <span className="text-[13px] text-gray-800 flex-1 min-w-[150px] truncate" title={u.projectName}>{u.projectName}</span>
                  <span className="text-[11px] text-gray-400 flex-shrink-0">{u.subCount} line{u.subCount === 1 ? '' : 's'} · {fmtINR(u.paid)}</span>
                  <ChevronRight className="h-3.5 w-3.5 text-gray-300 flex-shrink-0" />
                  <select value={picks[pk(u.source, u.projectName)] ?? ''}
                    onChange={e => setPicks(p => ({ ...p, [pk(u.source, u.projectName)]: e.target.value }))}
                    className="h-8 rounded-lg border border-gray-300 bg-white px-2 text-xs max-w-[190px]">
                    <option value="">— pick a group / project —</option>
                    {groupNames.length > 0 && <optgroup label="Groups">{groupNames.map(g => <option key={'g' + g} value={g}>{g} (group)</option>)}</optgroup>}
                    <optgroup label="Projects">{projectNames.map(p => <option key={'p' + p} value={p}>{p}</option>)}</optgroup>
                    <option value="__ignore__">— ignore this —</option>
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}

        {unmatchedLines.length > 0 && (
          <div className="pt-1">
            <p className="text-[11px] text-amber-800 mb-1">
              These few lines are inside a mapped group but couldn’t auto-pick a block — place them once:
            </p>
            <div className="divide-y divide-amber-200">
              {unmatchedLines.map(u => (
                <div key={pk(u.source, u.subprojectName)} className="flex items-center gap-2 py-2 flex-wrap">
                  <SourceTag source={u.source} />
                  <span className="text-[13px] text-gray-800 flex-1 min-w-[150px] truncate" title={u.subprojectName}>{u.subprojectName}</span>
                  <span className="text-[10px] text-gray-400 flex-shrink-0">{u.group}</span>
                  <ChevronRight className="h-3.5 w-3.5 text-gray-300 flex-shrink-0" />
                  <select value={picks[pk(u.source, u.subprojectName)] ?? ''}
                    onChange={e => setPicks(p => ({ ...p, [pk(u.source, u.subprojectName)]: e.target.value }))}
                    className="h-8 rounded-lg border border-gray-300 bg-white px-2 text-xs max-w-[190px]">
                    <option value="">— pick project in {u.group} —</option>
                    {(projectsByGroup[u.group] ?? []).map(p => <option key={p} value={p}>{p}</option>)}
                    <option value="__ignore__">— ignore this —</option>
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}

        <Button size="sm" onClick={save} disabled={saveBusy}>
          {saveBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListTree className="h-4 w-4" />} Save & merge
        </Button>
      </CardContent>
    </Card>
  )
}
