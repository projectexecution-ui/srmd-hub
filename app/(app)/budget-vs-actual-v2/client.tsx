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
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  ChevronRight, ChevronsUpDown, ChevronsDownUp, Building2, Folder,
  User, Users, Sparkles, Loader2, Layers, AlertTriangle, ListTree, Search, X,
  Wallet, TrendingUp, Hourglass, Ruler, UploadCloud, Printer, Clock, Plus, Pencil, Check, Ban,
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

function Cell({ value, area, dash, cls, subCls, dashCls, size = 'md' }: {
  value: number | null; area: number | null; dash?: boolean
  /** colour class for the amount (e.g. emerald for healthy spend, rose for over) */
  cls?: string
  /** colour class for the ₹/sft pill */
  subCls?: string
  dashCls?: string
  /** Visual size — 'lg' for project/category header rows, 'md' default for sub-rows. */
  size?: 'md' | 'lg'
}) {
  const isLg = size === 'lg'
  const widthCls = isLg ? 'w-[108px]' : 'w-[100px]'
  const amtCls = isLg ? 'text-[15.5px] font-semibold' : 'text-[14px]'
  if (value == null || dash) return <div className={cn(widthCls, 'text-right flex-shrink-0')}><span className={cn('text-sm', dashCls ?? 'text-gray-300')}>—</span></div>
  const sft = perSft(value, area)
  return (
    <div className={cn(widthCls, 'text-right flex-shrink-0')}>
      <div className={cn(amtCls, 'tabular-nums leading-tight', cls ?? 'text-gray-900')}>{fmtINR(value)}</div>
      {sft && (
        <div className="mt-1 flex justify-end">
          <span className={cn(
            'inline-flex items-baseline gap-0.5 text-[11.5px] tabular-nums px-1.5 py-0.5 rounded-md bg-gray-100/80 border border-gray-200/60',
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

interface Freshness { budget: string | null; contractor: string | null; supplier: string | null }

function fmtAge(iso: string | null): { text: string; stale: boolean } {
  if (!iso) return { text: 'no upload yet', stale: true }
  const t = Date.parse(iso); if (!isFinite(t)) return { text: 'unknown', stale: true }
  const days = Math.floor((Date.now() - t) / (24 * 3600 * 1000))
  let text: string
  if (days <= 0) text = 'today'
  else if (days === 1) text = 'yesterday'
  else if (days < 7) text = `${days} d ago`
  else if (days < 30) text = `${Math.floor(days / 7)} w ago`
  else text = `${Math.floor(days / 30)} mo ago`
  return { text, stale: days >= 14 }
}

export default function BudgetV2Client({
  result, budgetProjectNames, knownGroupNames, currentUserId, isAdmin, freshness,
}: {
  result: ComposeResult
  budgetProjectNames: string[]
  knownGroupNames: string[]
  currentUserId: string
  isAdmin: boolean
  freshness: Freshness
}) {
  const router = useRouter()
  const supabase = createClient()
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [busy, setBusy] = useState<string | null>(null)
  const [addProjectOpen, setAddProjectOpen] = useState(false)
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

  // Admin only — V2 extra project (placeholder; doesn't touch BPH).
  async function addExtraProject(name: string, group_name: string | null, area_sft: number | null) {
    if (!name.trim()) { setError('Project name is required'); return }
    setBusy(`addp:${name}`); setError(null)
    const { error } = await supabase.from('budget_v2_extra_project').upsert(
      { name: name.trim(), group_name: group_name?.trim() || null, area_sft, updated_by: currentUserId, updated_at: new Date().toISOString() },
      { onConflict: 'name' },
    )
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
        <div className="flex items-center gap-1.5 flex-wrap">
          <Link href="/budget-vs-actual-v2/upload"
            className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-800">
            <UploadCloud className="h-3.5 w-3.5" /> Upload
          </Link>
          <Link href="/budget-vs-actual-v2/print"
            className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-800">
            <Printer className="h-3.5 w-3.5" /> Board view
          </Link>
          <span className="text-[11px] font-semibold px-2 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200">Preview · admin only</span>
        </div>
      </PageHeader>

      {/* Freshness strip — at-a-glance: which source data is stale */}
      <div className="grid grid-cols-3 gap-2.5">
        {([
          { key: 'budget', label: 'Budget (BPH)', at: freshness.budget },
          { key: 'contractor', label: 'Contractor', at: freshness.contractor },
          { key: 'supplier', label: 'Supplier', at: freshness.supplier },
        ] as const).map(s => {
          const { text, stale } = fmtAge(s.at)
          return (
            <Link key={s.key} href="/budget-vs-actual-v2/upload"
              className={cn('rounded-xl border px-3 py-2.5 flex items-center gap-2.5 hover:shadow-sm transition-shadow',
                stale ? 'border-amber-200 bg-amber-50/40' : 'border-gray-200 bg-white')}>
              <div className={cn('h-7 w-7 rounded-lg flex items-center justify-center flex-shrink-0',
                stale ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500')}>
                <Clock className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[10px] uppercase tracking-wide text-gray-500">{s.label}</div>
                <div className={cn('text-[13px] font-medium tabular-nums', stale ? 'text-amber-800' : 'text-gray-900')}>{text}</div>
              </div>
              <UploadCloud className="h-4 w-4 text-gray-300 flex-shrink-0" />
            </Link>
          )
        })}
      </div>

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
          onSubmit={async (name, gname, area) => { await addExtraProject(name, gname, area); setAddProjectOpen(false) }}
          onCancel={() => setAddProjectOpen(false)}
        />
      )}

      {needsMapping > 0 && (
        <MappingPanel
          unmatchedProjects={result.unmatchedProjects}
          unmatchedLines={result.unmatchedLines}
          groupNames={groupNames}
          projectNames={budgetProjectNames}
          projectsByGroup={projectsByGroup}
          currentUserId={currentUserId}
          isAdmin={isAdmin}
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
              <div className="min-w-[720px]">
                <div className="flex items-center gap-2 px-4 mb-1">
                  <div className="flex-1 text-[10.5px] uppercase tracking-wide text-gray-400">Project · category · party</div>
                  <div className="w-[108px] text-right text-[10.5px] uppercase tracking-wide text-gray-400">Budget</div>
                  <div className="w-[108px] text-right text-[10.5px] uppercase tracking-wide text-gray-400">Spent</div>
                  <div className="w-[108px] text-right text-[10.5px] uppercase tracking-wide text-gray-400">Outstanding</div>
                </div>
                <div className="space-y-2.5">
                  {g.projects.map(p => (
                    <ProjectCard key={p.name} p={p} open={open} toggle={toggle} forceOpen={searching}
                      groupAvgSft={gAvgSft} isAdmin={isAdmin}
                      onStatus={setStatus} statusBusy={busy === `st:${p.name}`}
                      onArea={setArea} areaBusy={busy === `ar:${p.name}`} />
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
function ProjectCard({ p, open, toggle, forceOpen, groupAvgSft, isAdmin, onStatus, statusBusy, onArea, areaBusy }: {
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
}) {
  const [editingArea, setEditingArea] = useState(false)
  const [areaDraft, setAreaDraft] = useState<string>(p.area ? String(p.area) : '')
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
  const spentLight = u != null && u > 100 ? 'text-rose-700 font-medium' : 'text-emerald-700 font-medium'
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
          <div className="flex-1" />
          <Cell value={p.budget} area={p.area} size="lg" />
          <Cell value={p.spent} area={p.area} cls={spentLight} size="lg" />
          <Cell value={p.outstanding || null} area={p.area} cls="text-amber-700 font-semibold" size="lg" />
        </div>
        {u != null && c && (
          <div className="mt-2 h-[5px] rounded-full bg-gray-100 overflow-hidden">
            <div className="h-full rounded-full transition-[width]" style={{ width: `${Math.min(u, 100)}%`, background: c.bar }} />
          </div>
        )}
        {caption && <div className="mt-1.5 text-[11px] text-gray-500">{caption}</div>}
      </div>

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
  const u = cat.hasBudget ? utilPct(cat.spent, cat.budget) : null
  const hasChildren = cat.subcats.length > 0 || cat.parties.length > 0
  const spentCls = u != null && u > 100 ? 'text-rose-600 font-medium' : 'text-emerald-700 font-medium'
  // BPH exports many empty placeholder sub-rows (IN4 stores the full work-item
  // checklist even when nothing's been spent on most of them). They drown the
  // real numbers, so hide zero-only rows by default; user can reveal.
  const subcatsWithValue = cat.subcats.filter(sc => sc.budget !== 0 || sc.spent !== 0)
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
        {!cat.hasBudget && <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-100 flex-shrink-0">payments only</span>}
        {u != null && <UtilChip u={u} />}
        <div className="flex-1" />
        <Cell value={cat.hasBudget ? cat.budget : null} area={project.area} dash={!cat.hasBudget} size="lg" />
        <Cell value={cat.hasBudget ? cat.spent : null} area={project.area} dash={!cat.hasBudget} cls={spentCls} size="lg" />
        <Cell value={cat.outstanding || null} area={project.area} cls="text-amber-700 font-semibold" size="lg" />
      </div>

      {isOpen && (
        <div className="ml-[37px] border-l-2 border-gray-100">
          {cat.subcats.length > 0 && (
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
          )}
          {shownSubcats.map((sc, j) => (
            <div key={'sc' + j} className={cn('flex items-center gap-2 pr-3 pl-4 py-1.5 hover:bg-gray-50/60', j > 0 && 'border-t border-gray-50')}>
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
                {/* Paid-to banner — emphasised section header inside a category */}
                <div className={cn('flex items-center gap-2.5 pr-3 pl-4 py-2 cursor-pointer transition-colors border-t border-gray-100',
                  pOpen ? 'bg-violet-50/40 hover:bg-violet-50/60' : 'bg-gray-50/40 hover:bg-gray-100/50')}
                  onClick={() => toggle(pkk)}>
                  <ChevronRight className={cn('h-3.5 w-3.5 flex-shrink-0 transition-transform', pOpen ? 'text-violet-500 rotate-90' : 'text-gray-400')} />
                  {/* avatar-stack chip */}
                  <div className="flex items-center -space-x-1 flex-shrink-0">
                    {conN > 0 && (
                      <span className="h-5 w-5 rounded-full bg-violet-100 text-violet-700 border border-white inline-flex items-center justify-center" title={`${conN} contractor${conN === 1 ? '' : 's'}`}>
                        <Users className="h-2.5 w-2.5" />
                      </span>
                    )}
                    {supN > 0 && (
                      <span className="h-5 w-5 rounded-full bg-blue-100 text-blue-700 border border-white inline-flex items-center justify-center" title={`${supN} supplier${supN === 1 ? '' : 's'}`}>
                        <User className="h-2.5 w-2.5" />
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] uppercase tracking-[0.08em] font-semibold text-gray-500 flex-shrink-0">Paid to</span>
                  <span className="text-[12px] text-gray-700 truncate">
                    {conN > 0 && <span className="text-violet-700 font-medium">{conN} contractor{conN === 1 ? '' : 's'}</span>}
                    {conN > 0 && supN > 0 && <span className="text-gray-300 mx-1">·</span>}
                    {supN > 0 && <span className="text-blue-700 font-medium">{supN} supplier{supN === 1 ? '' : 's'}</span>}
                    {conN === 0 && supN === 0 && 'parties'}
                  </span>
                  <span className="text-[10px] text-gray-400 flex-shrink-0 hidden sm:inline">{pOpen ? 'tap to hide' : 'tap to expand'}</span>
                  <div className="flex-1" />
                  <Cell value={null} area={project.area} dash size="lg" />
                  <Cell value={paidSum || null} area={project.area} cls="text-gray-900 font-semibold" size="lg" />
                  <Cell value={outSum || null} area={project.area} cls="text-amber-700 font-semibold" size="lg" />
                </div>
                {pOpen && cat.parties.map((pt, j) => (
                  <div key={'pt' + j} className={cn('flex items-center gap-2 pr-3 pl-9 py-1.5 hover:bg-gray-50/60', j > 0 && 'border-t border-gray-50')}>
                    <span className={cn('h-4 w-4 rounded-full inline-flex items-center justify-center flex-shrink-0',
                      pt.source === 'contractor' ? 'bg-violet-100 text-violet-700' : 'bg-blue-100 text-blue-700')}>
                      {pt.source === 'contractor' ? <Users className="h-2 w-2" /> : <User className="h-2 w-2" />}
                    </span>
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
function MappingPanel({ unmatchedProjects, unmatchedLines, groupNames, projectNames, projectsByGroup, currentUserId, isAdmin, onError, onSaved }: {
  unmatchedProjects: UnmatchedProject[]
  unmatchedLines: UnmatchedLine[]
  groupNames: string[]
  projectNames: string[]
  projectsByGroup: Record<string, string[]>
  currentUserId: string
  isAdmin: boolean
  onError: (m: string) => void
  onSaved: () => void
}) {
  const supabase = createClient()
  const [picks, setPicks] = useState<Record<string, string>>({})
  const [aiBusy, setAiBusy] = useState(false)
  const [saveBusy, setSaveBusy] = useState(false)
  const [dropBusy, setDropBusy] = useState<string | null>(null)
  // Collapsed by default once any picks are made or once the user dismisses —
  // keeps a long mapping list out of the way while still one click to reopen.
  const [collapsed, setCollapsed] = useState(false)
  const pk = (source: string, name: string) => `${source}::${name}`
  const totalToMap = unmatchedProjects.length + unmatchedLines.length

  // One-click DROP: persist this payment as intentionally ignored (alias row
  // with budget_project = null + confirmed = true). Next render it disappears
  // from the unmatched list — without going through the dropdown.
  async function dropOne(source: string, name: string) {
    if (!isAdmin) return
    setDropBusy(pk(source, name)); onError('')
    const { error } = await supabase.from('budget_v2_alias').upsert(
      { source, payment_name: name, budget_project: null, confirmed: true, updated_by: currentUserId, updated_at: new Date().toISOString() },
      { onConflict: 'source,payment_name' },
    )
    setDropBusy(null)
    if (error) { onError(error.message); return }
    onSaved()
  }

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
          <button
            type="button"
            onClick={() => setCollapsed(c => !c)}
            className="flex items-center gap-2 text-left hover:opacity-80"
            aria-expanded={!collapsed}
            aria-controls="bv2-mapping-body"
            title={collapsed ? 'Show mapping list' : 'Hide mapping list'}
          >
            <ChevronRight className={cn('h-4 w-4 text-amber-700 flex-shrink-0 transition-transform', !collapsed && 'rotate-90')} />
            <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0" />
            <span className="font-semibold text-sm text-amber-900">Match payments to budget projects</span>
            <span className="text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
              {totalToMap} to map
            </span>
          </button>
          <div className="flex items-center gap-1.5">
            {unmatchedProjects.length > 0 && (
              <Button size="sm" variant="outline" onClick={autoMap} disabled={aiBusy} className="text-violet-700 border-violet-200 hover:bg-violet-50">
                {aiBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Auto-map with AI
              </Button>
            )}
            <button
              type="button"
              onClick={() => setCollapsed(c => !c)}
              className="text-[11px] font-medium px-2 py-1 rounded-md text-amber-800 hover:bg-amber-100/60"
            >
              {collapsed ? 'Show' : 'Hide'}
            </button>
          </div>
        </div>

        {!collapsed && (
          <div id="bv2-mapping-body" className="space-y-3">
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
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => dropOne(u.source, u.projectName)}
                          disabled={dropBusy === pk(u.source, u.projectName)}
                          className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md text-rose-700 border border-rose-200 hover:bg-rose-50"
                          title="Don't map this — keep its payments out of the tree"
                        >
                          {dropBusy === pk(u.source, u.projectName) ? <Loader2 className="h-3 w-3 animate-spin" /> : <Ban className="h-3 w-3" />}
                          Drop
                        </button>
                      )}
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
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => dropOne(u.source, u.subprojectName)}
                          disabled={dropBusy === pk(u.source, u.subprojectName)}
                          className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md text-rose-700 border border-rose-200 hover:bg-rose-50"
                          title="Don't map this line — keep its payments out of the tree"
                        >
                          {dropBusy === pk(u.source, u.subprojectName) ? <Loader2 className="h-3 w-3 animate-spin" /> : <Ban className="h-3 w-3" />}
                          Drop
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Button size="sm" onClick={save} disabled={saveBusy}>
              {saveBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListTree className="h-4 w-4" />} Save & merge
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Admin-only: inline form to add a V2 project (placeholder) ──────────────
function AddProjectInline({ knownGroupNames, onSubmit, onCancel }: {
  knownGroupNames: string[]
  onSubmit: (name: string, group: string | null, area: number | null) => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [group, setGroup] = useState<string>('')   // '' = standalone, '__new__' = type-in
  const [newGroup, setNewGroup] = useState('')
  const [area, setArea] = useState('')
  const [busy, setBusy] = useState(false)

  async function go() {
    if (!name.trim()) return
    setBusy(true)
    const g = group === '__new__' ? (newGroup.trim() || null) : (group || null)
    const a = area.trim() === '' ? null : Number(area)
    try { await onSubmit(name, g, isFinite(a as number) ? (a as number) : null) }
    finally { setBusy(false) }
  }

  return (
    <Card className="border-emerald-300 bg-emerald-50/40">
      <CardContent className="pt-4 space-y-3">
        <div className="flex items-center gap-2">
          <Plus className="h-4 w-4 text-emerald-700" />
          <span className="text-sm font-semibold text-emerald-900">New project</span>
          <span className="text-[11px] text-emerald-800">— placeholder; appears in the tree alongside BPH projects</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="Project name (e.g. NGH D)" />
          <select value={group} onChange={e => setGroup(e.target.value)}
            className="h-10 rounded-xl border border-gray-300 bg-white px-3 text-sm">
            <option value="">— Standalone (no group) —</option>
            {knownGroupNames.map(g => <option key={g} value={g}>{g}</option>)}
            <option value="__new__">+ New group…</option>
          </select>
          <Input type="number" min={0} value={area} onChange={e => setArea(e.target.value)} placeholder="Built-up area (sft, optional)" />
        </div>
        {group === '__new__' && (
          <Input value={newGroup} onChange={e => setNewGroup(e.target.value)} placeholder="New group name (e.g. Phase 3)" />
        )}
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
