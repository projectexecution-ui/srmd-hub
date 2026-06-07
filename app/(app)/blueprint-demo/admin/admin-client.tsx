'use client'
// Smart admin matrix client. Three key actions:
//   1. Adopt P90 (per row)       — sets sla_hours = observed P90
//   2. Auto-apply all (banner)   — Adopt P90 + auto-fill escalate_to_role
//                                  for every rule that has stats.
//   3. Apply to similar          — copy this rule's SLA+escalate to
//                                  every rule with the same approver_role.
//
// All writes are scoped to module_slug='blueprint-demo' so production
// rules can't be touched accidentally.

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2, Sparkles, Copy, Check, Plus, Power, PowerOff } from 'lucide-react'

interface Rule {
  id: string
  module_slug: string
  doc_type: string
  from_stage: string
  to_stage: string
  approver_role: string
  override_role: string | null
  sla_hours: number | null
  escalate_to_role: string | null
  requires_remarks: boolean | null
  is_active: boolean
  notes: string | null
}

interface Stat {
  module_slug: string
  doc_type: string
  from_stage: string
  to_stage: string
  approver_role: string
  sample_count: number
  median_hours: number | null
  p90_hours: number | null
}

function key(r: { from_stage: string; to_stage: string }) {
  return `${r.from_stage}__${r.to_stage}`
}

// Allowed stages of the sandbox state machine (from the
// blueprint_demo_status enum in the migration). Used by the
// "Add new transition" form so the admin picks from the known set
// — typing a stage that doesn't exist in the enum would break the
// matrix trigger silently.
const STAGES = ['draft', 'submitted', 'review', 'approved', 'closed', 'rejected'] as const
// Roles that can be approvers / overrides. Matches the roles seeded
// with view perms on the demo (admin/head/founder/engineer); a few
// more are listed so the admin can experiment with cross-team flows.
const ROLES = ['admin', 'head', 'founder', 'engineer', 'backoffice', 'store_manager', 'uploader', 'viewer'] as const

export function AdminMatrixClient({ rules, stats }: { rules: Rule[]; stats: Stat[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)   // row id being mutated
  const [bulkBusy, setBulkBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  // "Add new transition" form state — lets the admin design a new
  // blueprint rule from scratch (e.g. add a "draft → cancelled"
  // path, or insert an intermediate stage).
  const [showAddForm, setShowAddForm] = useState(false)
  const [newFromStage,   setNewFromStage]   = useState<typeof STAGES[number]>('draft')
  const [newToStage,     setNewToStage]     = useState<typeof STAGES[number]>('submitted')
  const [newApproverRole,setNewApproverRole]= useState<typeof ROLES[number]>('engineer')
  const [newOverrideRole,setNewOverrideRole]= useState<string>('')   // '' = no override
  const [newSlaHours,    setNewSlaHours]    = useState<string>('')   // optional
  const [newRequiresRem, setNewRequiresRem] = useState(false)
  const [addBusy,        setAddBusy]        = useState(false)

  // Index stats by (from→to) for fast lookup per rule
  const statByPair = useMemo(() => {
    const m = new Map<string, Stat>()
    for (const s of stats) m.set(key(s), s)
    return m
  }, [stats])

  // For "next role" auto-derivation: index rules by from_stage
  // so we can find the rule that owns to_stage's NEXT outgoing move.
  const rulesByFromStage = useMemo(() => {
    const m = new Map<string, Rule[]>()
    for (const r of rules) {
      if (!m.has(r.from_stage)) m.set(r.from_stage, [])
      m.get(r.from_stage)!.push(r)
    }
    return m
  }, [rules])

  /** Auto-derive the next role: when this transition completes, who'd
      own the NEXT transition? That's our escalation suggestion. */
  function nextRoleForRule(r: Rule): string | null {
    const next = rulesByFromStage.get(r.to_stage)
    if (!next || next.length === 0) return null
    // Prefer non-rejection routes
    const candidate = next.find(x => x.to_stage !== 'rejected') ?? next[0]
    return candidate.approver_role
  }

  /** Rules where this user's SLA+escalation should replicate (same
      approver_role within the demo module). Used by "Apply to similar". */
  function similarRules(r: Rule): Rule[] {
    return rules.filter(other =>
      other.id !== r.id &&
      other.approver_role === r.approver_role &&
      other.to_stage !== 'rejected',
    )
  }

  // ─── Mutations ───────────────────────────────────────────────
  async function patchRule(id: string, patch: { sla_hours?: number | null; escalate_to_role?: string | null; is_active?: boolean }) {
    const supabase = createClient()
    const { error } = await supabase
      .from('approval_rules')
      .update(patch)
      .eq('id', id)
      .eq('module_slug', 'blueprint-demo')  // belt + suspenders
    return error
  }

  /** Insert a brand-new approval_rule for the demo module. The trigger
      + RLS gate everything; we just need a unique (module, doc_type,
      from_stage, to_stage) — duplicates would fail the unique index
      if one exists, so we check before inserting. */
  async function addRule() {
    setErr(null); setMsg(null)
    if (newFromStage === newToStage) { setErr('From and To must differ'); return }
    if (rules.some(r => r.from_stage === newFromStage && r.to_stage === newToStage)) {
      setErr(`A rule for ${newFromStage} → ${newToStage} already exists`)
      return
    }
    setAddBusy(true)
    const supabase = createClient()
    const { error } = await supabase
      .from('approval_rules')
      .insert({
        module_slug: 'blueprint-demo',
        doc_type: 'blueprint_demo_request',
        from_stage: newFromStage,
        to_stage: newToStage,
        approver_role: newApproverRole,
        override_role: newOverrideRole || null,
        sla_hours: newSlaHours ? Number(newSlaHours) : null,
        requires_remarks: newRequiresRem,
        is_active: true,
      })
    setAddBusy(false)
    if (error) { setErr(error.message); return }
    setMsg(`Created ${newFromStage} → ${newToStage} for role ${newApproverRole}`)
    setShowAddForm(false)
    // reset
    setNewOverrideRole(''); setNewSlaHours(''); setNewRequiresRem(false)
    router.refresh()
  }

  /** Activate / deactivate a rule. Deactivated rules don't block —
      the matrix-enforcement trigger simply skips them. */
  async function toggleActive(r: Rule) {
    setBusy(r.id); setErr(null); setMsg(null)
    const error = await patchRule(r.id, { is_active: !r.is_active })
    setBusy(null)
    if (error) { setErr(error.message); return }
    setMsg(`${r.is_active ? 'Deactivated' : 'Activated'} ${r.from_stage} → ${r.to_stage}`)
    router.refresh()
  }

  async function adoptP90(r: Rule) {
    const s = statByPair.get(key(r))
    if (!s?.p90_hours) return
    setBusy(r.id); setErr(null); setMsg(null)
    const sla = Math.round(s.p90_hours)
    const escalate = r.escalate_to_role ?? nextRoleForRule(r)
    const error = await patchRule(r.id, { sla_hours: sla, escalate_to_role: escalate })
    setBusy(null)
    if (error) { setErr(error.message); return }
    setMsg(`Adopted P90 (${sla}h) on ${r.from_stage} → ${r.to_stage}`)
    router.refresh()
  }

  async function applyToSimilar(r: Rule) {
    const targets = similarRules(r)
    if (targets.length === 0 || r.sla_hours == null) return
    setBusy(r.id); setErr(null); setMsg(null)
    let okCount = 0, errCount = 0
    for (const t of targets) {
      const error = await patchRule(t.id, {
        sla_hours: r.sla_hours,
        escalate_to_role: r.escalate_to_role ?? nextRoleForRule(t),
      })
      if (error) errCount++; else okCount++
    }
    setBusy(null)
    if (errCount > 0) setErr(`${errCount} update(s) failed`)
    setMsg(`Applied SLA ${r.sla_hours}h to ${okCount} similar rule${okCount === 1 ? '' : 's'} for role ${r.approver_role}`)
    router.refresh()
  }

  async function autoApplyAll() {
    setBulkBusy(true); setErr(null); setMsg(null)
    let okCount = 0
    for (const r of rules) {
      const s = statByPair.get(key(r))
      if (!s?.p90_hours) continue
      const error = await patchRule(r.id, {
        sla_hours: Math.round(s.p90_hours),
        escalate_to_role: r.escalate_to_role ?? nextRoleForRule(r),
      })
      if (!error) okCount++
    }
    setBulkBusy(false)
    setMsg(`Auto-applied SLA + escalation to ${okCount} rule${okCount === 1 ? '' : 's'}`)
    router.refresh()
  }

  // How many rules COULD be auto-applied?
  const autoApplicable = rules.filter(r => {
    const s = statByPair.get(key(r))
    return s?.p90_hours != null && r.sla_hours == null
  }).length

  return (
    <div className="space-y-4">
      {/* Auto-apply banner */}
      {autoApplicable > 0 && (
        <Card className="border-purple-200 bg-gradient-to-r from-purple-50 to-fuchsia-50">
          <CardContent className="pt-4 pb-4 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-start gap-3 flex-1 min-w-0">
              <Sparkles className="h-5 w-5 text-purple-700 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-purple-900">Based on observed activity, I can auto-configure {autoApplicable} rule{autoApplicable === 1 ? '' : 's'}.</p>
                <p className="text-[12px] text-purple-800">
                  Sets <code className="text-[11px] bg-purple-100 px-1 rounded">sla_hours</code> to the observed P90 and <code className="text-[11px] bg-purple-100 px-1 rounded">escalate_to_role</code> to the next-stage&apos;s approver. Override any one rule below if needed.
                </p>
              </div>
            </div>
            <Button onClick={autoApplyAll} disabled={bulkBusy} className="bg-purple-700 hover:bg-purple-800 text-white">
              {bulkBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Auto-apply to all {autoApplicable}
            </Button>
          </CardContent>
        </Card>
      )}

      {err && <Card className="bg-rose-50 border-rose-200 p-3 text-sm text-rose-800">{err}</Card>}
      {msg && <Card className="bg-emerald-50 border-emerald-200 p-3 text-sm text-emerald-800">{msg}</Card>}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rule matrix · blueprint-demo</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stone-50">
                <tr className="text-left text-[10px] uppercase tracking-wide text-stone-500">
                  <th className="px-3 py-2">Transition</th>
                  <th className="px-3 py-2">Approver</th>
                  <th className="px-3 py-2">Override</th>
                  <th className="px-3 py-2 text-right" title="Observed median over the last 90 days">P50 obs</th>
                  <th className="px-3 py-2 text-right" title="Observed P90 — recommended as the SLA">P90 obs</th>
                  <th className="px-3 py-2 text-right">Samples</th>
                  <th className="px-3 py-2 text-right">SLA (hrs)</th>
                  <th className="px-3 py-2">Escalate to</th>
                  <th className="px-3 py-2 text-right">Smart actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {rules.map(r => {
                  const s = statByPair.get(key(r))
                  const suggested = nextRoleForRule(r)
                  const canAdopt   = s?.p90_hours != null && (r.sla_hours ?? -1) !== Math.round(s.p90_hours)
                  const similarN   = r.sla_hours != null ? similarRules(r).length : 0
                  const isRowBusy  = busy === r.id

                  return (
                    <tr key={r.id} className={`hover:bg-stone-50 ${!r.is_active ? 'opacity-50' : ''}`}>
                      <td className="px-3 py-2 text-stone-800 whitespace-nowrap">
                        <span className="font-medium">{r.from_stage}</span>
                        <span className="text-stone-400 mx-1">→</span>
                        <span className="font-medium">{r.to_stage}</span>
                        {!r.is_active && <span className="ml-2 text-[9px] uppercase tracking-wider font-bold text-stone-500 bg-stone-100 px-1 py-0.5 rounded">Off</span>}
                      </td>
                      <td className="px-3 py-2 text-stone-700 whitespace-nowrap text-xs">{r.approver_role}</td>
                      <td className="px-3 py-2 text-stone-500 whitespace-nowrap text-xs">{r.override_role ?? '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-xs text-stone-600 whitespace-nowrap">
                        {s?.median_hours != null ? `${Math.round(s.median_hours)}h` : '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-xs text-stone-700 font-semibold whitespace-nowrap">
                        {s?.p90_hours != null ? `${Math.round(s.p90_hours)}h` : '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-xs text-stone-500 whitespace-nowrap">
                        {s?.sample_count ?? 0}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-xs whitespace-nowrap">
                        {r.sla_hours != null
                          ? <span className="font-semibold text-stone-800">{r.sla_hours}h</span>
                          : <span className="text-stone-400">not set</span>}
                      </td>
                      <td className="px-3 py-2 text-xs whitespace-nowrap">
                        {r.escalate_to_role
                          ? <span className="text-stone-700">{r.escalate_to_role}</span>
                          : suggested
                            ? <span className="text-stone-400">suggest: <b className="text-stone-600">{suggested}</b></span>
                            : <span className="text-stone-300">—</span>}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <div className="inline-flex gap-1">
                          {canAdopt && (
                            <button
                              type="button"
                              onClick={() => adoptP90(r)}
                              disabled={isRowBusy || bulkBusy}
                              className="text-[11px] font-medium px-2 py-1 rounded-md bg-purple-100 text-purple-800 hover:bg-purple-200 disabled:opacity-40 inline-flex items-center gap-1"
                              title={`Set SLA = ${Math.round(s!.p90_hours!)}h based on observed P90`}
                            >
                              {isRowBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                              Adopt P90
                            </button>
                          )}
                          {similarN > 0 && (
                            <button
                              type="button"
                              onClick={() => applyToSimilar(r)}
                              disabled={isRowBusy || bulkBusy}
                              className="text-[11px] font-medium px-2 py-1 rounded-md bg-stone-100 text-stone-700 hover:bg-stone-200 disabled:opacity-40 inline-flex items-center gap-1"
                              title={`Apply this rule's SLA + escalation to ${similarN} other rule(s) for role ${r.approver_role}`}
                            >
                              <Copy className="h-3 w-3" />
                              Apply to {similarN}
                            </button>
                          )}
                          {!canAdopt && similarN === 0 && r.sla_hours != null && r.is_active && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700">
                              <Check className="h-3 w-3" /> Tuned
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => toggleActive(r)}
                            disabled={isRowBusy || bulkBusy}
                            className={`text-[11px] font-medium px-2 py-1 rounded-md disabled:opacity-40 inline-flex items-center gap-1 ${
                              r.is_active
                                ? 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                                : 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                            }`}
                            title={r.is_active ? 'Deactivate this rule — the matrix trigger stops enforcing it' : 'Reactivate this rule'}
                          >
                            {r.is_active
                              ? (<><PowerOff className="h-3 w-3" /> Deactivate</>)
                              : (<><Power    className="h-3 w-3" /> Activate</>)}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* ─── Add new transition (sandbox-only design surface) ─── */}
      <Card className="border-purple-200">
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="text-base inline-flex items-center gap-2">
            <Plus className="h-4 w-4 text-purple-700" />
            Add a new transition to this Blueprint
          </CardTitle>
          <Button
            type="button"
            onClick={() => setShowAddForm(s => !s)}
            variant={showAddForm ? 'outline' : 'default'}
            className={showAddForm ? '' : 'bg-purple-700 hover:bg-purple-800 text-white'}
          >
            {showAddForm ? 'Cancel' : (<><Plus className="h-4 w-4" /> New transition</>)}
          </Button>
        </CardHeader>

        {showAddForm && (
          <CardContent className="space-y-3">
            <p className="text-xs text-stone-600">
              Design a new <b>{newFromStage} → {newToStage}</b> move, pick the role that owns it,
              optionally set an SLA. The matrix trigger and the SLA inbox pick it up automatically.
            </p>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold">From stage</label>
                <select
                  value={newFromStage}
                  onChange={e => setNewFromStage(e.target.value as typeof STAGES[number])}
                  className="mt-1 h-10 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm"
                >
                  {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold">To stage</label>
                <select
                  value={newToStage}
                  onChange={e => setNewToStage(e.target.value as typeof STAGES[number])}
                  className="mt-1 h-10 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm"
                >
                  {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold">Approver role</label>
                <select
                  value={newApproverRole}
                  onChange={e => setNewApproverRole(e.target.value as typeof ROLES[number])}
                  className="mt-1 h-10 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm"
                >
                  {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold">Override role (optional)</label>
                <select
                  value={newOverrideRole}
                  onChange={e => setNewOverrideRole(e.target.value)}
                  className="mt-1 h-10 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm"
                >
                  <option value="">— None —</option>
                  {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold">SLA (hours, optional)</label>
                <Input
                  type="number"
                  min="1"
                  value={newSlaHours}
                  onChange={e => setNewSlaHours(e.target.value)}
                  className="mt-1"
                  placeholder="leave blank to derive from P90 later"
                />
              </div>
              <div className="flex items-end">
                <label className="inline-flex items-center gap-2 text-sm text-stone-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newRequiresRem}
                    onChange={e => setNewRequiresRem(e.target.checked)}
                  />
                  Requires remarks
                </label>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
              <Button onClick={addRule} disabled={addBusy} className="bg-purple-700 hover:bg-purple-800 text-white">
                {addBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Add transition
              </Button>
              <p className="text-[11px] text-stone-500">
                Rule writes to <code className="text-[10px] bg-stone-100 px-1 rounded">approval_rules</code> with{' '}
                <code className="text-[10px] bg-stone-100 px-1 rounded">module_slug = &apos;blueprint-demo&apos;</code>.
              </p>
            </div>
          </CardContent>
        )}
      </Card>

      <p className="text-[11px] text-stone-500 italic">
        Observed P50 / P90 come from <code className="text-[10px] bg-stone-100 px-1 rounded">approval_rule_stats</code> view, recomputed live from <code className="text-[10px] bg-stone-100 px-1 rounded">approval_events</code>. As real activity accumulates, the suggestions improve automatically.
      </p>

      <p className="text-[11px] text-stone-500">
        ⓘ Setting up Blueprints for <b>production modules</b> (Inventory, JMR, Cost Control, Indents) lives at{' '}
        <a href="/admin/approvals" className="text-purple-700 hover:underline">/admin/approvals</a>{' '}
        — same matrix engine, different scope. This sandbox is the place to design + iterate before applying changes there.
      </p>
    </div>
  )
}
