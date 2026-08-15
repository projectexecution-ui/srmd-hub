// Budget vs Actual V2 → Telegram report card (pure, testable).
//
// Maps the composed V2 tree into the shared CardSpec so the weekly management
// card mirrors the /budget-vs-actual-v2 page: grouped Group -> Project, money
// columns (Budget / WO-PO Approved / Paid / Balance), ₹/sft, open-on-top, plus a
// staleness banner when the budget report is old. Single source: every number
// comes from the uploaded budget report. Uses the same ₹ Cr/L/K formatting as the
// page's client so the numbers read identically.

import type { ComposeResult, DeltaResult } from '@/lib/budget-v2'
import type { CardSpec, CardSection, CardRow, CardTone } from '@/lib/telegram/card-spec'
import type { BudgetV2Freshness } from '@/lib/budget-v2-load'

export interface BudgetV2Report {
  title: string
  body: string
  cardSpec: CardSpec
  reportText: string
}

// Same compact ₹ as app/(app)/budget-vs-actual-v2/client.tsx fmtINR.
function fmtINR(v: number): string {
  if (!isFinite(v) || v === 0) return '₹0'
  const a = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(2)} Cr`
  if (a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(2)} L`
  if (a >= 1e3) return `${sign}₹${(a / 1e3).toFixed(1)} K`
  return `${sign}₹${Math.round(a).toLocaleString('en-IN')}`
}
function perSft(v: number, area: number | null): string {
  if (!area || area <= 0 || !isFinite(v) || v === 0) return ''
  return Math.round(v / area).toLocaleString('en-IN')
}
function pctOf(spent: number, budget: number): number | null {
  if (!budget || budget <= 0) return null
  return Math.round((spent / budget) * 100)
}
function pctTone(pct: number): CardTone {
  return pct >= 100 ? 'danger' : pct >= 85 ? 'warn' : 'ok'
}
function ageDays(iso: string | null, nowMs: number): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!isFinite(t)) return null
  return Math.floor((nowMs - t) / 86_400_000)
}
// Signed compact ₹ for week-over-week movement (e.g. "+₹42.0 L").
function fmtDelta(v: number): string {
  if (!v) return '₹0'
  return (v > 0 ? '+' : '−') + fmtINR(Math.abs(v))
}

/**
 * Build the weekly Budget vs Actual card from the V2 tree. Returns null when
 * nothing carries budget/spend (so the cron can silently no-op). When `delta`
 * has a baseline, the card shows week-over-week movement (Δ Paid).
 */
export function buildBudgetV2Report(result: ComposeResult, freshness: BudgetV2Freshness, nowMs: number, delta?: DeltaResult): BudgetV2Report | null {
  // Drop pure-placeholder rows (no budget, no spend) so the card shows only
  // projects that have real numbers. Dropped rows contribute 0, so the portfolio
  // totals (result.totals) stay exact.
  const groups = result.groups
    .map(g => ({ ...g, projects: g.projects.filter(p => p.budget > 0 || p.spent > 0) }))
    .filter(g => g.projects.length > 0)
  const nProjects = groups.reduce((s, g) => s + g.projects.length, 0)
  if (nProjects === 0) return null

  const t = result.totals
  const spentPct = pctOf(t.spent, t.budget) ?? 0
  const balance = t.budget - t.spent
  const avgSft = t.area > 0 ? Math.round(t.spent / t.area) : 0
  const nGroups = groups.length

  // ── Sections: one per group, project rows underneath ──
  const sections: CardSection[] = groups.map(g => {
    const withArea = g.projects.filter(p => p.area && p.area > 0)
    const gArea = withArea.reduce((s, p) => s + (p.area ?? 0), 0)
    const gAvgSft = gArea > 0 ? Math.round(withArea.reduce((s, p) => s + p.spent, 0) / gArea) : null
    const gpct = pctOf(g.spent, g.budget)

    const rows: CardRow[] = g.projects.map(p => {
      const ppct = pctOf(p.spent, p.budget)
      const sft = perSft(p.spent, p.area)
      const pbal = p.budget - p.spent
      const subParts = [`Budget ${fmtINR(p.budget)}`, `Paid ${fmtINR(p.spent)}`]
      if (p.budget > 0) subParts.push(`Bal ${fmtINR(pbal)}`)
      const dpaid = delta?.hasBaseline ? (delta.byProject[p.name]?.paid ?? 0) : 0
      if (dpaid !== 0) subParts.push(`wk ${fmtDelta(dpaid)}`)
      if (sft) subParts.push(`₹${sft}/sft`)
      return {
        main: p.status === 'closed' ? `${p.name} · closed` : p.name,
        sub: subParts.join(' · '),
        right: ppct != null ? `${ppct}%` : '—',
        rightTone: ppct != null ? pctTone(ppct) : 'neutral',
      }
    })

    const subBits = [`Budget ${fmtINR(g.budget)}`, `Paid ${fmtINR(g.spent)}${gpct != null ? ` (${gpct}%)` : ''}`]
    subBits.push(`Bal ${fmtINR(g.budget - g.spent)}`)
    if (gAvgSft) subBits.push(`avg ₹${gAvgSft.toLocaleString('en-IN')}/sft`)

    return {
      heading: `${g.name} · ${g.projects.length} project${g.projects.length === 1 ? '' : 's'}`,
      sub: subBits.join(' · '),
      rows,
    }
  })

  // ── Staleness banner (matches the page's ">= 14 days = stale") ──
  const staleBits: string[] = []
  const bAge = ageDays(freshness.budget, nowMs)
  if (bAge == null) staleBits.push('budget not synced')
  else if (bAge >= 14) staleBits.push(`budget ${bAge}d old`)
  if (staleBits.length && sections.length) {
    sections[0].banner = {
      text: `Budget report may be stale — ${staleBits.join(' · ')}. Re-upload on the Budget vs Actual V2 page to refresh.`,
      tone: 'warn',
    }
  }

  const cardSpec: CardSpec = {
    brand: 'Budget vs Actual',
    title: 'Budget vs Actual — portfolio',
    subtitle: 'Confidential · management',
    stats: [
      { label: 'Total budget', value: fmtINR(t.budget), sub: `${nProjects} projects · ${nGroups} group${nGroups === 1 ? '' : 's'}`, tone: 'brand' },
      {
        label: `Paid · ${spentPct}% of budget`,
        value: fmtINR(t.spent),
        sub: `${balance < 0 ? 'Over budget' : 'Balance'} ${fmtINR(Math.abs(balance))}${delta?.hasBaseline ? ` · this week ${fmtDelta(delta.overall.paid)}` : ''}${avgSft > 0 ? ` · avg ₹${avgSft.toLocaleString('en-IN')}/sft` : ''}`,
        tone: pctTone(spentPct),
      },
    ],
    sections,
    footer: 'CT HUB · Budget vs Actual · Confidential · management',
  }

  // ── In-app body + full-detail text fallback (Telegram uses this if the image
  //    ever fails to render). Tree shape, no special glyphs (Noto-safe). ──
  const title = `Budget vs Actual — ${nProjects} projects`
  const wkOverall = delta?.hasBaseline ? ` · Paid this week ${fmtDelta(delta.overall.paid)}` : ''
  const body = `${nProjects} projects · Budget ${fmtINR(t.budget)} · Paid ${fmtINR(t.spent)} (${spentPct}% used) · Balance ${fmtINR(balance)}${wkOverall}.`

  const lines: string[] = [body, '']
  for (const g of groups) {
    const gpct = pctOf(g.spent, g.budget)
    lines.push(`[${g.name}] Budget ${fmtINR(g.budget)} · Paid ${fmtINR(g.spent)}${gpct != null ? ` (${gpct}%)` : ''} · Bal ${fmtINR(g.budget - g.spent)}`)
    for (const p of g.projects) {
      const ppct = pctOf(p.spent, p.budget)
      const sft = perSft(p.spent, p.area)
      const dpaid = delta?.hasBaseline ? (delta.byProject[p.name]?.paid ?? 0) : 0
      const wk = dpaid !== 0 ? ` · wk ${fmtDelta(dpaid)}` : ''
      lines.push(`  - ${p.name}${p.status === 'closed' ? ' (closed)' : ''} · Budget ${fmtINR(p.budget)} · Paid ${fmtINR(p.spent)}${ppct != null ? ` (${ppct}%)` : ''} · Bal ${fmtINR(p.budget - p.spent)}${wk}${sft ? ` · ₹${sft}/sft` : ''}`)
    }
  }
  const reportText = lines.join('\n')

  return { title, body, cardSpec, reportText }
}
