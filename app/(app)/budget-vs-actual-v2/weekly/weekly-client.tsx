'use client'
// Weekly Budget vs Actual — the simple one-pager the HOD circulates. One line per
// project, grouped by trust, 5 clean columns + a Δ-vs-last-week column. Built for
// "Ctrl+P → Save as PDF". Single source: the budget report (+ any flagged manual
// entries). Far shorter than the IN4 Excel it replaces.

import { Fragment } from 'react'
import Link from 'next/link'
import { ArrowLeft, Printer } from 'lucide-react'
import type { ComposeResult, DeltaResult } from '@/lib/budget-v2'
import type { BudgetV2Freshness } from '@/lib/budget-v2-load'

// ≥ ₹1 Cr → compact crore; under ₹1 Cr → actual amount, Indian-grouped, "/-".
function fmtINR(v: number): string {
  if (!isFinite(v) || v === 0) return '₹0'
  const a = Math.abs(v), s = v < 0 ? '−' : ''
  if (a >= 1e7) return `${s}₹${(a / 1e7).toFixed(2)} Cr`
  return `${s}₹${Math.round(a).toLocaleString('en-IN')}/-`
}
function fmtDelta(v: number): string { return v === 0 ? '—' : (v > 0 ? '+' : '−') + fmtINR(Math.abs(v)) }
function perSft(amt: number, area: number | null | undefined): string {
  if (!area || area <= 0 || !amt) return ''
  return `₹${Math.round(amt / area).toLocaleString('en-IN')}/sft`
}
function pct(p: number, b: number): number | null { return b > 0 ? Math.round((p / b) * 100) : null }
function toneClass(u: number | null): string { return u == null ? '' : u > 100 ? 'over' : u >= 85 ? 'warn' : 'ok' }
function asOf(iso: string | null): string {
  if (!iso) return '—'
  const t = Date.parse(iso); if (!isFinite(t)) return '—'
  return new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
}

export default function WeeklyClient({ result, freshness, delta, prevSnapshotWeek }: {
  result: ComposeResult
  freshness: BudgetV2Freshness
  delta: DeltaResult
  prevSnapshotWeek: string | null
}) {
  const t = result.totals
  const balance = t.budget - t.spent
  const usedPct = pct(t.spent, t.budget) ?? 0
  const groups = result.groups.map(g => ({ ...g, name: g.name === '— Ungrouped' ? 'Standalone projects' : g.name }))
  const nProjects = groups.reduce((s, g) => s + g.projects.length, 0)
  const generated = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })

  return (
    <div className="bg-gray-100 min-h-screen">
      {/* Toolbar — hidden on print */}
      <div className="no-print sticky top-0 z-10 bg-white border-b border-gray-200 px-4 py-2 flex items-center justify-between">
        <Link href="/budget-vs-actual-v2" className="inline-flex items-center gap-1.5 text-sm text-gray-700 hover:text-gray-900">
          <ArrowLeft className="h-4 w-4" /> Back to tree
        </Link>
        <div className="text-xs text-gray-500">Weekly one-pager · {nProjects} projects</div>
        <button onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg bg-gray-900 text-white hover:bg-gray-800">
          <Printer className="h-4 w-4" /> Print / Save as PDF
        </button>
      </div>

      <style>{`
        @page { size: A4 portrait; margin: 12mm; }
        .sheet { width: 190mm; margin: 12px auto; background:#fff; border:1px solid #e5e7eb; border-radius:12px; overflow:hidden; box-shadow:0 2px 12px rgba(0,0,0,.06); }
        @media print { body{background:#fff} .no-print{display:none!important} .sheet{margin:0 auto;box-shadow:none;border:none;border-radius:0;width:auto} tr{page-break-inside:avoid} }
        .head { padding:16px 20px; border-bottom:2px solid #0f2a4a; display:flex; justify-content:space-between; align-items:flex-start; gap:12px; }
        .eyebrow { font-size:10px; letter-spacing:.08em; text-transform:uppercase; color:#b8863b; font-weight:700; }
        .h1 { font-size:19px; font-weight:700; color:#111827; margin:2px 0 0; }
        .asof { font-size:11px; color:#6b7280; margin-top:3px; }
        .badge { font-size:10px; font-weight:700; border-radius:999px; padding:3px 10px; background:#e6f0fa; color:#0d447c; white-space:nowrap; }
        .kpis { display:grid; grid-template-columns:repeat(4,1fr); border-bottom:1px solid #e5e7eb; }
        .kpi { padding:11px 16px; border-right:1px solid #e5e7eb; } .kpi:last-child{border-right:0}
        .kpi .l { font-size:9.5px; text-transform:uppercase; letter-spacing:.03em; color:#9ca3af; }
        .kpi .n { font-size:18px; font-weight:800; margin-top:3px; font-variant-numeric:tabular-nums; color:#111827; }
        .kpi .d { font-size:10px; color:#6b7280; margin-top:2px; }
        table { width:100%; border-collapse:collapse; font-size:11.5px; }
        thead th { font-size:9px; text-transform:uppercase; letter-spacing:.03em; color:#9ca3af; font-weight:700; padding:8px 10px; text-align:right; border-bottom:1px solid #e5e7eb; background:#f8fafc; }
        thead th.l { text-align:left; }
        tbody td { padding:6px 10px; text-align:right; font-variant-numeric:tabular-nums; border-bottom:1px solid #f1f3f5; }
        tbody td.l { text-align:left; }
        tr.grp td { background:#eef2f7; font-weight:800; border-top:1px solid #dbe2ea; }
        tr.grp td.l { color:#0f2a4a; }
        tr.proj td.l { padding-left:22px; }
        tr.total td { background:#e2e8f2; font-weight:800; border-top:2px solid #0f2a4a; font-size:12px; }
        tr.total td.l { color:#0f2a4a; }
        .appr{color:#0d447c} .ok{color:#1f6f3d;font-weight:700} .warn{color:#8a5a0b;font-weight:700} .over{color:#a3282d;font-weight:700}
        .neg{color:#a3282d;font-weight:800}
        .sft{font-size:9px;color:#9ca3af;font-weight:600;margin-top:1px}
        .up{color:#166534;font-weight:700} .down{color:#9a3412;font-weight:700} .flat{color:#9ca3af}
        .manual{ font-size:8.5px; font-weight:700; color:#92400e; background:#fef3c7; border-radius:4px; padding:0 4px; margin-left:5px; }
        .callout { margin:10px 20px 0; padding:9px 12px; border-radius:8px; background:#fbf0dc; border:1px solid #e6cf9b; font-size:10.5px; color:#8a5a0b; line-height:1.5; }
        .foot { padding:10px 20px 14px; font-size:9.5px; color:#9ca3af; display:flex; justify-content:space-between; gap:8px; }
      `}</style>

      <div className="sheet">
        <div className="head">
          <div>
            <div className="eyebrow">SRMD · Construction</div>
            <div className="h1">Weekly Budget vs Actual</div>
            <div className="asof">As on {asOf(freshness.budget)} · from CT HUB · confidential — management</div>
          </div>
          <span className="badge">{nProjects} projects</span>
        </div>

        <div className="kpis">
          <div className="kpi"><div className="l">Total budget</div><div className="n">{fmtINR(t.budget)}</div></div>
          <div className="kpi"><div className="l">Paid to date</div><div className="n" style={{ color: '#1f6f3d' }}>{fmtINR(t.spent)}</div><div className="d">{usedPct}% of budget{t.area > 0 ? ` · avg ${perSft(t.spent, t.area)}` : ''}</div></div>
          <div className="kpi"><div className="l">{balance < 0 ? 'Over budget' : 'Balance left'}</div><div className="n" style={balance < 0 ? { color: '#a3282d' } : undefined}>{fmtINR(Math.abs(balance))}</div></div>
          <div className="kpi"><div className="l">Paid this week</div>
            <div className="n" style={{ color: delta.hasBaseline ? (delta.overall.paid >= 0 ? '#166534' : '#9a3412') : '#9ca3af' }}>{delta.hasBaseline ? fmtDelta(delta.overall.paid) : '— first upload'}</div>
            <div className="d">{delta.hasBaseline ? `vs upload of ${asOf(prevSnapshotWeek)}` : 'no earlier upload'}</div>
          </div>
        </div>

        <table>
          <thead><tr>
            <th className="l">Project</th><th>Budget</th><th>WO/PO Appr.</th><th>Paid</th><th>Balance</th><th>Used</th><th>Δ Paid (wk)</th>
          </tr></thead>
          <tbody>
            {groups.map(g => {
              const gu = pct(g.spent, g.budget)
              const gd = g.projects.reduce((s, p) => s + (delta.hasBaseline ? (delta.byProject[p.name]?.paid ?? 0) : 0), 0)
              return (
                <Fragment key={g.name}>
                  <tr className="grp">
                    <td className="l">{g.name} · {g.projects.length}</td>
                    <td>{fmtINR(g.budget)}</td><td className="appr">{fmtINR(g.approved)}</td>
                    <td className={toneClass(gu)}>{fmtINR(g.spent)}</td>
                    <td className={g.budget - g.spent < 0 ? 'neg' : ''}>{fmtINR(g.budget - g.spent)}</td>
                    <td className={toneClass(gu)}>{gu != null ? `${gu}%` : '—'}</td>
                    <td className={!delta.hasBaseline ? 'flat' : gd > 0 ? 'up' : gd < 0 ? 'down' : 'flat'}>{delta.hasBaseline ? fmtDelta(gd) : '—'}</td>
                  </tr>
                  {g.projects.map(p => {
                    const u = pct(p.spent, p.budget)
                    const dp = delta.hasBaseline ? (delta.byProject[p.name]?.paid ?? 0) : 0
                    const manual = !!(p.manual && (p.manual.budget || p.manual.approved || p.manual.spent))
                    return (
                      <tr className="proj" key={p.name}>
                        <td className="l">{p.name}{p.status === 'closed' ? ' · closed' : ''}{p.area ? <span style={{ color: '#9ca3af', fontWeight: 400 }}> · {p.area.toLocaleString('en-IN')} sft</span> : null}{manual && <span className="manual">{p.isExtra ? 'manual' : 'adj'}</span>}</td>
                        <td>{fmtINR(p.budget)}{perSft(p.budget, p.area) && <div className="sft">{perSft(p.budget, p.area)}</div>}</td>
                        <td className="appr">{fmtINR(p.approved)}{perSft(p.approved, p.area) && <div className="sft">{perSft(p.approved, p.area)}</div>}</td>
                        <td className={toneClass(u)}>{fmtINR(p.spent)}{perSft(p.spent, p.area) && <div className="sft">{perSft(p.spent, p.area)}</div>}</td>
                        <td className={p.budget - p.spent < 0 ? 'neg' : ''}>{fmtINR(p.budget - p.spent)}{perSft(p.budget - p.spent, p.area) && <div className="sft">{perSft(p.budget - p.spent, p.area)}</div>}</td>
                        <td className={toneClass(u)}>{u != null ? `${u}%` : '—'}</td>
                        <td className={!delta.hasBaseline ? 'flat' : dp > 0 ? 'up' : dp < 0 ? 'down' : 'flat'}>{delta.hasBaseline ? fmtDelta(dp) : '—'}</td>
                      </tr>
                    )
                  })}
                </Fragment>
              )
            })}
            <tr className="total">
              <td className="l">TOTAL</td>
              <td>{fmtINR(t.budget)}{perSft(t.budget, t.area) && <div className="sft">{perSft(t.budget, t.area)}</div>}</td>
              <td className="appr">{fmtINR(t.approved)}{perSft(t.approved, t.area) && <div className="sft">{perSft(t.approved, t.area)}</div>}</td>
              <td>{fmtINR(t.spent)}{perSft(t.spent, t.area) && <div className="sft">{perSft(t.spent, t.area)}</div>}</td>
              <td className={balance < 0 ? 'neg' : ''}>{fmtINR(balance)}{perSft(balance, t.area) && <div className="sft">{perSft(balance, t.area)}</div>}</td>
              <td>{usedPct}%</td>
              <td className={!delta.hasBaseline ? 'flat' : delta.overall.paid > 0 ? 'up' : delta.overall.paid < 0 ? 'down' : 'flat'}>{delta.hasBaseline ? fmtDelta(delta.overall.paid) : '—'}</td>
            </tr>
          </tbody>
        </table>

        {!delta.hasBaseline && (
          <div className="callout">
            <b>First upload — nothing to compare against yet.</b> The “Δ Paid (wk)” column fills in automatically once a second budget report is uploaded — it compares the latest upload against the previous one.
          </div>
        )}

        <div className="foot"><span>CT HUB · Budget vs Actual · one line per project</span><span>Generated {generated}</span></div>
      </div>
    </div>
  )
}
