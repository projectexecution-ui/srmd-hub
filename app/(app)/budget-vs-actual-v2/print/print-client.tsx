'use client'
// V2 Board view — plain-English, one project per A4 page, designed for
// "Ctrl+P → Save as PDF" so the HOD gets a board paper, not a dashboard.

import Link from 'next/link'
import { ArrowLeft, Printer } from 'lucide-react'
import type { ComposeResult, ProjectNode, CatNode } from '@/lib/budget-v2'

function fmtINR(v: number): string {
  if (!isFinite(v) || v === 0) return '₹0'
  const a = Math.abs(v)
  if (a >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`
  if (a >= 1e5) return `₹${(v / 1e5).toFixed(2)} L`
  if (a >= 1e3) return `₹${(v / 1e3).toFixed(1)} K`
  return `₹${Math.round(v).toLocaleString('en-IN')}`
}
function utilPct(spent: number, budget: number): number | null {
  if (!budget || budget <= 0) return null
  return Math.round((spent / budget) * 100)
}
function inrPerSft(amt: number, area: number | null): string {
  if (!area || area <= 0 || amt === 0) return '—'
  return `₹${Math.round(amt / area).toLocaleString('en-IN')}/sft`
}

function projectSentence(p: ProjectNode, groupAvgSft: number | null): string {
  const u = utilPct(p.spent, p.budget)
  const bits: string[] = []
  if (u != null) {
    if (u > 100) bits.push(`is ${u - 100}% over budget`)
    else if (u >= 85) bits.push(`has used ${u}% of its budget`)
    else bits.push(`has used ${u}% of its budget so far`)
  }
  if (p.outstanding > 0) bits.push(`₹${(p.outstanding / 1e5).toFixed(1)} L is still outstanding to vendors`)
  if (p.area && p.area > 0 && groupAvgSft && groupAvgSft > 0) {
    const mySft = p.spent / p.area
    const d = Math.round(((mySft - groupAvgSft) / groupAvgSft) * 100)
    if (Math.abs(d) >= 5) bits.push(`its ₹/sft is ${Math.abs(d)}% ${d > 0 ? 'above' : 'below'} the group average`)
  }
  if (!bits.length) return `${p.name} is tracking on budget.`
  return `${p.name} ${bits.join('; ')}.`
}

export default function PrintClient({ result }: { result: ComposeResult }) {
  const allProjects = result.groups.flatMap(g =>
    g.projects.map(p => ({ p, groupName: g.name, groupAvgSft: groupAvgSft(g.projects) })))
  const t = result.totals
  const overruns = allProjects
    .map(({ p, groupName }) => ({ p, groupName, u: utilPct(p.spent, p.budget) ?? 0 }))
    .filter(x => x.u > 100)
    .sort((a, b) => b.u - a.u)
    .slice(0, 5)
  const generated = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })

  return (
    <div className="bg-gray-100 min-h-screen">
      {/* Toolbar — hidden on print */}
      <div className="no-print sticky top-0 z-10 bg-white border-b border-gray-200 px-4 py-2 flex items-center justify-between">
        <Link href="/budget-vs-actual-v2" className="inline-flex items-center gap-1.5 text-sm text-gray-700 hover:text-gray-900">
          <ArrowLeft className="h-4 w-4" /> Back to tree
        </Link>
        <div className="text-xs text-gray-500">Board view · {allProjects.length} project{allProjects.length === 1 ? '' : 's'}</div>
        <button onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg bg-gray-900 text-white hover:bg-gray-800">
          <Printer className="h-4 w-4" /> Print / Save as PDF
        </button>
      </div>

      <style>{`
        @page { size: A4; margin: 14mm; }
        .page { width: 182mm; min-height: 268mm; margin: 12px auto; background: #fff; padding: 18mm 16mm; box-shadow: 0 2px 12px rgba(0,0,0,0.06); }
        @media print {
          body { background: #fff; }
          .no-print { display: none !important; }
          .page { margin: 0 auto; box-shadow: none; page-break-after: always; }
          .page:last-child { page-break-after: auto; }
        }
        .h1 { font-size: 22px; font-weight: 600; color: #111827; margin: 0; }
        .h2 { font-size: 16px; font-weight: 600; color: #111827; margin: 0 0 4px; }
        .muted { font-size: 11px; color: #6b7280; }
        .lead { font-size: 14px; color: #1f2937; line-height: 1.55; }
        .kpi { border: 1px solid #e5e7eb; border-radius: 10px; padding: 10px 12px; }
        .kpi-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: #6b7280; }
        .kpi-value { font-size: 20px; font-weight: 600; color: #111827; margin-top: 2px; font-variant-numeric: tabular-nums; }
        .kpi-sub { font-size: 10px; color: #9ca3af; margin-top: 2px; font-variant-numeric: tabular-nums; }
        .tbl { width: 100%; border-collapse: collapse; font-size: 12px; }
        .tbl th { text-align: left; font-size: 10px; font-weight: 500; color: #6b7280; text-transform: uppercase; letter-spacing: 0.04em; border-bottom: 1px solid #e5e7eb; padding: 6px 8px; }
        .tbl td { padding: 6px 8px; border-bottom: 1px solid #f3f4f6; font-variant-numeric: tabular-nums; }
        .right { text-align: right; }
        .pill-open { background: #EAF3DE; color: #27500A; }
        .pill-closed { background: #F1EFE8; color: #444441; }
        .pill { font-size: 10px; padding: 2px 8px; border-radius: 999px; }
        .over { color: #A32D2D; font-weight: 500; }
        .ok { color: #27500A; font-weight: 500; }
        .warn { color: #854F0B; font-weight: 500; }
      `}</style>

      {/* Cover */}
      <div className="page">
        <div className="text-xs uppercase tracking-wider text-gray-400">SRMD · Construction</div>
        <h1 className="h1 mt-1">Budget vs Actual — Board Snapshot</h1>
        <p className="muted mt-1">Generated {generated} · {result.groups.length} group{result.groups.length === 1 ? '' : 's'} · {allProjects.length} project{allProjects.length === 1 ? '' : 's'}</p>

        <div className="grid grid-cols-2 gap-3 mt-6">
          <div className="kpi"><div className="kpi-label">Total budget</div><div className="kpi-value">{fmtINR(t.budget)}</div></div>
          <div className="kpi"><div className="kpi-label">Spent so far</div><div className="kpi-value">{fmtINR(t.spent)}</div>
            <div className="kpi-sub">{t.budget > 0 ? `${Math.round(t.spent / t.budget * 100)}% of budget` : ''}</div></div>
          <div className="kpi"><div className="kpi-label">Outstanding to vendors</div><div className="kpi-value">{fmtINR(t.outstanding)}</div></div>
          <div className="kpi"><div className="kpi-label">Average ₹ per sft spent</div><div className="kpi-value">{t.area > 0 ? `₹${Math.round(t.spent / t.area).toLocaleString('en-IN')}` : '—'}</div>
            <div className="kpi-sub">across {Math.round(t.area).toLocaleString('en-IN')} sft</div></div>
        </div>

        <h2 className="h2 mt-7">Where we stand — in a sentence</h2>
        <p className="lead">
          The portfolio has spent <b>{fmtINR(t.spent)}</b> of a <b>{fmtINR(t.budget)}</b> budget
          ({t.budget > 0 ? Math.round(t.spent / t.budget * 100) : 0}%), with <b>{fmtINR(t.outstanding)}</b> still
          outstanding to vendors. {overruns.length === 0
            ? 'No project is currently over its budget.'
            : <>Projects already over budget: <b>{overruns.map(x => x.p.name).join(', ')}</b>.</>}
        </p>

        {overruns.length > 0 && (
          <>
            <h2 className="h2 mt-6">Top overruns to discuss</h2>
            <table className="tbl">
              <thead><tr><th>Project</th><th>Group</th><th className="right">Budget</th><th className="right">Spent</th><th className="right">% used</th></tr></thead>
              <tbody>
                {overruns.map(({ p, groupName, u }) => (
                  <tr key={p.name}>
                    <td>{p.name}</td>
                    <td>{groupName === '— Ungrouped' ? '—' : groupName}</td>
                    <td className="right">{fmtINR(p.budget)}</td>
                    <td className="right over">{fmtINR(p.spent)}</td>
                    <td className="right over">{u}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <p className="muted mt-6">Each project that follows is on its own page — same numbers as the V2 tree, written in plain English.</p>
      </div>

      {/* One project per page */}
      {allProjects.map(({ p, groupName, groupAvgSft }) => {
        const u = utilPct(p.spent, p.budget)
        const tone = u == null ? '' : (u > 100 ? 'over' : (u >= 85 ? 'warn' : 'ok'))
        const cats = topCategories(p)
        return (
          <div className="page" key={p.name}>
            <div className="muted">{groupName === '— Ungrouped' ? 'Standalone' : groupName + ' group'}</div>
            <div className="flex items-center gap-2 mt-1">
              <h1 className="h1">{p.name}</h1>
              <span className={`pill ${p.status === 'open' ? 'pill-open' : 'pill-closed'}`}>{p.status}</span>
              {p.area && <span className="muted">· {p.area.toLocaleString('en-IN')} sft</span>}
            </div>
            <p className="lead mt-3">{projectSentence(p, groupAvgSft)}</p>

            <div className="grid grid-cols-2 gap-3 mt-5">
              <div className="kpi"><div className="kpi-label">Budget</div><div className="kpi-value">{fmtINR(p.budget)}</div><div className="kpi-sub">{inrPerSft(p.budget, p.area)}</div></div>
              <div className="kpi"><div className="kpi-label">Spent so far</div><div className={`kpi-value ${tone}`}>{fmtINR(p.spent)}</div><div className="kpi-sub">{u != null ? `${u}% of budget · ` : ''}{inrPerSft(p.spent, p.area)}</div></div>
              <div className="kpi"><div className="kpi-label">Outstanding</div><div className="kpi-value warn">{fmtINR(p.outstanding)}</div><div className="kpi-sub">{inrPerSft(p.outstanding, p.area)}</div></div>
              <div className="kpi"><div className="kpi-label">Categories tracked</div><div className="kpi-value">{p.categories.length}</div><div className="kpi-sub">{p.categories.filter(c => c.hasBudget && utilPct(c.spent, c.budget)! > 100).length} over budget</div></div>
            </div>

            {cats.length > 0 && (
              <>
                <h2 className="h2 mt-6">Top categories by spend</h2>
                <table className="tbl">
                  <thead><tr><th>Category</th><th className="right">Budget</th><th className="right">Spent</th><th className="right">₹/sft spent</th><th className="right">% used</th></tr></thead>
                  <tbody>
                    {cats.map(c => {
                      const cu = c.hasBudget ? utilPct(c.spent, c.budget) : null
                      const ctone = cu == null ? '' : (cu > 100 ? 'over' : (cu >= 85 ? 'warn' : 'ok'))
                      return (
                        <tr key={c.code + c.label}>
                          <td>{c.code ? `${c.code} ` : ''}{c.label}</td>
                          <td className="right">{c.hasBudget ? fmtINR(c.budget) : '—'}</td>
                          <td className={`right ${ctone}`}>{c.hasBudget ? fmtINR(c.spent) : '—'}</td>
                          <td className="right">{inrPerSft(c.spent, p.area)}</td>
                          <td className={`right ${ctone}`}>{cu != null ? `${cu}%` : '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </>
            )}

            <p className="muted mt-6">For party-by-party detail (contractors &amp; suppliers), open this project in the V2 tree.</p>
          </div>
        )
      })}
    </div>
  )
}

function groupAvgSft(projects: ProjectNode[]): number | null {
  const withArea = projects.filter(p => p.area && p.area > 0)
  const totalArea = withArea.reduce((s, p) => s + (p.area ?? 0), 0)
  const totalSpent = withArea.reduce((s, p) => s + p.spent, 0)
  return totalArea > 0 ? totalSpent / totalArea : null
}

function topCategories(p: ProjectNode): CatNode[] {
  return [...p.categories].sort((a, b) => (b.budget + b.spent) - (a.budget + a.spent)).slice(0, 8)
}
