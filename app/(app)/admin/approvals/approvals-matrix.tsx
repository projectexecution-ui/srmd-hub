'use client'
// Approval rules, rethought for a layman: NO table. Each module is a card; each
// rule is one plain-English line you read top-to-bottom in workflow order:
//
//     [Submitted] → [Verify]      approved by Atm Head      ● On   ✎  🗑
//
// Nothing is editable until you click the pencil — then that one line expands
// into a small form (who approves + an optional "Advanced" drawer for ₹ limit /
// backup approver / required note+file). "Add step" opens the same form blank.
// The blueprint-demo sandbox is hidden. Save/insert/delete logic is unchanged.

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2, Check, Plus, Trash2, X, ArrowRight, Pencil, ChevronDown, ChevronRight, MessageSquare, Paperclip, Search, IndianRupee, ShieldCheck, UserPlus, Box, FileText, CornerUpLeft, Settings2 } from 'lucide-react'
import { confirm } from '@/components/ui/confirm-dialog'
import { cn } from '@/lib/utils'
import { MoneyInput } from '@/components/ui/money-input'
import { TILE_TONES } from '@/lib/modules'
import { moduleMetaMap } from '../permissions/groups'
import type { RoleLabelMap } from '@/lib/role-labels'

const HIDDEN_MODULES = new Set(['blueprint-demo'])

interface Rule {
  id: string
  module_slug: string
  doc_type: string
  from_stage: string
  to_stage: string
  approver_role: string
  override_role: string | null
  amount_cap_max: number | null
  is_active: boolean
  requires_remarks?: boolean
  requires_attachment?: boolean
}

interface Props {
  initial: Rule[]
  roles: string[]
  roleLabels: RoleLabelMap
  moduleLabels: Record<string, string>
}

// Local form values (cap is a string while editing).
interface Values {
  from_stage: string
  to_stage: string
  approver_role: string
  override_role: string
  amount_cap_max: string
  requires_remarks: boolean
  requires_attachment: boolean
}

function fmtRole(r: string | null | undefined, labels: RoleLabelMap): string {
  if (!r) return '—'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (labels as any)[r]?.label || r
}

function prettyStage(s: string | null | undefined): string {
  if (!s) return '—'
  return s.trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// Order rules by the real document flow (topological sort over from→to edges).
function flowOrder(modRules: Rule[]): Rule[] {
  const indeg = new Map<string, number>()
  const adj = new Map<string, Set<string>>()
  const discovery: string[] = []
  const seen = new Set<string>()
  const touch = (s: string) => {
    if (!seen.has(s)) { seen.add(s); discovery.push(s); indeg.set(s, 0); adj.set(s, new Set()) }
  }
  for (const r of modRules) { touch(r.from_stage); touch(r.to_stage) }
  for (const r of modRules) {
    if (r.from_stage === r.to_stage) continue
    const dests = adj.get(r.from_stage)!
    if (!dests.has(r.to_stage)) { dests.add(r.to_stage); indeg.set(r.to_stage, (indeg.get(r.to_stage) ?? 0) + 1) }
  }
  const rank = new Map<string, number>()
  let next = 0
  const queue = discovery.filter(s => (indeg.get(s) ?? 0) === 0)
  while (queue.length) {
    queue.sort((a, b) => discovery.indexOf(a) - discovery.indexOf(b))
    const s = queue.shift()!
    if (rank.has(s)) continue
    rank.set(s, next++)
    for (const nb of adj.get(s) ?? []) {
      indeg.set(nb, (indeg.get(nb) ?? 0) - 1)
      if ((indeg.get(nb) ?? 0) <= 0 && !rank.has(nb)) queue.push(nb)
    }
  }
  for (const s of discovery) if (!rank.has(s)) rank.set(s, next++)
  const idx = (s: string) => rank.get(s) ?? 9999
  return modRules
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (idx(a.r.from_stage) - idx(b.r.from_stage)) || (idx(a.r.to_stage) - idx(b.r.to_stage)) || (a.i - b.i))
    .map(x => x.r)
}

// ── The "signature chain" — the human summary of a module ─────────────────────
// The 31 rows on cost-control are really just a 3-signature chain plus Admin's
// safety net and a few "send back" moves. This reduces the rules to that chain:
// the ordered list of non-Admin approvers, each shown by the main step they own.
// Admin (approves everything) and switched-off rows are surfaced separately.

const isReturnStage = (s: string) => /return|reject|declin/i.test(s)
const isPartialStage = (s: string) => /partial/i.test(s)
const isDeadlineStage = (s: string) => /deadline/i.test(s)

interface ChainStep {
  approver: string
  from: string
  to: string
  cap: number | null
  canReturn: boolean
  canPartial: boolean
  setsDeadline: boolean
}

// Same topological ranking as flowOrder, exposed as a lookup so the chain can
// tell which moves go "forward" vs "back".
function stageRank(modRules: Rule[]): (s: string) => number {
  const indeg = new Map<string, number>()
  const adj = new Map<string, Set<string>>()
  const discovery: string[] = []
  const seen = new Set<string>()
  const touch = (s: string) => { if (!seen.has(s)) { seen.add(s); discovery.push(s); indeg.set(s, 0); adj.set(s, new Set()) } }
  for (const r of modRules) { touch(r.from_stage); touch(r.to_stage) }
  for (const r of modRules) {
    if (r.from_stage === r.to_stage) continue
    const dests = adj.get(r.from_stage)!
    if (!dests.has(r.to_stage)) { dests.add(r.to_stage); indeg.set(r.to_stage, (indeg.get(r.to_stage) ?? 0) + 1) }
  }
  const rank = new Map<string, number>()
  let next = 0
  const queue = discovery.filter(s => (indeg.get(s) ?? 0) === 0)
  while (queue.length) {
    queue.sort((a, b) => discovery.indexOf(a) - discovery.indexOf(b))
    const s = queue.shift()!
    if (rank.has(s)) continue
    rank.set(s, next++)
    for (const nb of adj.get(s) ?? []) {
      indeg.set(nb, (indeg.get(nb) ?? 0) - 1)
      if ((indeg.get(nb) ?? 0) <= 0 && !rank.has(nb)) queue.push(nb)
    }
  }
  for (const s of discovery) if (!rank.has(s)) rank.set(s, next++)
  return (s: string) => rank.get(s) ?? 9999
}

function deriveChain(modRules: Rule[]): ChainStep[] {
  const rank = stageRank(modRules)
  const active = modRules.filter(r => r.is_active && r.approver_role !== 'admin')
  const byApprover = new Map<string, Rule[]>()
  for (const r of active) {
    if (!byApprover.has(r.approver_role)) byApprover.set(r.approver_role, [])
    byApprover.get(r.approver_role)!.push(r)
  }
  const steps: ChainStep[] = []
  for (const [approver, rs] of byApprover) {
    // "Forward" = carries the document on to a later stage — not a send-back,
    // a self-loop, or a side-action like setting a deadline.
    const fwd = rs.filter(r =>
      r.to_stage !== r.from_stage &&
      !isReturnStage(r.to_stage) &&
      !isDeadlineStage(r.to_stage) &&
      r.from_stage !== 'any' &&
      rank(r.to_stage) > rank(r.from_stage))
    if (fwd.length === 0) continue // this role only sends back / sets deadlines → not a chain step
    // Their primary move: earliest starting stage, reaching furthest.
    const primary = [...fwd].sort((a, b) =>
      (rank(a.from_stage) - rank(b.from_stage)) || (rank(b.to_stage) - rank(a.to_stage)))[0]
    steps.push({
      approver,
      from: primary.from_stage,
      to: primary.to_stage,
      cap: primary.amount_cap_max,
      canReturn: rs.some(r => isReturnStage(r.to_stage)),
      canPartial: rs.some(r => isPartialStage(r.to_stage) && r.to_stage !== r.from_stage),
      setsDeadline: rs.some(r => isDeadlineStage(r.to_stage)),
    })
  }
  return steps.sort((a, b) => rank(a.from) - rank(b.from))
}

export default function ApprovalsMatrix({ initial, roles, roleLabels, moduleLabels }: Props) {
  const router = useRouter()
  const [rules, setRules] = useState<Rule[]>(initial)
  const [editingId, setEditingId] = useState<string | null>(null)
  // module_slug currently showing a blank "new step" form (one at a time per module)
  const [addingFor, setAddingFor] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  // module_slugs whose detailed step editor is expanded (default: chain view only)
  const [advanced, setAdvanced] = useState<Set<string>>(new Set())
  const toggleAdvanced = (slug: string) => setAdvanced(a => { const n = new Set(a); if (n.has(slug)) n.delete(slug); else n.add(slug); return n })

  const groups = useMemo(() => {
    const m = new Map<string, Rule[]>()
    for (const r of rules) {
      if (HIDDEN_MODULES.has(r.module_slug)) continue
      if (!m.has(r.module_slug)) m.set(r.module_slug, [])
      m.get(r.module_slug)!.push(r)
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [rules])

  function defaultDocType(modSlug: string): string {
    return rules.find(x => x.module_slug === modSlug)?.doc_type ?? modSlug
  }
  function stagesForModule(modSlug: string): string[] {
    const set = new Set<string>()
    for (const r of rules) {
      if (r.module_slug !== modSlug) continue
      if (r.from_stage) set.add(r.from_stage)
      if (r.to_stage) set.add(r.to_stage)
    }
    return Array.from(set).sort()
  }

  function toPatch(v: Values): Partial<Rule> {
    return {
      from_stage: v.from_stage.trim(),
      to_stage: v.to_stage.trim(),
      approver_role: v.approver_role,
      override_role: v.override_role || null,
      amount_cap_max: v.amount_cap_max.trim() === '' ? null : Number(v.amount_cap_max),
      requires_remarks: v.requires_remarks,
      requires_attachment: v.requires_attachment,
    }
  }

  async function toggleActive(id: string, next: boolean) {
    setBusyId(id); setError(null)
    const prev = rules
    setRules(rs => rs.map(r => r.id === id ? { ...r, is_active: next } : r))
    const { error } = await createClient().from('approval_rules').update({ is_active: next }).eq('id', id)
    setBusyId(null)
    if (error) { setError(error.message); setRules(prev); return }
    router.refresh()
  }

  async function saveEdit(id: string, v: Values) {
    if (!v.from_stage.trim() || !v.to_stage.trim() || !v.approver_role) {
      setError('Please fill: the starting stage, the stage it moves to, and who can approve.'); return
    }
    const patch = toPatch(v)
    setBusyId(id); setError(null)
    const prev = rules
    setRules(rs => rs.map(r => r.id === id ? { ...r, ...patch } as Rule : r))
    const { error } = await createClient().from('approval_rules').update(patch).eq('id', id)
    setBusyId(null)
    if (error) { setError(error.message); setRules(prev); return }
    setEditingId(null)
    router.refresh()
  }

  async function createRule(modSlug: string, v: Values) {
    if (!v.from_stage.trim() || !v.to_stage.trim() || !v.approver_role) {
      setError('Please fill: the starting stage, the stage it moves to, and who can approve.'); return
    }
    setBusyId('new'); setError(null)
    const { data, error } = await createClient().from('approval_rules').insert({
      module_slug: modSlug,
      doc_type: defaultDocType(modSlug),
      is_active: true,
      ...toPatch(v),
    }).select('*').single()
    setBusyId(null)
    if (error) { setError(error.message); return }
    setRules(rs => [...rs, data as Rule])
    setAddingFor(null)
    router.refresh()
  }

  async function remove(id: string) {
    if (!(await confirm('Delete this step? People will no longer be able to make this move (Admin can still do everything).'))) return
    setBusyId(id); setError(null)
    const prev = rules
    setRules(rs => rs.filter(r => r.id !== id))
    const { error } = await createClient().from('approval_rules').delete().eq('id', id)
    setBusyId(null)
    if (error) { setError(error.message); setRules(prev); return }
    if (editingId === id) setEditingId(null)
    router.refresh()
  }

  const searching = q.trim() !== ''
  const s = q.trim().toLowerCase()
  const match = (r: Rule, slug: string) =>
    [(moduleLabels[slug] ?? slug), slug, prettyStage(r.from_stage), prettyStage(r.to_stage), fmtRole(r.approver_role, roleLabels), fmtRole(r.override_role, roleLabels)]
      .join(' ').toLowerCase().includes(s)
  const shownGroups: [string, Rule[]][] = searching
    ? groups.map(([slug, rs]) => [slug, rs.filter(r => match(r, slug))] as [string, Rule[]]).filter(([, rs]) => rs.length > 0)
    : groups
  const allOpen = groups.length > 0 && groups.every(([slug]) => !collapsed.has(slug))
  const toggleCollapse = (slug: string) => setCollapsed(c => { const n = new Set(c); if (n.has(slug)) n.delete(slug); else n.add(slug); return n })
  const setAll = (open: boolean) => setCollapsed(open ? new Set() : new Set(groups.map(([slug]) => slug)))

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-sm text-rose-700 flex items-center justify-between gap-3">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-rose-500 hover:text-rose-700"><X className="h-4 w-4" /></button>
        </div>
      )}

      {groups.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-auto sm:min-w-[240px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search steps, stages, roles…" className="pl-8" />
          </div>
          {!searching && (
            <button type="button" onClick={() => setAll(!allOpen)} className="ml-auto text-xs font-medium text-blue-600 hover:underline whitespace-nowrap">
              {allOpen ? 'Collapse all' : 'Expand all'}
            </button>
          )}
        </div>
      )}

      {shownGroups.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-sm text-gray-500">{searching ? `No steps match “${q}”.` : 'No approval steps configured.'}</CardContent></Card>
      ) : shownGroups.map(([modSlug, modRules]) => {
        const knownStages = stagesForModule(modSlug)
        const ordered = flowOrder(modRules)
        const onCount = modRules.filter(r => r.is_active).length
        const offCount = modRules.length - onCount
        const open = searching || !collapsed.has(modSlug)
        const meta = moduleMetaMap.get(modSlug)
        const tone = meta ? TILE_TONES[meta.tone] : TILE_TONES.slate
        const Icon = meta?.icon ?? Box
        const rail = orderedStages(ordered)
        const lanes = groupByFromStage(ordered)
        const chain = deriveChain(modRules)
        const adv = advanced.has(modSlug)
        const sigLabel = chain.length === 0 ? 'Admin only' : `${chain.length} signature${chain.length === 1 ? '' : 's'}`
        return (
          <Card key={modSlug} className="overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
              <button type="button" onClick={() => { if (!searching) toggleCollapse(modSlug) }} className="flex flex-1 items-center gap-2.5 text-left min-w-0">
                {!searching && (open ? <ChevronDown className="h-4 w-4 text-gray-400 flex-shrink-0" /> : <ChevronRight className="h-4 w-4 text-gray-400 flex-shrink-0" />)}
                <span className={cn('inline-flex h-8 w-8 items-center justify-center rounded-lg flex-shrink-0', tone.bg, tone.ic)}><Icon className="h-4 w-4" /></span>
                <span className="min-w-0">
                  <span className="block font-bold text-gray-900 leading-tight truncate">{moduleLabels[modSlug] ?? prettyStage(modSlug)}</span>
                  <span className="block text-[11px] text-gray-400"><b className="text-gray-500">{sigLabel}</b> before it&rsquo;s approved</span>
                </span>
              </button>
            </div>

            {open && (
              <CardContent className="pt-4">
                {!searching && <ChainView steps={chain} offCount={offCount} roleLabels={roleLabels} />}

                <div className={cn(!searching && 'mt-4 pt-3 border-t border-gray-100')}>
                  {!searching && (
                    <button type="button" onClick={() => toggleAdvanced(modSlug)}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-800">
                      {adv ? <ChevronDown className="h-3.5 w-3.5" /> : <Settings2 className="h-3.5 w-3.5" />}
                      {adv ? 'Hide the detailed steps' : 'Edit / see all steps'}
                    </button>
                  )}

                  {(adv || searching) && (
                    <div className={cn(!searching && 'mt-3')}>
                      <div className="mb-2 flex justify-end">
                        <Button size="sm" variant="outline" onClick={() => { setAddingFor(modSlug); setEditingId(null); setAdvanced(a => { const n = new Set(a); n.add(modSlug); return n }); setCollapsed(c => { const n = new Set(c); n.delete(modSlug); return n }) }}>
                          <Plus className="h-4 w-4" /> Add step
                        </Button>
                      </div>
                {rail.length > 1 && (
                  <div className="flex items-center gap-1.5 overflow-x-auto pb-3 mb-1 border-b border-dashed border-gray-100">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-300 mr-1 flex-shrink-0">Flow</span>
                    {rail.map((st, i) => (
                      <span key={st} className="inline-flex items-center gap-1.5 flex-shrink-0">
                        {i > 0 && <ArrowRight className="h-3.5 w-3.5 text-gray-300" />}
                        <StageBadge value={st} />
                      </span>
                    ))}
                  </div>
                )}

                {ordered.length === 0 && addingFor !== modSlug && (
                  <p className="py-3 text-sm text-gray-400 italic">No steps yet. Click “Add step”.</p>
                )}

                {lanes.map(lane => (
                  <div key={lane.stage} className="mt-3 first:mt-1">
                    <div className="flex items-center gap-2 px-1 py-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">When at</span>
                      <StageBadge value={lane.stage} />
                      <span className="text-[11px] text-gray-300">· {lane.rules.length}</span>
                    </div>
                    <div className="pl-1">
                      {lane.rules.map(r => (
                        editingId === r.id ? (
                          <EditorRow key={r.id} mode="edit"
                            initial={{ from_stage: r.from_stage, to_stage: r.to_stage, approver_role: r.approver_role, override_role: r.override_role ?? '', amount_cap_max: r.amount_cap_max == null ? '' : String(r.amount_cap_max), requires_remarks: !!r.requires_remarks, requires_attachment: !!r.requires_attachment }}
                            roles={roles} roleLabels={roleLabels} knownStages={knownStages} busy={busyId === r.id}
                            onSave={(v) => saveEdit(r.id, v)} onCancel={() => setEditingId(null)} />
                        ) : (
                          <ViewRow key={r.id} rule={r} roleLabels={roleLabels} busy={busyId === r.id}
                            onEdit={() => { setEditingId(r.id); setAddingFor(null) }}
                            onToggle={(next) => toggleActive(r.id, next)} onRemove={() => remove(r.id)} />
                        )
                      ))}
                    </div>
                  </div>
                ))}

                {addingFor === modSlug && (
                  <div className="mt-3">
                    <EditorRow mode="new"
                      initial={{ from_stage: '', to_stage: '', approver_role: '', override_role: '', amount_cap_max: '', requires_remarks: false, requires_attachment: false }}
                      roles={roles} roleLabels={roleLabels} knownStages={knownStages} busy={busyId === 'new'}
                      onSave={(v) => createRule(modSlug, v)} onCancel={() => setAddingFor(null)} />
                  </div>
                )}
                    </div>
                  )}
                </div>
              </CardContent>
            )}
          </Card>
        )
      })}
    </div>
  )
}

// ─── One rule row — the lane above shows the "from" stage, so the row leads
//     with where it can move to + who approves. ──────────────────────────
function ViewRow({ rule, roleLabels, busy, onEdit, onToggle, onRemove }: {
  rule: Rule
  roleLabels: RoleLabelMap
  busy: boolean
  onEdit: () => void
  onToggle: (next: boolean) => void
  onRemove: () => void
}) {
  return (
    <div className={cn('flex items-center gap-2.5 rounded-lg px-2 -mx-2 py-2 border-t border-gray-100 first:border-t-0 hover:bg-gray-50/60 transition-colors', !rule.is_active && 'opacity-55')}>
      <ArrowRight className="h-3.5 w-3.5 text-gray-300 flex-shrink-0" />
      <div className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap text-sm">
        <StageBadge value={rule.to_stage} />
        <span className="text-[11px] text-gray-400">by</span>
        <ApproverChip role={rule.approver_role} labels={roleLabels} />
        {rule.override_role && (
          <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 border border-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 uppercase" title="Backup approver">
            <UserPlus className="h-3 w-3" /> {fmtRole(rule.override_role, roleLabels)}
          </span>
        )}
        <ConditionBadges rule={rule} />
      </div>
      {busy && <Loader2 className="h-4 w-4 animate-spin text-gray-400 flex-shrink-0" />}
      <ToggleSwitch on={rule.is_active} onClick={() => onToggle(!rule.is_active)} />
      <button type="button" onClick={onEdit} title="Edit this step"
        className="h-7 w-7 inline-flex items-center justify-center rounded-md text-gray-400 hover:text-blue-700 hover:bg-blue-50 flex-shrink-0">
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <button type="button" onClick={onRemove} title="Delete this step"
        className="h-7 w-7 inline-flex items-center justify-center rounded-md text-gray-400 hover:text-rose-600 hover:bg-rose-50 flex-shrink-0">
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  )
}

function ConditionBadges({ rule }: { rule: Rule }) {
  const badges: React.ReactNode[] = []
  if (rule.amount_cap_max != null) badges.push(
    <span key="cap" className="inline-flex items-center gap-0.5 rounded-full bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[10px] font-medium text-amber-800" title="Only when the amount is at or below this">
      <IndianRupee className="h-2.5 w-2.5" />≤ {Number(rule.amount_cap_max).toLocaleString('en-IN')}
    </span>)
  if (rule.requires_remarks) badges.push(
    <span key="note" className="inline-flex items-center gap-1 rounded-full bg-slate-50 border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-600" title="Approver must leave a note"><MessageSquare className="h-2.5 w-2.5" /> note</span>)
  if (rule.requires_attachment) badges.push(
    <span key="file" className="inline-flex items-center gap-1 rounded-full bg-slate-50 border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-600" title="Approver must attach a file"><Paperclip className="h-2.5 w-2.5" /> file</span>)
  return <>{badges}</>
}

function ApproverChip({ role, labels }: { role: string; labels: RoleLabelMap }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-gray-100 border border-gray-200 px-2 py-0.5 text-xs font-semibold text-gray-800 uppercase">
      <ShieldCheck className="h-3 w-3 text-gray-500" /> {fmtRole(role, labels)}
    </span>
  )
}

// The plain-language summary of a module: a numbered signature chain that reads
// Submitted → 1st signer → 2nd signer → … → Approved. Derived from the live
// rules — it changes nothing; the detailed editor is one click away.
const CHAIN_TONES = [
  { bg: 'bg-indigo-50', tx: 'text-indigo-700', rg: 'text-indigo-600' },
  { bg: 'bg-teal-50', tx: 'text-teal-700', rg: 'text-teal-600' },
  { bg: 'bg-violet-50', tx: 'text-violet-700', rg: 'text-violet-600' },
  { bg: 'bg-sky-50', tx: 'text-sky-700', rg: 'text-sky-600' },
  { bg: 'bg-rose-50', tx: 'text-rose-700', rg: 'text-rose-600' },
  { bg: 'bg-amber-50', tx: 'text-amber-700', rg: 'text-amber-600' },
]
function Connector() {
  return <div className="ml-[13px] my-0.5 h-3.5 w-px bg-gray-200" />
}
function ChainView({ steps, offCount, roleLabels }: { steps: ChainStep[]; offCount: number; roleLabels: RoleLabelMap }) {
  return (
    <div>
      {steps.length === 0 ? (
        <p className="text-sm text-gray-500 py-1">
          Only <b>you (Admin)</b> approve this — nobody else is set up to sign off yet.
        </p>
      ) : (
        <>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 border border-blue-100 px-3 py-1 text-[12.5px] font-semibold text-blue-700">
            <FileText className="h-3.5 w-3.5" /> Submitted
          </span>
          <Connector />
          {steps.map((st, i) => {
            const tone = CHAIN_TONES[i % CHAIN_TONES.length]
            const last = i === steps.length - 1
            const extras: React.ReactNode[] = []
            if (st.cap != null) extras.push(<span key="cap" className="text-amber-700">up to ₹{Number(st.cap).toLocaleString('en-IN')}</span>)
            if (st.canPartial) extras.push(<span key="p">can partly approve</span>)
            if (st.setsDeadline) extras.push(<span key="d">sets the deadline</span>)
            if (st.canReturn) extras.push(<span key="r" className="inline-flex items-center gap-0.5"><CornerUpLeft className="h-3 w-3" />can send back</span>)
            return (
              <div key={st.approver + i}>
                <div className="flex items-start gap-3">
                  <span className={cn('mt-px inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[13px] font-bold', tone.bg, tone.tx)}>{i + 1}</span>
                  <div className="min-w-0">
                    <div className="text-[13.5px] font-bold uppercase tracking-tight text-gray-900">
                      {fmtRole(st.approver, roleLabels)}
                      <span className="ml-2 text-[11px] font-medium normal-case tracking-normal text-gray-400">{last ? 'final sign-off' : i === 0 ? 'first sign-off' : 'next sign-off'}</span>
                    </div>
                    {extras.length > 0 && (
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11.5px] text-gray-500">
                        {extras.map((e, k) => <span key={k} className="inline-flex items-center">{k > 0 && <span className="mr-1.5 text-gray-300">·</span>}{e}</span>)}
                      </div>
                    )}
                  </div>
                </div>
                <Connector />
              </div>
            )
          })}
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-100 px-3 py-1 text-[12.5px] font-semibold text-emerald-700">
            <Check className="h-3.5 w-3.5" /> Approved
          </span>
        </>
      )}
      <div className="mt-3.5 flex items-start gap-2 rounded-lg bg-amber-50/70 border border-amber-100 px-3 py-2 text-[12px] leading-relaxed text-amber-800">
        <ShieldCheck className="h-4 w-4 flex-shrink-0 mt-px text-amber-500" />
        <span><b>You (Admin)</b> can approve or skip any step, so nothing ever gets stuck.{offCount > 0 && <> · <b>{offCount}</b> switched-off shortcut{offCount === 1 ? '' : 's'} not in use.</>}</span>
      </div>
    </div>
  )
}

function ToggleSwitch({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} role="switch" aria-checked={on}
      title={on ? 'On — click to turn off' : 'Off — click to turn on'}
      className={cn('relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0', on ? 'bg-emerald-500' : 'bg-gray-300')}>
      <span className={cn('inline-block h-4 w-4 rounded-full bg-white shadow transition-transform', on ? 'translate-x-4' : 'translate-x-0.5')} />
    </button>
  )
}

const STAGE_TONE_CLS: Record<'slate' | 'blue' | 'green' | 'amber' | 'rose', string> = {
  slate: 'bg-slate-100 text-slate-700 border-slate-200',
  blue:  'bg-blue-50 text-blue-700 border-blue-200',
  green: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  amber: 'bg-amber-50 text-amber-800 border-amber-200',
  rose:  'bg-rose-50 text-rose-700 border-rose-200',
}
function stageTone(s: string): keyof typeof STAGE_TONE_CLS {
  const t = (s || '').toLowerCase()
  if (/reject|cancel|declin/.test(t)) return 'rose'
  if (/partial/.test(t)) return 'amber'
  if (/approv|final|issu|paid|releas|complet|closed|done/.test(t)) return 'green'
  if (/submit|pending|review|verify|check|deadline/.test(t)) return 'blue'
  return 'slate'
}
function StageBadge({ value }: { value: string }) {
  return (
    <span className={cn('inline-block text-xs font-medium px-2 py-0.5 rounded-md border whitespace-nowrap', STAGE_TONE_CLS[stageTone(value)])} title={value}>
      {prettyStage(value)}
    </span>
  )
}

function orderedStages(ordered: Rule[]): string[] {
  const set = new Set<string>(); const out: string[] = []
  for (const r of ordered) for (const st of [r.from_stage, r.to_stage]) if (st && !set.has(st)) { set.add(st); out.push(st) }
  return out
}
function groupByFromStage(ordered: Rule[]): { stage: string; rules: Rule[] }[] {
  const m = new Map<string, Rule[]>()
  for (const r of ordered) { if (!m.has(r.from_stage)) m.set(r.from_stage, []); m.get(r.from_stage)!.push(r) }
  return [...m.entries()].map(([stage, rules]) => ({ stage, rules }))
}

// ─── Inline editor (used for both edit + new) ──────────────────────────
function EditorRow({ mode, initial, roles, roleLabels, knownStages, busy, onSave, onCancel }: {
  mode: 'edit' | 'new'
  initial: Values
  roles: string[]
  roleLabels: RoleLabelMap
  knownStages: string[]
  busy: boolean
  onSave: (v: Values) => void
  onCancel: () => void
}) {
  const [v, setV] = useState<Values>(initial)
  const [advanced, setAdvanced] = useState(
    mode === 'edit' && (!!initial.override_role || initial.amount_cap_max !== '' || initial.requires_remarks || initial.requires_attachment),
  )
  const set = (p: Partial<Values>) => setV(s => ({ ...s, ...p }))
  const listId = `stages-${mode}-${knownStages.join('|').length}`

  return (
    <div className="border-t border-blue-200 first:border-t-0 bg-blue-50/40 -mx-4 px-4 py-4 my-1 rounded-lg">
      <p className="text-xs font-semibold text-blue-900 mb-3">{mode === 'new' ? 'New step' : 'Edit step'}</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="When the document is at">
          <datalist id={listId}>{knownStages.map(s => <option key={s} value={s}>{prettyStage(s)}</option>)}</datalist>
          <Input list={listId} value={v.from_stage} onChange={e => set({ from_stage: e.target.value })} placeholder="e.g. submitted" className="h-9" />
        </Field>
        <Field label="…it can move to">
          <Input list={listId} value={v.to_stage} onChange={e => set({ to_stage: e.target.value })} placeholder="e.g. approved" className="h-9" />
        </Field>
      </div>

      <div className="mt-3">
        <Field label="Who can approve it (besides Admin)">
          <RoleSelect value={v.approver_role} roles={roles} roleLabels={roleLabels} onChange={(x) => set({ approver_role: x })} big />
        </Field>
      </div>

      {/* Advanced drawer */}
      <button type="button" onClick={() => setAdvanced(a => !a)}
        className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700">
        {advanced ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        Advanced options {advanced ? '' : '(optional)'}
      </button>
      {advanced && (
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3 bg-white rounded-lg border border-gray-200 p-3">
          <Field label="Backup approver (optional)">
            <RoleSelect value={v.override_role} roles={roles} roleLabels={roleLabels} allowEmpty onChange={(x) => set({ override_role: x })} />
          </Field>
          <Field label="Only when amount ≤ (₹)">
            <MoneyInput value={v.amount_cap_max} onChange={(x) => set({ amount_cap_max: x })} placeholder="no limit" className="h-9 w-full text-right tabular-nums" />
          </Field>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={v.requires_remarks} onChange={e => set({ requires_remarks: e.target.checked })} className="h-4 w-4 accent-blue-600" />
            <MessageSquare className="h-3.5 w-3.5 text-gray-400" /> Approver must leave a note
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={v.requires_attachment} onChange={e => set({ requires_attachment: e.target.checked })} className="h-4 w-4 accent-blue-600" />
            <Paperclip className="h-3.5 w-3.5 text-gray-400" /> Approver must attach a file
          </label>
        </div>
      )}

      <div className="mt-4 flex items-center gap-2">
        <Button size="sm" onClick={() => onSave(v)} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {mode === 'new' ? 'Add step' : 'Save'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">{label}</span>
      {children}
    </label>
  )
}

function RoleSelect({ value, roles, roleLabels, allowEmpty, big, onChange }: {
  value: string
  roles: string[]
  roleLabels: RoleLabelMap
  allowEmpty?: boolean
  big?: boolean
  onChange: (v: string) => void
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className={cn('rounded-lg border border-gray-300 bg-white px-2 text-sm w-full', big ? 'h-9' : 'h-9')}
    >
      {allowEmpty && <option value="">— none —</option>}
      {!allowEmpty && !value && <option value="">— pick a role —</option>}
      {roles.map(r => <option key={r} value={r}>{fmtRole(r, roleLabels)}</option>)}
    </select>
  )
}
