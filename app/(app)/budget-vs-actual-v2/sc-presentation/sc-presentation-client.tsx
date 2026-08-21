'use client'
// SC Presentation — a pick-your-projects Budget vs Actual hand-out for the HOD.
// SC format (agreed with Aksha): title without "Weekly"/confidential; NO WO/PO,
// NO Used, NO Balance, NO open/closed status. Each amount (Budget + Paid/Actual)
// carries its ₹/sft on the line BELOW it. Summary page has no TOTAL row; projects
// are ordered by cost per sft (highest first). Each project gets its own category
// page. Optional per-project descriptor (shown under the name) and an "Actual
// Paid" reconciliation — when the true paid differs from the report, the gap is
// shown on a separate "Advance / Other Paid" line so no category goes negative.
// Choices persist in this browser (localStorage). Browser-print → PDF.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Printer, Search, Check } from 'lucide-react'
import type { ComposeResult, ProjectNode } from '@/lib/budget-v2'
import type { BudgetV2Freshness } from '@/lib/budget-v2-load'

// ≥ ₹1 Cr → compact crore; under ₹1 Cr → actual amount, Indian-grouped, "/-".
function fmtINR(v: number): string {
  if (!isFinite(v) || v === 0) return '₹0'
  const a = Math.abs(v), s = v < 0 ? '−' : ''
  if (a >= 1e7) return `${s}₹${(a / 1e7).toFixed(2)} Cr`
  return `${s}₹${Math.round(a).toLocaleString('en-IN')}/-`
}
function perSft(amt: number, area: number | null | undefined): string {
  if (!area || area <= 0 || !amt) return ''
  return `₹${Math.round(amt / area).toLocaleString('en-IN')}/sft`
}
function asOf(iso: string | null): string {
  if (!iso) return '—'
  const t = Date.parse(iso.length === 10 ? iso + 'T00:00:00' : iso); if (!isFinite(t)) return '—'
  return new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
}

// Pre-filled descriptors (editable). Only applied when the user hasn't set one.
const DEFAULT_DESC: Record<string, string> = {
  'Raj Saurabh - Interior Scope': 'Experience Area – Gr Floor',
  'Raj Uphaar - Interior Scope': 'Divine Shop (Gr Floor) + VIP Dining (1st Floor)',
}
const LS_SEL = 'bv2_sc_selected'
const LS_DESC = 'bv2_sc_desc'
const LS_PAID = 'bv2_sc_paid'

export default function ScPresentationClient({ result, freshness }: {
  result: ComposeResult
  freshness: BudgetV2Freshness
}) {
  const allProjects = useMemo(() => result.groups.flatMap(g => g.projects), [result])
  const byName = useMemo(() => new Map(allProjects.map(p => [p.name, p])), [allProjects])

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [desc, setDesc] = useState<Record<string, string>>({})
  const [paid, setPaid] = useState<Record<string, string>>({}) // raw input strings
  const [query, setQuery] = useState('')
  const [hydrated, setHydrated] = useState(false)

  // Load saved choices (this browser).
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(LS_SEL) || '[]') as string[]
      const d = JSON.parse(localStorage.getItem(LS_DESC) || '{}') as Record<string, string>
      const p = JSON.parse(localStorage.getItem(LS_PAID) || '{}') as Record<string, string>
      setSelected(new Set(s.filter(n => byName.has(n))))
      setDesc(d); setPaid(p)
    } catch { /* ignore */ }
    setHydrated(true)
  }, [byName])
  useEffect(() => { if (hydrated) localStorage.setItem(LS_SEL, JSON.stringify([...selected])) }, [selected, hydrated])
  useEffect(() => { if (hydrated) localStorage.setItem(LS_DESC, JSON.stringify(desc)) }, [desc, hydrated])
  useEffect(() => { if (hydrated) localStorage.setItem(LS_PAID, JSON.stringify(paid)) }, [paid, hydrated])

  const descOf = (name: string) => (desc[name] ?? DEFAULT_DESC[name] ?? '')
  const paidOverrideOf = (name: string): number | null => {
    const raw = (paid[name] ?? '').replace(/[₹,\s/-]/g, '')
    if (raw === '') return null
    const n = Number(raw)
    return isFinite(n) && n > 0 ? n : null
  }
  const effPaid = (p: ProjectNode) => paidOverrideOf(p.name) ?? p.spent
  const costSft = (p: ProjectNode) => (p.area && p.area > 0 ? effPaid(p) / p.area : 0)

  const toggle = (name: string) => setSelected(prev => {
    const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n
  })

  const chosen = allProjects.filter(p => selected.has(p.name)).sort((a, b) => costSft(b) - costSft(a))
  const filtered = allProjects.filter(p => p.name.toLowerCase().includes(query.toLowerCase()))
  const generated = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })

  return (
    <div className="bg-gray-100 min-h-screen">
      {/* ── Toolbar + picker (never printed) ── */}
      <div className="no-print">
        <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-4 py-2 flex items-center justify-between gap-2">
          <Link href="/budget-vs-actual-v2" className="inline-flex items-center gap-1.5 text-sm text-gray-700 hover:text-gray-900">
            <ArrowLeft className="h-4 w-4" /> Back to tree
          </Link>
          <div className="text-xs text-gray-500 hidden sm:block">SC Presentation · {chosen.length} selected</div>
          <button onClick={() => window.print()} disabled={chosen.length === 0}
            className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed">
            <Printer className="h-4 w-4" /> Print / Save as PDF
          </button>
        </div>

        <div className="max-w-3xl mx-auto p-4 space-y-3">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">SC Presentation</h1>
            <p className="text-[13px] text-gray-500">Pick the projects to present. Budget vs Actual with ₹/sft — ordered by cost per sft. Your selection is remembered on this device.</p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="h-4 w-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search projects…"
                className="w-full pl-8 pr-3 py-2 text-sm rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-200" />
            </div>
            <button onClick={() => setSelected(new Set(allProjects.map(p => p.name)))}
              className="text-xs font-medium px-2.5 py-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50">Select all</button>
            <button onClick={() => setSelected(new Set())}
              className="text-xs font-medium px-2.5 py-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50">Clear</button>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white divide-y divide-gray-100 overflow-hidden">
            {filtered.length === 0 && <div className="px-3 py-6 text-center text-sm text-gray-400">No projects match “{query}”.</div>}
            {filtered.map(p => {
              const on = selected.has(p.name)
              return (
                <div key={p.name} className={on ? 'bg-amber-50/40' : ''}>
                  <button onClick={() => toggle(p.name)} className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50">
                    <span className={`h-4.5 w-4.5 flex-shrink-0 rounded border flex items-center justify-center ${on ? 'bg-gray-900 border-gray-900' : 'border-gray-300 bg-white'}`} style={{ height: 18, width: 18 }}>
                      {on && <Check className="h-3 w-3 text-white" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13.5px] font-medium text-gray-800 truncate">{p.name}</span>
                      <span className="block text-[11px] text-gray-500 tabular-nums">
                        Budget {fmtINR(p.budget)} · Paid {fmtINR(p.spent)}{p.area ? ` · ${p.area.toLocaleString('en-IN')} sft` : ' · area not set'}
                      </span>
                    </span>
                  </button>
                  {on && (
                    <div className="px-3 pb-3 pl-11 grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <label className="text-[11px] text-gray-500">
                        Descriptor (shown under the name)
                        <input value={descOf(p.name)} onChange={e => setDesc(d => ({ ...d, [p.name]: e.target.value }))}
                          placeholder="e.g. Experience Area – Gr Floor"
                          className="mt-0.5 w-full px-2 py-1.5 text-[13px] rounded-md border border-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-200" />
                      </label>
                      <label className="text-[11px] text-gray-500">
                        Actual Paid (optional — reconcile)
                        <input value={paid[p.name] ?? ''} onChange={e => setPaid(d => ({ ...d, [p.name]: e.target.value }))}
                          placeholder={`report: ${Math.round(p.spent).toLocaleString('en-IN')}`}
                          inputMode="numeric"
                          className="mt-0.5 w-full px-2 py-1.5 text-[13px] tabular-nums rounded-md border border-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-200" />
                        {paidOverrideOf(p.name) != null && paidOverrideOf(p.name)! !== p.spent && (
                          <span className="block mt-0.5 text-[10.5px] text-amber-700">
                            +{fmtINR(paidOverrideOf(p.name)! - p.spent)} → “Advance / Other Paid” line
                          </span>
                        )}
                      </label>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          {chosen.length === 0 && <p className="text-[12px] text-gray-400 text-center">Select at least one project, then Print / Save as PDF.</p>}
        </div>
      </div>

      {/* ── Print output ── */}
      <ScStyles />
      {chosen.length > 0 && (
        <>
          {/* Summary page (no TOTAL row) */}
          <div className="page">
            <div className="eyebrow">SRMD · Construction</div>
            <h1 className="h1">Budget vs Actual — by Category</h1>
            <div className="muted" style={{ marginTop: 2 }}>Summary · as on {asOf(freshness.budget)}</div>
            <table>
              <thead><tr>
                <th className="l">Project</th><th>Area (sft)</th><th>Budget</th><th>Paid</th>
              </tr></thead>
              <tbody>
                {chosen.map(p => {
                  const ep = effPaid(p)
                  return (
                    <tr className="row" key={p.name}>
                      <td className="l">
                        <span className="pname">{p.name}</span>
                        {descOf(p.name) && <span className="pdesc">{descOf(p.name)}</span>}
                      </td>
                      <td>{p.area ? p.area.toLocaleString('en-IN') : '—'}</td>
                      <td>{fmtINR(p.budget)}{perSft(p.budget, p.area) && <span className="sft">{perSft(p.budget, p.area)}</span>}</td>
                      <td className="ok">{fmtINR(ep)}{perSft(ep, p.area) && <span className="sft">{perSft(ep, p.area)}</span>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div className="muted" style={{ marginTop: 14 }}>
              Ordered by cost per sft (highest first). ₹/sft (below each amount) = amount ÷ built-up area. Each project detailed on its own page →
            </div>
          </div>

          {/* One page per project */}
          {chosen.map(p => {
            const ep = effPaid(p)
            const adj = paidOverrideOf(p.name) != null ? ep - p.spent : 0
            const cats = [...p.categories].sort((a, b) => (a.code || '').localeCompare(b.code || '', undefined, { numeric: true }))
            return (
              <div className="page" key={p.name}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  <h1 className="h1">{p.name}</h1>
                  {p.area ? <span className="muted">· {p.area.toLocaleString('en-IN')} sft</span> : null}
                </div>
                {descOf(p.name) && <div className="desc">{descOf(p.name)}</div>}

                <div className="kpis">
                  <div className="kpi"><div className="l">Budget</div><div className="n">{fmtINR(p.budget)}</div><div className="d">{perSft(p.budget, p.area) || '—'}</div></div>
                  <div className="kpi"><div className="l">Paid (Actual)</div><div className="n" style={{ color: '#1f6f3d' }}>{fmtINR(ep)}</div><div className="d">{perSft(ep, p.area) || '—'}</div></div>
                </div>

                {cats.length === 0 ? (
                  <div className="empty">No budget lines for this project.</div>
                ) : (
                  <table>
                    <thead><tr>
                      <th className="l">Category</th><th>Budget</th><th>Paid</th>
                    </tr></thead>
                    <tbody>
                      {cats.map((c, ci) => (
                        <tr className="cat" key={c.code + ':' + ci}>
                          <td className="l">{c.code && <span className="code">{c.code}</span>}{c.label}</td>
                          <td>{fmtINR(c.budget)}{perSft(c.budget, p.area) && <span className="sft">{perSft(c.budget, p.area)}</span>}</td>
                          <td className="ok">{fmtINR(c.spent)}{perSft(c.spent, p.area) && <span className="sft">{perSft(c.spent, p.area)}</span>}</td>
                        </tr>
                      ))}
                      {adj !== 0 && (
                        <tr className="cat" key="__adj">
                          <td className="l">Advance / Other Paid</td>
                          <td>—</td>
                          <td className="ok">{fmtINR(adj)}{perSft(adj, p.area) && <span className="sft">{perSft(adj, p.area)}</span>}</td>
                        </tr>
                      )}
                      <tr className="total">
                        <td className="l">TOTAL · {p.name}</td>
                        <td>{fmtINR(p.budget)}{perSft(p.budget, p.area) && <span className="sft">{perSft(p.budget, p.area)}</span>}</td>
                        <td>{fmtINR(ep)}{perSft(ep, p.area) && <span className="sft">{perSft(ep, p.area)}</span>}</td>
                      </tr>
                    </tbody>
                  </table>
                )}

                {adj !== 0 && (
                  <div className="muted" style={{ marginTop: 10 }}>
                    Advance / Other Paid = {fmtINR(adj)} paid outside budgeted categories; total paid reconciled to {fmtINR(ep)}.
                  </div>
                )}
                <div className="muted" style={{ marginTop: 12 }}>
                  From the budget report · ₹/sft = amount ÷ built-up area · generated {generated}
                </div>
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}

function ScStyles() {
  return (
    <style>{`
      @page { size: A4 portrait; margin: 11mm; }
      .page, table, tr, td, th { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .page { width: 190mm; min-height: 273mm; margin: 12px auto; background:#fff; border:1px solid #e5e7eb; border-radius:10px; padding:14mm 12mm; box-shadow:0 2px 12px rgba(0,0,0,.06); }
      @media print { body{background:#fff} .no-print{display:none!important} .page{margin:0 auto;box-shadow:none;border:none;border-radius:0;width:auto;min-height:0;padding:0;page-break-after:always} .page:last-child{page-break-after:auto} tr{page-break-inside:avoid} }
      @media screen { .page { display:block } }
      .eyebrow { font-size:10px; letter-spacing:.08em; text-transform:uppercase; color:#b8863b; font-weight:700; }
      .h1 { font-size:20px; font-weight:700; color:#111827; margin:2px 0 0; }
      .desc { font-size:12.5px; color:#b8863b; font-weight:600; margin-top:3px; }
      .muted { font-size:11px; color:#6b7280; }
      .kpis { display:grid; grid-template-columns:repeat(2,1fr); gap:10px; margin-top:14px; }
      .kpi { border:1px solid #e5e7eb; border-radius:8px; padding:10px 12px; }
      .kpi .l { font-size:9.5px; text-transform:uppercase; letter-spacing:.03em; color:#9ca3af; }
      .kpi .n { font-size:18px; font-weight:800; margin-top:3px; font-variant-numeric:tabular-nums; color:#111827; }
      .kpi .d { font-size:10.5px; color:#6b7280; margin-top:3px; font-variant-numeric:tabular-nums; }
      table { width:100%; border-collapse:collapse; font-size:11.5px; margin-top:14px; }
      thead th { font-size:8.5px; text-transform:uppercase; letter-spacing:.03em; color:#9ca3af; font-weight:700; padding:8px; text-align:right; border-bottom:1px solid #e5e7eb; background:#f8fafc; }
      thead th.l { text-align:left; }
      tbody td { padding:9px 8px; text-align:right; font-variant-numeric:tabular-nums; border-bottom:1px solid #f1f3f5; vertical-align:top; }
      tbody td.l { text-align:left; }
      tr.cat td { font-weight:600; background:rgba(15,42,74,0.05); }
      tr.total td { background:#e2e8f2; font-weight:800; border-top:2px solid #0f2a4a; } tr.total td.l { color:#0f2a4a; }
      .pname { display:block; font-weight:600; color:#111827; }
      .pdesc { display:block; font-size:10px; color:#6b7280; font-weight:500; margin-top:2px; }
      .code { font-family:ui-monospace,monospace; font-size:9px; color:#9ca3af; margin-right:5px; }
      .sft { display:block; font-size:9px; color:#9ca3af; font-weight:600; margin-top:3px; }
      .ok { color:#1f6f3d; font-weight:700; }
      .empty { font-size:11px; color:#9ca3af; font-style:italic; margin-top:12px; }
    `}</style>
  )
}
