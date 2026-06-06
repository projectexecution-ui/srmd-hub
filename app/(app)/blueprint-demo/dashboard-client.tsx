'use client'
// Collapsible per-stage groups for the Blueprint Demo dashboard.
// Mirrors the chevron-collapse pattern from
// components/procurement-tracker/PendingReceiptsView.tsx so the
// interaction is consistent across the hub.

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Filter } from 'lucide-react'

interface SlaRow {
  doc_id: string
  doc_no: string
  title: string
  current_status: string
  next_stage: string
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

type BreachFilter = 'all' | 'breached' | 'on_track'

export function BlueprintDemoDashboardClient({ rows }: { rows: SlaRow[] }) {
  const [breachFilter, setBreachFilter] = useState<BreachFilter>('all')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const filtered = useMemo(() => {
    if (breachFilter === 'all') return rows
    return rows.filter(r => breachFilter === 'breached' ? r.breach : !r.breach)
  }, [rows, breachFilter])

  // Group by next_stage — equivalent to "whose desk is it on right now."
  const groups = useMemo(() => {
    const m = new Map<string, { key: string; label: string; rows: SlaRow[]; role: string }>()
    for (const r of filtered) {
      const key = r.next_stage
      if (!m.has(key)) m.set(key, { key, label: `${r.current_status} → ${r.next_stage}`, rows: [], role: r.approver_role })
      m.get(key)!.rows.push(r)
    }
    // Sort by breach count desc
    return [...m.values()].sort((a, b) => {
      const ab = a.rows.filter(r => r.breach).length
      const bb = b.rows.filter(r => r.breach).length
      return bb - ab
    })
  }, [filtered])

  const toggle = (key: string) => setCollapsed(s => {
    const next = new Set(s)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })

  if (rows.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-stone-200 p-10 text-center text-sm text-stone-500">
        No active demo requests. Click <b>Create demo request</b> to seed one and exercise the flow.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-xl border border-stone-200 p-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm">
          <h3 className="font-semibold text-stone-800">All active demo requests</h3>
          <p className="text-xs text-stone-500">
            Showing <b>{filtered.length}</b> of {rows.length}, grouped by <b>next stage</b>.
          </p>
        </div>
        <div className="inline-flex gap-1 flex-wrap items-center">
          <Filter className="h-3.5 w-3.5 text-stone-400" />
          {(['all', 'breached', 'on_track'] as BreachFilter[]).map(v => (
            <button
              key={v}
              onClick={() => setBreachFilter(v)}
              className={`text-[11px] font-medium px-2.5 py-1 rounded-md ${
                breachFilter === v ? 'bg-purple-100 text-purple-800 border border-purple-200' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
              }`}
            >
              {v === 'all' ? 'All' : v === 'breached' ? 'Breached' : 'On track'}
            </button>
          ))}
          {groups.length > 1 && (
            <>
              <span className="text-stone-300 mx-1">·</span>
              <button onClick={() => setCollapsed(new Set(groups.map(g => g.key)))}
                className="text-[11px] font-medium px-2 py-1 rounded-md bg-stone-100 text-stone-600 hover:bg-stone-200 inline-flex items-center gap-1">
                <ChevronRight className="h-3 w-3" /> Collapse all
              </button>
              <button onClick={() => setCollapsed(new Set())}
                className="text-[11px] font-medium px-2 py-1 rounded-md bg-stone-100 text-stone-600 hover:bg-stone-200 inline-flex items-center gap-1">
                <ChevronDown className="h-3 w-3" /> Expand all
              </button>
            </>
          )}
        </div>
      </div>

      {groups.map(g => {
        const isCollapsed = collapsed.has(g.key)
        const breachedInGroup = g.rows.filter(r => r.breach).length
        return (
          <div key={g.key} className="bg-white rounded-xl border border-stone-200 overflow-hidden">
            <button
              type="button"
              onClick={() => toggle(g.key)}
              className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-stone-50 border-b border-stone-100 hover:bg-stone-100"
              aria-expanded={!isCollapsed}
            >
              <div className="flex items-center gap-2 min-w-0">
                {isCollapsed
                  ? <ChevronRight className="h-4 w-4 text-stone-400 flex-shrink-0" />
                  : <ChevronDown  className="h-4 w-4 text-stone-400 flex-shrink-0" />}
                <span className="font-semibold text-stone-800 text-sm">{g.label}</span>
                <span className="text-[11px] text-stone-500">
                  · owned by <b className="text-stone-700">{g.role}</b> · {g.rows.length} item{g.rows.length === 1 ? '' : 's'}
                </span>
                {breachedInGroup > 0 && (
                  <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-800">
                    {breachedInGroup} breached
                  </span>
                )}
              </div>
            </button>

            {!isCollapsed && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-white border-b border-stone-100">
                    <tr className="text-left text-[10px] uppercase tracking-wide text-stone-500">
                      <th className="px-4 py-2">Doc</th>
                      <th className="px-4 py-2">Title</th>
                      <th className="px-4 py-2">Project</th>
                      <th className="px-4 py-2 text-right">In stage</th>
                      <th className="px-4 py-2 text-right">SLA</th>
                      <th className="px-4 py-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-50">
                    {[...g.rows]
                      .sort((a, b) => b.hours_in_status - a.hours_in_status)
                      .map(r => (
                      <tr key={r.doc_id} className="hover:bg-stone-50">
                        <td className="px-4 py-2 font-mono text-[11px] text-stone-700 whitespace-nowrap">
                          <Link href={`/blueprint-demo/requests/${r.doc_id}`} className="text-purple-700 hover:underline">
                            {r.doc_no}
                          </Link>
                        </td>
                        <td className="px-4 py-2 text-xs text-stone-800 max-w-[280px] truncate" title={r.title}>{r.title}</td>
                        <td className="px-4 py-2 text-xs text-stone-500 max-w-[160px] truncate">{r.project_name ?? '—'}</td>
                        <td className={`px-4 py-2 text-right text-xs tabular-nums whitespace-nowrap font-semibold ${
                          r.breach ? 'text-rose-700' : 'text-stone-600'
                        }`}>
                          {Math.round(r.hours_in_status)}h
                        </td>
                        <td className="px-4 py-2 text-right text-[11px] text-stone-500 whitespace-nowrap">
                          {r.sla_hours != null ? (
                            <>
                              {Math.round(r.sla_hours)}h
                              {r.sla_source === 'derived_p90' && <span className="text-[9px] text-indigo-700 font-medium ml-1">(P90)</span>}
                              {r.sla_source === 'configured'  && <span className="text-[9px] text-emerald-700 font-medium ml-1">(set)</span>}
                            </>
                          ) : <span className="text-stone-400">—</span>}
                        </td>
                        <td className="px-4 py-2 text-right text-xs tabular-nums text-stone-700 whitespace-nowrap">
                          {r.amount != null ? `₹${Number(r.amount).toLocaleString('en-IN')}` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
