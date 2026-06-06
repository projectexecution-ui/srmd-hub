// Smart Aging Dashboard for the Blueprint Demo sandbox.
// Built against blueprint_demo_sla_inbox() RPC so every metric here
// is computed in SQL — the page just renders. If this UX works for
// Aksha, the Phase 2 plan generalises the RPC to all 5 production
// modules without page-side changes.

import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import {
  ClipboardList, AlertTriangle, Clock, Settings, ListChecks, Plus, FlaskConical,
} from 'lucide-react'
import { BlueprintDemoDashboardClient } from './dashboard-client'

export const dynamic = 'force-dynamic'

interface SlaRow {
  module_slug: string
  doc_table: string
  doc_id: string
  doc_no: string
  title: string
  current_status: string
  next_stage: string
  entered_status_at: string
  hours_in_status: number
  sla_hours: number | null
  sla_source: 'configured' | 'derived_p90' | null
  breach: boolean
  breach_severity: 'mild' | 'overdue' | 'critical' | null
  project_code: string | null
  project_name: string | null
  amount: number | null
  approver_role: string
}

interface RuleStats {
  module_slug: string
  doc_type: string
  from_stage: string
  to_stage: string
  approver_role: string
  sample_count: number
  median_hours: number | null
  p90_hours: number | null
}

export default async function BlueprintDemoDashboardPage() {
  await requirePermission('blueprint-demo', 'view')
  const supabase = await createClient()

  // SLA inbox — every non-terminal demo request with computed breach state.
  const { data: rawRows, error: inboxErr } = await supabase
    .rpc('blueprint_demo_sla_inbox')
  const rows = (rawRows ?? []) as SlaRow[]

  // Bottleneck card — average dwell per (from_stage→to_stage) vs SLA.
  // Computed from approval_rule_stats (the view that aggregates
  // approval_events into P50/P90 per rule).
  const { data: rawStats } = await supabase
    .from('approval_rule_stats')
    .select('module_slug, doc_type, from_stage, to_stage, approver_role, sample_count, median_hours, p90_hours')
    .eq('module_slug', 'blueprint-demo')
  const stats = (rawStats ?? []) as RuleStats[]

  // Pull the rules so we can compare each stat's median_hours vs the
  // configured sla_hours (or fall back to p90) — that's the bottleneck.
  const { data: rawRules } = await supabase
    .from('approval_rules')
    .select('module_slug, doc_type, from_stage, to_stage, sla_hours, approver_role')
    .eq('module_slug', 'blueprint-demo')
  const rules = (rawRules ?? []) as Array<{
    module_slug: string; doc_type: string;
    from_stage: string; to_stage: string;
    sla_hours: number | null; approver_role: string
  }>

  // Build the bottleneck — the (from_stage, to_stage) where the
  // median dwell time most exceeds its threshold, ratio-wise.
  const bottleneck = (() => {
    let worst: { from_stage: string; to_stage: string; approver_role: string;
                 median: number; threshold: number; ratio: number } | null = null
    for (const st of stats) {
      const matchRule = rules.find(r =>
        r.from_stage === st.from_stage && r.to_stage === st.to_stage)
      const threshold = matchRule?.sla_hours ?? st.p90_hours ?? null
      if (threshold == null || st.median_hours == null) continue
      const ratio = st.median_hours / threshold
      if (ratio < 1) continue   // ignore stages performing within SLA
      if (!worst || ratio > worst.ratio) {
        worst = {
          from_stage: st.from_stage, to_stage: st.to_stage,
          approver_role: st.approver_role,
          median: st.median_hours, threshold,
          ratio,
        }
      }
    }
    return worst
  })()

  // KPI strip — counts at the top.
  const breached       = rows.filter(r => r.breach).length
  const breachedAbove3 = rows.filter(r => r.breach && r.hours_in_status > 72).length
  const breachedAbove7 = rows.filter(r => r.breach && r.hours_in_status > 168).length

  // Forecast strip — projected breaches in the next 24 h / 48 h
  // assuming nothing moves. Item is in danger if its current
  // hours_in_status PLUS lookahead would cross its SLA.
  const projectedNext24 = rows.filter(r => !r.breach && r.sla_hours != null
    && (r.hours_in_status + 24) > r.sla_hours).length
  const projectedNext48 = rows.filter(r => !r.breach && r.sla_hours != null
    && (r.hours_in_status + 48) > r.sla_hours).length

  // Today's chase list — top 5 by severity × age × amount.
  const severityWeight = { critical: 3, overdue: 2, mild: 1 } as const
  const chaseList = [...rows]
    .filter(r => r.breach)
    .sort((a, b) => {
      const sa = severityWeight[a.breach_severity as keyof typeof severityWeight] ?? 0
      const sb = severityWeight[b.breach_severity as keyof typeof severityWeight] ?? 0
      const aScore = sa * a.hours_in_status * Math.max(1, Math.log10(Math.max(1, Number(a.amount ?? 1))))
      const bScore = sb * b.hours_in_status * Math.max(1, Math.log10(Math.max(1, Number(b.amount ?? 1))))
      return bScore - aScore
    })
    .slice(0, 5)

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <PageHeader
          title="Blueprint Demo"
          back="/dashboard"
          subtitle="Sandbox for Smart Blueprints — every metric below is computed by the same RPC + view pattern we'd extend to your production modules in Phase 2."
        />
        <div className="flex gap-2 flex-wrap">
          <Link href="/blueprint-demo/requests" className="inline-flex items-center gap-1.5 text-xs font-medium bg-white border border-gray-200 hover:border-gray-300 rounded-lg px-3 py-2 text-gray-700">
            <ListChecks className="h-4 w-4" /> Requests
          </Link>
          <Link href="/blueprint-demo/requests/new" className="inline-flex items-center gap-1.5 text-xs font-medium bg-purple-700 hover:bg-purple-800 text-white rounded-lg px-3 py-2">
            <Plus className="h-4 w-4" /> Create demo request
          </Link>
          <Link href="/blueprint-demo/admin" className="inline-flex items-center gap-1.5 text-xs font-medium bg-white border border-gray-200 hover:border-gray-300 rounded-lg px-3 py-2 text-gray-700">
            <Settings className="h-4 w-4" /> Admin matrix
          </Link>
        </div>
      </div>

      {/* Sandbox notice */}
      <Card className="p-3 bg-purple-50 border-purple-200 text-sm flex items-start gap-2">
        <FlaskConical className="h-4 w-4 text-purple-700 flex-shrink-0 mt-0.5" />
        <span className="text-purple-900">
          <b>This is a sandbox.</b> Every transition you make here is recorded in <code className="text-[11px] bg-purple-100 px-1 rounded">approval_events</code> &mdash; the same table the production modules use. Deleting this module drops one migration and one folder.
        </span>
      </Card>

      {inboxErr && (
        <Card className="bg-rose-50 border-rose-200 p-4 text-sm text-rose-800">
          Failed to load SLA inbox: {inboxErr.message}
        </Card>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Active in-flight" value={String(rows.length)} sub="non-terminal" tone="stone" icon={ClipboardList} />
        <Kpi label="Breached" value={String(breached)} sub="past SLA right now" tone={breached > 0 ? 'rose' : 'stone'} icon={AlertTriangle} />
        <Kpi label="Breached &gt; 3d" value={String(breachedAbove3)} sub="≥ 72 h in stage" tone={breachedAbove3 > 0 ? 'rose' : 'stone'} icon={AlertTriangle} />
        <Kpi label="Breached &gt; 7d" value={String(breachedAbove7)} sub="≥ 168 h in stage" tone={breachedAbove7 > 0 ? 'rose' : 'stone'} icon={AlertTriangle} />
      </div>

      {/* Forecast strip */}
      {(projectedNext24 + projectedNext48 > 0) && (
        <Card className="p-3 bg-amber-50 border-amber-200 text-sm flex items-center gap-2 flex-wrap">
          <Clock className="h-4 w-4 text-amber-700 flex-shrink-0" />
          <span className="text-amber-900">
            <b>Forecast</b> &mdash; if nothing moves:{' '}
            <b>{projectedNext24}</b> item{projectedNext24 === 1 ? '' : 's'} will breach in the next 24 h,
            <b className="ml-1">{projectedNext48}</b> within 48 h.
          </span>
        </Card>
      )}

      {/* Bottleneck card — the system pointing at the actual problem */}
      {bottleneck && (
        <Card className="p-4 bg-rose-50 border-rose-200">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-rose-700 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-rose-700 font-bold mb-1">
                Biggest bottleneck right now
              </p>
              <p className="text-sm text-rose-900">
                Transition <b>{bottleneck.from_stage} → {bottleneck.to_stage}</b>
                {' '}(owned by <b>{bottleneck.approver_role}</b>) is averaging{' '}
                <b>{Math.round(bottleneck.median)} h</b> against a threshold of{' '}
                <b>{Math.round(bottleneck.threshold)} h</b> &mdash;{' '}
                <b>{Math.round((bottleneck.ratio - 1) * 100)}%</b> over.
              </p>
              <Link
                href="/blueprint-demo/admin"
                className="text-[12px] text-rose-700 font-medium hover:underline mt-1 inline-block"
              >
                Review the rule and tighten the threshold →
              </Link>
            </div>
          </div>
        </Card>
      )}

      {/* Today's chase list — top 5 most urgent */}
      {chaseList.length > 0 && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-2 inline-flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4 text-rose-600" />
            Today&apos;s chase list — top 5 most urgent
          </h3>
          <p className="text-xs text-gray-500 mb-3">
            Ranked by severity × hours-stuck × log(amount). Click to open and act.
          </p>
          <div className="space-y-1.5">
            {chaseList.map(r => (
              <Link
                key={r.doc_id}
                href={`/blueprint-demo/requests/${r.doc_id}`}
                className="flex items-baseline gap-3 px-3 py-2 rounded-lg hover:bg-stone-50 border border-stone-100 text-sm"
              >
                <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${
                  r.breach_severity === 'critical' ? 'bg-red-100 text-red-800' :
                  r.breach_severity === 'overdue'  ? 'bg-rose-100 text-rose-800' :
                                                     'bg-amber-100 text-amber-800'
                }`}>
                  {r.breach_severity}
                </span>
                <span className="font-mono text-[11px] text-stone-500 whitespace-nowrap">{r.doc_no}</span>
                <span className="text-stone-800 flex-1 truncate" title={r.title}>{r.title}</span>
                <span className="text-[11px] text-stone-500 whitespace-nowrap">
                  {r.current_status} → <span className="text-stone-800 font-medium">{r.next_stage}</span>
                </span>
                <span className="text-xs font-bold text-rose-700 tabular-nums whitespace-nowrap">
                  {Math.round(r.hours_in_status)}h
                </span>
              </Link>
            ))}
          </div>
        </Card>
      )}

      {/* Full list, grouped by next_stage (which equates to "who owns it") */}
      <BlueprintDemoDashboardClient rows={rows} />
    </div>
  )
}

function Kpi({ label, value, sub, tone, icon: Icon }: {
  label: string; value: string; sub: string; tone: 'stone'|'rose';
  icon: React.ComponentType<{ className?: string }>;
}) {
  const lineClass = tone === 'rose' ? 'bg-rose-600' : 'bg-stone-400'
  const valueClass = tone === 'rose' ? 'text-rose-700' : 'text-stone-800'
  return (
    <Card className="relative p-4 overflow-hidden">
      <span className={`absolute left-0 top-0 bottom-0 w-1 ${lineClass}`} />
      <p className="text-[10px] uppercase tracking-wider text-stone-500 font-semibold inline-flex items-center gap-1">
        <Icon className="h-3 w-3" /> {label}
      </p>
      <p className={`text-2xl font-bold tabular-nums mt-1 ${valueClass}`}>{value}</p>
      <p className="text-[11px] text-stone-500 mt-0.5">{sub}</p>
    </Card>
  )
}
