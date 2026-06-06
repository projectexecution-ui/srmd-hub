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
import { Loader2, Sparkles, Copy, Check } from 'lucide-react'

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

export function AdminMatrixClient({ rules, stats }: { rules: Rule[]; stats: Stat[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)   // row id being mutated
  const [bulkBusy, setBulkBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

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
  async function patchRule(id: string, patch: { sla_hours?: number | null; escalate_to_role?: string | null }) {
    const supabase = createClient()
    const { error } = await supabase
      .from('approval_rules')
      .update(patch)
      .eq('id', id)
      .eq('module_slug', 'blueprint-demo')  // belt + suspenders
    return error
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
                    <tr key={r.id} className="hover:bg-stone-50">
                      <td className="px-3 py-2 text-stone-800 whitespace-nowrap">
                        <span className="font-medium">{r.from_stage}</span>
                        <span className="text-stone-400 mx-1">→</span>
                        <span className="font-medium">{r.to_stage}</span>
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
                          {!canAdopt && similarN === 0 && r.sla_hours != null && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700">
                              <Check className="h-3 w-3" /> Tuned
                            </span>
                          )}
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

      <p className="text-[11px] text-stone-500 italic">
        Observed P50 / P90 come from <code className="text-[10px] bg-stone-100 px-1 rounded">approval_rule_stats</code> view, recomputed live from <code className="text-[10px] bg-stone-100 px-1 rounded">approval_events</code>. As real activity accumulates, the suggestions improve automatically.
      </p>
    </div>
  )
}
