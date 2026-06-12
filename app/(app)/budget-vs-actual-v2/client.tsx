'use client'
// Budget vs Actual V2 — preview client. Renders the composed tree (read-only
// over the 3 source modules). Writes only to budget_v2_project_status (toggle)
// and budget_v2_alias (AI-suggested → admin-confirmed name mapping), then
// router.refresh() recomputes server-side.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  ChevronRight, ChevronDown, Building2, Folder, User, Sparkles, Loader2, Layers, AlertTriangle, ListTree,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ComposeResult, CatNode, ProjectNode, UnmatchedProject, UnmatchedLine } from '@/lib/budget-v2'

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

function Cell({ value, area, dash }: { value: number | null; area: number | null; dash?: boolean }) {
  if (value == null || dash) return <div className="w-[88px] text-right flex-shrink-0"><span className="text-xs text-gray-400">—</span></div>
  const sft = perSft(value, area)
  return (
    <div className="w-[88px] text-right flex-shrink-0">
      <div className="text-[13px] text-gray-900 tabular-nums">{fmtINR(value)}</div>
      {sft && <div className="text-[11px] text-gray-400 tabular-nums">{sft}</div>}
    </div>
  )
}
function UtilChip({ u }: { u: number }) {
  const c = utilColors(u)
  return <span className="text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: c.bg, color: c.fg }}>{u > 100 ? `${u}% over` : `${u}%`}</span>
}

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
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const toggle = (k: string) => setOpen(p => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n })

  async function setStatus(projectName: string, next: 'open' | 'closed') {
    setBusy(`st:${projectName}`); setError(null)
    const { error } = await supabase.from('budget_v2_project_status')
      .upsert({ project_name: projectName, status: next, updated_by: currentUserId, updated_at: new Date().toISOString() }, { onConflict: 'project_name' })
    setBusy(null)
    if (error) { setError(error.message); return }
    router.refresh()
  }

  const t = result.totals
  const spentPct = t.budget > 0 ? Math.round((t.spent / t.budget) * 100) : 0
  const avgSft = t.area > 0 ? Math.round(t.spent / t.area) : 0
  const overCount = result.groups.flatMap(g => g.projects).filter(p => (utilPct(p.spent, p.budget) ?? 0) > 100).length
  const needsMapping = result.unmatchedProjects.length + result.unmatchedLines.length
  // Budget targets for the mapping dropdowns: real groups first, then projects.
  const groupNames = result.groups.map(g => g.name).filter(n => n !== '— Ungrouped')
  const projectsByGroup: Record<string, string[]> = {}
  for (const g of result.groups) projectsByGroup[g.name] = g.projects.map(p => p.name)

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <PageHeader title="Budget vs Actual V2" back="/dashboard"
        subtitle="Consolidated snapshot tree — budget + contractor + supplier, with ₹/sft.">
        <span className="text-[11px] font-semibold px-2 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200">Preview · admin only</span>
      </PageHeader>

      {error && <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-sm text-rose-700">{error}</div>}

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <Metric label="Total budget" value={fmtINR(t.budget)} />
        <Metric label={`Spent · ${spentPct}%`} value={fmtINR(t.spent)} />
        <Metric label="Outstanding" value={fmtINR(t.outstanding)} />
        <Metric label="Avg ₹/sft spent" value={avgSft > 0 ? `₹${avgSft.toLocaleString('en-IN')}` : '—'} />
      </div>

      {/* AI insight */}
      <div className="flex gap-2.5 bg-gray-50 border border-gray-100 rounded-xl px-3 py-2.5">
        <Sparkles className="h-4 w-4 text-blue-600 flex-shrink-0 mt-0.5" />
        <p className="text-[13px] text-gray-600 leading-snug">
          <span className="font-medium text-gray-900">Snapshot</span> — {result.groups.length} group{result.groups.length === 1 ? '' : 's'},
          {' '}{result.groups.flatMap(g => g.projects).length} projects · <b className="text-gray-800">{overCount}</b> over budget · <b className="text-amber-700">{fmtINR(t.outstanding)}</b> outstanding
          {needsMapping > 0 && <> · <b className="text-rose-700">{needsMapping}</b> to map (below)</>}.
        </p>
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

      {/* Tree */}
      {result.groups.map(g => (
        <Card key={g.name}>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between gap-2 mb-1">
              <div className="flex items-center gap-2 min-w-0">
                <Layers className="h-4 w-4 text-gray-400" />
                <span className="font-semibold text-gray-900">{g.name}</span>
              </div>
              <span className="text-[11px] text-gray-400">budget {fmtINR(g.budget)} · spent {fmtINR(g.spent)}{g.budget > 0 ? ` · ${Math.round(g.spent / g.budget * 100)}%` : ''}</span>
            </div>

            <div className="space-y-2 mt-2">
              {g.projects.map(p => (
                <ProjectCard key={p.name} p={p} open={open} toggle={toggle}
                  onStatus={setStatus} statusBusy={busy === `st:${p.name}`} />
              ))}
            </div>
          </CardContent>
        </Card>
      ))}

      <p className="text-[11px] text-gray-400 px-1">
        ₹/sft under every amount · budget shown only to sub-category (payments have no own budget) · open on top, closed dimmed · status saved per project, survives re-uploads.
      </p>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-gray-50 px-3 py-2.5">
      <div className="text-[12px] text-gray-500">{label}</div>
      <div className="text-[18px] font-medium text-gray-900 mt-0.5 tabular-nums">{value}</div>
    </div>
  )
}

function ProjectCard({ p, open, toggle, onStatus, statusBusy }: {
  p: ProjectNode
  open: Set<string>
  toggle: (k: string) => void
  onStatus: (name: string, next: 'open' | 'closed') => void
  statusBusy: boolean
}) {
  const pk = `proj:${p.name}`
  const isOpen = open.has(pk)
  const u = utilPct(p.spent, p.budget)
  const c = u != null ? utilColors(u) : null
  return (
    <div className={cn('border border-gray-200 rounded-xl overflow-hidden', p.status === 'closed' && 'opacity-60')}>
      <div className="px-3 py-2.5 cursor-pointer hover:bg-gray-50" onClick={() => toggle(pk)}>
        <div className="flex items-center gap-2">
          {isOpen ? <ChevronDown className="h-4 w-4 text-gray-400 flex-shrink-0" /> : <ChevronRight className="h-4 w-4 text-gray-400 flex-shrink-0" />}
          <Building2 className="h-4 w-4 text-gray-500 flex-shrink-0" />
          <span className="font-medium text-sm text-gray-900 truncate">{p.name}</span>
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onStatus(p.name, p.status === 'open' ? 'closed' : 'open') }}
            disabled={statusBusy}
            className="text-[10px] px-2 py-0.5 rounded-full flex-shrink-0"
            style={p.status === 'open' ? { background: '#EAF3DE', color: '#27500A' } : { background: '#F1EFE8', color: '#444441' }}
            title="Saved per project — survives re-uploads"
          >
            {statusBusy ? '…' : p.status}
          </button>
          {p.area && <span className="text-[10px] text-gray-400 flex-shrink-0">{p.area.toLocaleString('en-IN')} sft</span>}
          {u != null && <UtilChip u={u} />}
          <div className="flex-1" />
          <Cell value={p.budget} area={p.area} />
          <Cell value={p.spent} area={p.area} />
          <Cell value={p.outstanding || null} area={p.area} />
        </div>
        {u != null && c && (
          <div className="mt-2 h-[5px] rounded-full bg-gray-100 overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${Math.min(u, 100)}%`, background: c.bar }} />
          </div>
        )}
      </div>

      {isOpen && (
        <div className="border-t border-gray-100">
          {p.categories.length === 0 && <div className="px-4 py-2.5 text-xs text-gray-400 italic">No budget lines.</div>}
          {p.categories.map((cat, i) => (
            <CategoryBlock key={cat.code + ':' + i} cat={cat} project={p} idx={i} open={open} toggle={toggle} />
          ))}
        </div>
      )}
    </div>
  )
}

function CategoryBlock({ cat, project, idx, open, toggle }: {
  cat: CatNode; project: ProjectNode; idx: number; open: Set<string>; toggle: (k: string) => void
}) {
  const ck = `cat:${project.name}:${cat.code}:${idx}`
  const isOpen = open.has(ck)
  const u = cat.hasBudget ? utilPct(cat.spent, cat.budget) : null
  const hasChildren = cat.subcats.length > 0 || cat.parties.length > 0
  return (
    <div>
      <div className={cn('flex items-center gap-2 px-3 py-2 border-t border-gray-50 cursor-pointer hover:bg-gray-50', idx % 2 && 'bg-gray-50/40')}
        onClick={() => hasChildren && toggle(ck)} style={{ paddingLeft: 28 }}>
        {hasChildren ? (isOpen ? <ChevronDown className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />) : <span className="w-3.5 flex-shrink-0" />}
        <Folder className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
        {cat.code && <span className="font-mono text-[11px] text-gray-500 flex-shrink-0">{cat.code}</span>}
        <span className="text-[13px] text-gray-800 truncate">{cat.label}</span>
        {!cat.hasBudget && <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 flex-shrink-0">payments only</span>}
        {u != null && <UtilChip u={u} />}
        <div className="flex-1" />
        <Cell value={cat.hasBudget ? cat.budget : null} area={project.area} dash={!cat.hasBudget} />
        <Cell value={cat.hasBudget ? cat.spent : null} area={project.area} dash={!cat.hasBudget} />
        <Cell value={cat.outstanding || null} area={project.area} />
      </div>

      {isOpen && (
        <>
          {cat.subcats.map((sc, j) => (
            <div key={'sc' + j} className="flex items-center gap-2 px-3 py-1.5 border-t border-gray-50" style={{ paddingLeft: 50 }}>
              <span className="w-3 flex-shrink-0" />
              {sc.code && <span className="font-mono text-[11px] text-gray-400 flex-shrink-0">{sc.code}</span>}
              <span className="text-[12px] text-gray-600 truncate">{sc.label}</span>
              <div className="flex-1" />
              <Cell value={sc.budget} area={project.area} />
              <Cell value={sc.spent} area={project.area} />
              <Cell value={null} area={project.area} dash />
            </div>
          ))}
          {cat.parties.map((pt, j) => (
            <div key={'pt' + j} className="flex items-center gap-2 px-3 py-1.5 border-t border-gray-50" style={{ paddingLeft: 50 }}>
              <User className="h-3 w-3 text-gray-400 flex-shrink-0" />
              <span className="text-[12px] text-gray-700 truncate">{pt.name}</span>
              <span className="text-[9px] px-1.5 py-0.5 rounded flex-shrink-0" style={pt.source === 'contractor' ? { background: '#EEEDFE', color: '#3C3489' } : { background: '#E6F1FB', color: '#0C447C' }}>{pt.source}</span>
              <div className="flex-1" />
              <Cell value={null} area={project.area} dash />
              <Cell value={pt.paid} area={project.area} />
              <Cell value={pt.outstanding || null} area={project.area} />
            </div>
          ))}
        </>
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
  const [picks, setPicks] = useState<Record<string, string>>({}) // `${source}::${name}` → target | '' | '__ignore__'
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
          budgetProjects: [...groupNames, ...projectNames], // groups first (preferred)
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

  const tag = (s: string) => <span className="text-[9px] px-1.5 py-0.5 rounded flex-shrink-0" style={s === 'contractor' ? { background: '#EEEDFE', color: '#3C3489' } : { background: '#E6F1FB', color: '#0C447C' }}>{s}</span>

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
                  {tag(u.source)}
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
                  {tag(u.source)}
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
