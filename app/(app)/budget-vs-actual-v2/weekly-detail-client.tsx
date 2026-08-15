'use client'
// Weekly Budget vs Actual — DETAIL PDFs, one project per page. Two modes:
//   • category      → each project page lists its categories
//   • subcategory   → each category also expands to its work-items (sub-rows)
// A group of projects gets a SUMMARY page first (portfolio, grouped, one line per
// project) and then a detailed page per project. Columns: Budget · WO/PO Approved
// · Paid · Balance · Used% · Δ Paid (vs previous upload). Built for Ctrl+P → PDF.
// Single source: the budget report (+ any flagged manual entries).

import { Fragment } from 'react'
import Link from 'next/link'
import { ArrowLeft, Printer } from 'lucide-react'
import type { ComposeResult, CatNode, DeltaResult } from '@/lib/budget-v2'
import type { BudgetV2Freshness } from '@/lib/budget-v2-load'

// ≥ ₹1 Cr → compact crore; under ₹1 Cr → actual amount, Indian-grouped, "/-".
function fmtINR(v: number): string {
  if (!isFinite(v) || v === 0) return '₹0'
  const a = Math.abs(v), s = v < 0 ? '−' : ''
  if (a >= 1e7) return `${s}₹${(a / 1e7).toFixed(2)} Cr`
  return `${s}₹${Math.round(a).toLocaleString('en-IN')}/-`
}
function fmtDelta(v: number | null): string { return v == null ? '—' : v === 0 ? '—' : (v > 0 ? '+' : '−') + fmtINR(Math.abs(v)) }
function perSft(amt: number, area: number | null | undefined): string {
  if (!area || area <= 0 || !amt) return ''
  return `₹${Math.round(amt / area).toLocaleString('en-IN')}/sft`
}
function pct(p: number, b: number): number | null { return b > 0 ? Math.round((p / b) * 100) : null }
function toneClass(u: number | null): string { return u == null ? '' : u > 100 ? 'over' : u >= 85 ? 'warn' : 'ok' }
function deltaClass(v: number | null): string { return v == null || v === 0 ? 'flat' : v > 0 ? 'up' : 'down' }
function normLabel(s: string): string { return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() }
function asOf(iso: string | null): string {
  if (!iso) return '—'
  const t = Date.parse(iso.length === 10 ? iso + 'T00:00:00' : iso); if (!isFinite(t)) return '—'
  return new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
}

export default function WeeklyDetailClient({ result, prev, delta, freshness, prevSnapshotWeek, mode }: {
  result: ComposeResult
  prev: ComposeResult | null
  delta: DeltaResult
  freshness: BudgetV2Freshness
  prevSnapshotWeek: string | null
  mode: 'category' | 'subcategory'
}) {
  const isSub = mode === 'subcategory'
  const t = result.totals
  const usedPct = pct(t.spent, t.budget) ?? 0
  const generated = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })
  const groups = result.groups.map(g => ({ ...g, name: g.name === '— Ungrouped' ? 'Standalone projects' : g.name }))
  const projects = groups.flatMap(g => g.projects.map(p => ({ p, group: g.name })))
  const showSummary = projects.length > 1

  // Previous-upload lookups for category & sub-category Δ.
  const prevProj = new Set<string>()
  const prevCat = new Map<string, number>()
  const prevSub = new Map<string, number>()
  if (prev) for (const g of prev.groups) for (const p of g.projects) {
    prevProj.add(p.name)
    for (const c of p.categories) {
      prevCat.set(p.name + '||' + normLabel(c.label), c.spent)
      for (const sc of c.subcats) prevSub.set(p.name + '||' + normLabel(c.label) + '||' + normLabel(sc.label), sc.spent)
    }
  }
  const catDelta = (proj: string, c: CatNode): number | null =>
    prev && prevProj.has(proj) ? c.spent - (prevCat.get(proj + '||' + normLabel(c.label)) ?? 0) : null
  const subDelta = (proj: string, c: CatNode, sc: { label: string; spent: number }): number | null =>
    prev && prevProj.has(proj) ? sc.spent - (prevSub.get(proj + '||' + normLabel(c.label) + '||' + normLabel(sc.label)) ?? 0) : null
  const projDelta = (name: string): number | null => delta.hasBaseline ? (delta.byProject[name]?.paid ?? 0) : null

  const kind = isSub ? 'Sub-category' : 'Category'

  return (
    <div className="bg-gray-100 min-h-screen">
      <div className="no-print sticky top-0 z-10 bg-white border-b border-gray-200 px-4 py-2 flex items-center justify-between">
        <Link href="/budget-vs-actual-v2" className="inline-flex items-center gap-1.5 text-sm text-gray-700 hover:text-gray-900">
          <ArrowLeft className="h-4 w-4" /> Back to tree
        </Link>
        <div className="text-xs text-gray-500">Weekly · by {kind.toLowerCase()} · {projects.length} projects</div>
        <button onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg bg-gray-900 text-white hover:bg-gray-800">
          <Printer className="h-4 w-4" /> Print / Save as PDF
        </button>
      </div>

      <style>{`
        @page { size: A4 portrait; margin: 11mm; }
        .page { width: 190mm; min-height: 273mm; margin: 12px auto; background:#fff; border:1px solid #e5e7eb; border-radius:10px; padding:14mm 12mm; box-shadow:0 2px 12px rgba(0,0,0,.06); }
        @media print { body{background:#fff} .no-print{display:none!important} .page{margin:0 auto;box-shadow:none;border:none;border-radius:0;width:auto;min-height:0;padding:0;page-break-after:always} .page:last-child{page-break-after:auto} tr{page-break-inside:avoid} }
        .eyebrow { font-size:10px; letter-spacing:.08em; text-transform:uppercase; color:#b8863b; font-weight:700; }
        .h1 { font-size:20px; font-weight:700; color:#111827; margin:2px 0 0; }
        .muted { font-size:11px; color:#6b7280; }
        .pill { font-size:10px; padding:2px 8px; border-radius:999px; }
        .pill-open { background:#EAF3DE; color:#27500A; } .pill-closed { background:#F1EFE8; color:#444441; }
        .manual { font-size:9px; font-weight:700; color:#92400e; background:#fef3c7; border-radius:4px; padding:1px 5px; margin-left:6px; }
        .kpis { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin-top:12px; }
        .kpi { border:1px solid #e5e7eb; border-radius:8px; padding:8px 10px; }
        .kpi .l { font-size:9px; text-transform:uppercase; letter-spacing:.03em; color:#9ca3af; }
        .kpi .n { font-size:15px; font-weight:800; margin-top:2px; font-variant-numeric:tabular-nums; color:#111827; }
        .kpi .d { font-size:9.5px; color:#6b7280; margin-top:1px; font-variant-numeric:tabular-nums; }
        table { width:100%; border-collapse:collapse; font-size:11px; margin-top:12px; }
        thead th { font-size:8.5px; text-transform:uppercase; letter-spacing:.03em; color:#9ca3af; font-weight:700; padding:7px 8px; text-align:right; border-bottom:1px solid #e5e7eb; background:#f8fafc; }
        thead th.l { text-align:left; }
        tbody td { padding:5px 8px; text-align:right; font-variant-numeric:tabular-nums; border-bottom:1px solid #f1f3f5; }
        tbody td.l { text-align:left; }
        tr.grp td { background:#eef2f7; font-weight:800; border-top:1px solid #dbe2ea; } tr.grp td.l { color:#0f2a4a; }
        tr.proj td.l { padding-left:20px; } tr.total td { background:#e2e8f2; font-weight:800; border-top:2px solid #0f2a4a; } tr.total td.l { color:#0f2a4a; }
        tr.cat td { font-weight:600; }
        tr.sub td.l { padding-left:26px; color:#4b5563; font-weight:400; font-size:10px; }
        tr.sub td { color:#4b5563; }
        .code { font-family:ui-monospace,monospace; font-size:9px; color:#9ca3af; margin-right:5px; }
        .sft { font-size:9px; color:#9ca3af; font-weight:600; }
        .appr{color:#0d447c} .ok{color:#1f6f3d;font-weight:700} .warn{color:#8a5a0b;font-weight:700} .over{color:#a3282d;font-weight:700} .neg{color:#a3282d;font-weight:800}
        .up{color:#166534;font-weight:700} .down{color:#9a3412;font-weight:700} .flat{color:#9ca3af}
        .empty { font-size:11px; color:#9ca3af; font-style:italic; margin-top:12px; }
      `}</style>

      {/* ── Summary page (only when there's more than one project) ── */}
      {showSummary && (
        <div className="page">
          <div className="eyebrow">SRMD · Construction</div>
          <h1 className="h1">Weekly Budget vs Actual — by {kind}</h1>
          <div className="muted" style={{ marginTop: 2 }}>Summary · as on {asOf(freshness.budget)} · {projects.length} projects · confidential — management</div>
          <table>
            <thead><tr>
              <th className="l">Project</th><th>Budget</th><th>WO/PO Appr.</th><th>Paid</th><th>Balance</th><th>Used</th><th>Δ Paid (wk)</th>
            </tr></thead>
            <tbody>
              {groups.map(g => {
                const gu = pct(g.spent, g.budget)
                const gd = g.projects.reduce((s, p) => s + (projDelta(p.name) ?? 0), 0)
                return (
                  <Fragment key={g.name}>
                    <tr className="grp">
                      <td className="l">{g.name} · {g.projects.length}</td>
                      <td>{fmtINR(g.budget)}</td><td className="appr">{fmtINR(g.approved)}</td>
                      <td className={toneClass(gu)}>{fmtINR(g.spent)}</td>
                      <td className={g.budget - g.spent < 0 ? 'neg' : ''}>{fmtINR(g.budget - g.spent)}</td>
                      <td className={toneClass(gu)}>{gu != null ? `${gu}%` : '—'}</td>
                      <td className={deltaClass(delta.hasBaseline ? gd : null)}>{delta.hasBaseline ? fmtDelta(gd) : '—'}</td>
                    </tr>
                    {g.projects.map(p => {
                      const u = pct(p.spent, p.budget)
                      return (
                        <tr className="proj" key={p.name}>
                          <td className="l">{p.name}{p.status === 'closed' ? ' · closed' : ''}</td>
                          <td>{fmtINR(p.budget)}</td><td className="appr">{fmtINR(p.approved)}</td>
                          <td className={toneClass(u)}>{fmtINR(p.spent)}</td>
                          <td className={p.budget - p.spent < 0 ? 'neg' : ''}>{fmtINR(p.budget - p.spent)}</td>
                          <td className={toneClass(u)}>{u != null ? `${u}%` : '—'}</td>
                          <td className={deltaClass(projDelta(p.name))}>{fmtDelta(projDelta(p.name))}</td>
                        </tr>
                      )
                    })}
                  </Fragment>
                )
              })}
              <tr className="total">
                <td className="l">TOTAL</td>
                <td>{fmtINR(t.budget)}</td><td className="appr">{fmtINR(t.approved)}</td>
                <td>{fmtINR(t.spent)}</td><td className={t.budget - t.spent < 0 ? 'neg' : ''}>{fmtINR(t.budget - t.spent)}</td>
                <td>{usedPct}%</td>
                <td className={deltaClass(delta.hasBaseline ? delta.overall.paid : null)}>{delta.hasBaseline ? fmtDelta(delta.overall.paid) : '—'}</td>
              </tr>
            </tbody>
          </table>
          <div className="muted" style={{ marginTop: 14 }}>
            Δ Paid = change vs the previous upload{prevSnapshotWeek ? ` (${asOf(prevSnapshotWeek)})` : ''}. Each project follows on its own page →
          </div>
        </div>
      )}

      {/* ── One page per project ── */}
      {projects.map(({ p, group }) => {
        const u = pct(p.spent, p.budget)
        const bal = p.budget - p.spent
        const pd = projDelta(p.name)
        const manual = !!(p.manual && (p.manual.budget || p.manual.approved || p.manual.spent))
        const cats = [...p.categories].sort((a, b) => (a.code || '').localeCompare(b.code || '', undefined, { numeric: true }))
        return (
          <div className="page" key={p.name}>
            <div className="muted">{group}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2, flexWrap: 'wrap' }}>
              <h1 className="h1">{p.name}</h1>
              <span className={`pill ${p.status === 'open' ? 'pill-open' : 'pill-closed'}`}>{p.status}</span>
              {p.area ? <span className="muted">· {p.area.toLocaleString('en-IN')} sft</span> : null}
              {manual && <span className="manual">{p.isExtra ? 'manual entry' : 'adjusted'}</span>}
            </div>

            <div className="kpis">
              <div className="kpi"><div className="l">Budget</div><div className="n">{fmtINR(p.budget)}</div><div className="d">{perSft(p.budget, p.area)}</div></div>
              <div className="kpi"><div className="l">WO/PO Approved</div><div className="n" style={{ color: '#0d447c' }}>{fmtINR(p.approved)}</div></div>
              <div className="kpi"><div className="l">Paid · {u ?? 0}%</div><div className="n" style={{ color: '#1f6f3d' }}>{fmtINR(p.spent)}</div><div className="d">{perSft(p.spent, p.area)}</div></div>
              <div className="kpi"><div className="l">{bal < 0 ? 'Over budget' : 'Balance'}{pd != null && pd !== 0 ? ` · wk ${fmtDelta(pd)}` : ''}</div><div className="n" style={bal < 0 ? { color: '#a3282d' } : undefined}>{fmtINR(Math.abs(bal))}</div></div>
            </div>

            {cats.length === 0 ? (
              <div className="empty">No budget lines for this project.</div>
            ) : (
              <table>
                <thead><tr>
                  <th className="l">{isSub ? 'Category / work-item' : 'Category'}</th>
                  <th>Budget</th><th>WO/PO Appr.</th><th>Paid</th><th>Balance</th><th>Used</th><th>Δ Paid (wk)</th>
                </tr></thead>
                <tbody>
                  {cats.map((c, ci) => {
                    const cu = pct(c.spent, c.budget)
                    const cbal = c.budget - c.spent
                    const cd = catDelta(p.name, c)
                    const subs = isSub ? c.subcats.filter(sc => sc.budget !== 0 || sc.spent !== 0 || sc.approved !== 0) : []
                    return (
                      <Fragment key={c.code + ':' + ci}>
                        <tr className="cat">
                          <td className="l">{c.code && <span className="code">{c.code}</span>}{c.label}</td>
                          <td>{fmtINR(c.budget)}</td><td className="appr">{fmtINR(c.approved)}</td>
                          <td className={toneClass(cu)}>{fmtINR(c.spent)}{perSft(c.spent, p.area) && <span className="sft"> · {perSft(c.spent, p.area)}</span>}</td>
                          <td className={cbal < 0 ? 'neg' : ''}>{fmtINR(cbal)}</td>
                          <td className={toneClass(cu)}>{cu != null ? `${cu}%` : '—'}</td>
                          <td className={deltaClass(cd)}>{fmtDelta(cd)}</td>
                        </tr>
                        {subs.map((sc, si) => {
                          const su = pct(sc.spent, sc.budget)
                          const sbal = sc.budget - sc.spent
                          const sd = subDelta(p.name, c, sc)
                          return (
                            <tr className="sub" key={'s' + ci + '_' + si}>
                              <td className="l">{sc.code && <span className="code">{sc.code}</span>}{sc.label}</td>
                              <td>{fmtINR(sc.budget)}</td><td className="appr">{fmtINR(sc.approved)}</td>
                              <td className={toneClass(su)}>{fmtINR(sc.spent)}</td>
                              <td className={sbal < 0 ? 'neg' : ''}>{fmtINR(sbal)}</td>
                              <td className={toneClass(su)}>{su != null ? `${su}%` : '—'}</td>
                              <td className={deltaClass(sd)}>{fmtDelta(sd)}</td>
                            </tr>
                          )
                        })}
                      </Fragment>
                    )
                  })}
                  <tr className="total">
                    <td className="l">TOTAL · {p.name}</td>
                    <td>{fmtINR(p.budget)}</td><td className="appr">{fmtINR(p.approved)}</td>
                    <td>{fmtINR(p.spent)}</td><td className={bal < 0 ? 'neg' : ''}>{fmtINR(bal)}</td>
                    <td>{u ?? 0}%</td>
                    <td className={deltaClass(pd)}>{fmtDelta(pd)}</td>
                  </tr>
                </tbody>
              </table>
            )}

            <div className="muted" style={{ marginTop: 12 }}>
              From the budget report · Balance = Budget − Paid · Δ Paid vs previous upload{prevSnapshotWeek ? ` (${asOf(prevSnapshotWeek)})` : ''} · generated {generated}
            </div>
          </div>
        )
      })}
    </div>
  )
}
