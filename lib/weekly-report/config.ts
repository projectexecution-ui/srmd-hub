// The Monday Budget vs Actual report — WHAT goes in it and HOW it is grouped.
//
// Aksha, 11 Sep 2026: the live IN4 feed turned the weekly report from her 24
// curated Excel projects into 41 IN4 cost centres under IN4's own inconsistent
// headings. This file is the layer between IN4's list and the report: every
// IN4 line is placed under a MAIN PROJECT, given a readable label (lines with
// the same label inside one project are merged), and can be marked Design
// (hidden until the "include Design" switch is on) or simply hidden.
//
// Pure — no database. Stored as JSON in app_settings[WEEKLY_CONFIG_KEY]; the
// defaults below are the list Aksha approved on 11 Sep 2026.

import type { ComposeResult, GroupNode, ProjectNode, CatNode, SubCatNode } from '@/lib/budget-v2'

export const WEEKLY_CONFIG_KEY = 'weekly_report_config'
export const WEEKLY_EVENT = 'cc_budget_vs_actual_report'
/** Lines IN4 has that nobody has placed yet land here, so money never vanishes silently. */
export const UNPLACED_GROUP = 'New in IN4 — not placed yet'

export interface WeeklyLine {
  /** The IN4 cost-centre name exactly as budget_hub_state carries it. The key. */
  in4: string
  /** The main project it sits under. */
  project: string
  /** What the reader sees; defaults to the IN4 name. Same label in one project = merged into one line. */
  label?: string
  /** A design / consultancy line — shown only when includeDesign is on. */
  design?: boolean
  /** false hides the line entirely. */
  show?: boolean
}

export interface WeeklyRecipient { card: boolean; email: boolean }

export interface WeeklyConfig {
  lines: WeeklyLine[]
  includeDesign: boolean
  /** Post the PDF set to the Telegram reports group. */
  groupPdfs: boolean
  /** userId → channels. null = not chosen yet: management roles get everything. */
  recipients: Record<string, WeeklyRecipient> | null
  /** IST Monday date (YYYY-MM-DD) of the last real send — the once-a-week guard. */
  lastSentWeek: string | null
}

const L = (in4: string, project: string, label?: string, design = false): WeeklyLine => ({ in4, project, ...(label ? { label } : {}), ...(design ? { design: true } : {}) })

export const DEFAULT_LINES: WeeklyLine[] = [
  L('NGH A', 'NGH'), L('NGH B', 'NGH'), L('NGH C', 'NGH'), L('NGH Infra', 'NGH'),
  L('NGH Common', 'NGH', 'NGH Common expenses'),
  L('New Guest House - Infra Work - Design', 'NGH', 'Infra Work Design', true),

  L('SRAH', 'SRAH'),

  L('A01 Building', 'P2 Stepped Terraces'), L('A02 Building', 'P2 Stepped Terraces'), L('A03 Building', 'P2 Stepped Terraces'),
  L('P2 Infra', 'P2 Stepped Terraces'),
  L('P2 Common', 'P2 Stepped Terraces', 'P2 Common expenses and consultancy'),
  L('P2 Stepped Terraces - Professional Consultancy', 'P2 Stepped Terraces', 'P2 Common expenses and consultancy'),

  L('Vinay Building', 'Vinay Vivek'), L('Vivek Building', 'Vinay Vivek'), L('VV Infra', 'Vinay Vivek'),
  L('VV Common', 'Vinay Vivek', 'VV Common expenses'),

  L('CV 4', 'CV Renovation'), L('CV 5', 'CV Renovation'),
  L('CV Renovation - Common Expenses', 'CV Renovation', 'CV Common expenses'),

  L('Admin Block', 'Admin Block'),
  L('Admin Block Ground Floor - Execution', 'Admin Block', 'Ground Floor Execution'),
  L('Admin Block 1st Floor', 'Admin Block', '1st Floor'),
  L('Admin Block - Common Expenses', 'Admin Block', 'Common expenses, ICT team, Security team'),
  L('Admin Block - SRMD Ashram ICT Team', 'Admin Block', 'Common expenses, ICT team, Security team'),
  L('Admin Block - SRMD Ashram Security Team', 'Admin Block', 'Common expenses, ICT team, Security team'),

  L('Welcome Centre Extension', 'Welcome Centre Extension'),
  L('Welcome Centre Extension - Common Expenses', 'Welcome Centre Extension', 'Common expenses'),
  L('Welcome Centre Extension - Design', 'Welcome Centre Extension', 'Design', true),

  L('Raj Uphaar - Interior Scope', 'Raj Uphaar Interior Scope'),
  L('Raj Saurabh - Interior Scope', 'Raj Saurabh Interior Scope'),
  L('Old Swadhyay Hall', 'Old Swadhyay Hall'),

  L('Ekant Kutir', 'Ekant Kutir'),
  L('Ekant Kutirs - Common Expenses', 'Ekant Kutir', 'Common expenses'),

  L('Naturopathy', 'Naturopathy'),
  L('Row House', 'Row House'),

  L('P2 Row Houses - Common Expenses', 'P2 Row Houses', 'Common expenses'),
  L('P2 Row Houses - Design', 'P2 Row Houses', 'Design', true),

  L('Civil & MEP Central Warehouse', 'Civil and MEP Central Warehouse', 'Warehouse'),
  L('Civil & MEP Central Warehouse - Common Expenses', 'Civil and MEP Central Warehouse', 'Common expenses'),

  L('Sheth House - Design', 'Sheth House', 'Design', true),
]

export const DEFAULT_WEEKLY_CONFIG: WeeklyConfig = {
  lines: DEFAULT_LINES,
  includeDesign: false,
  groupPdfs: true,
  recipients: null,
  lastSentWeek: null,
}

/** Cost Control roles that receive the report until an admin picks people by hand. */
export const DEFAULT_RECIPIENT_ROLES = new Set(['admin', 'founder', 'head', 'project_head'])

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** Tolerant: a missing or broken setting reads as the defaults; unknown fields are dropped. */
export function parseWeeklyConfig(raw: string | null | undefined): WeeklyConfig {
  if (!raw) return DEFAULT_WEEKLY_CONFIG
  let v: unknown
  try { v = JSON.parse(raw) } catch { return DEFAULT_WEEKLY_CONFIG }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return DEFAULT_WEEKLY_CONFIG
  const o = v as Record<string, unknown>
  const lines: WeeklyLine[] = Array.isArray(o.lines)
    ? (o.lines as unknown[]).flatMap(x => {
        if (!x || typeof x !== 'object') return []
        const r = x as Record<string, unknown>
        const in4 = str(r.in4), project = str(r.project)
        if (!in4 || !project) return []
        const line: WeeklyLine = { in4, project }
        const label = str(r.label); if (label && label !== in4) line.label = label
        if (r.design === true) line.design = true
        if (r.show === false) line.show = false
        return [line]
      })
    : DEFAULT_LINES
  let recipients: Record<string, WeeklyRecipient> | null = null
  if (o.recipients && typeof o.recipients === 'object' && !Array.isArray(o.recipients)) {
    recipients = {}
    for (const [id, rv] of Object.entries(o.recipients as Record<string, unknown>)) {
      if (!/^[0-9a-f-]{36}$/i.test(id) || !rv || typeof rv !== 'object') continue
      const r = rv as Record<string, unknown>
      recipients[id] = { card: r.card !== false, email: r.email !== false }
    }
  }
  const week = str(o.lastSentWeek)
  return {
    lines: dedupe(lines),
    includeDesign: o.includeDesign === true,
    groupPdfs: o.groupPdfs !== false,
    recipients,
    lastSentWeek: /^\d{4}-\d{2}-\d{2}$/.test(week) ? week : null,
  }
}

/** One entry per IN4 name; the last wins, so an edit appended later replaces the old row. */
function dedupe(lines: WeeklyLine[]): WeeklyLine[] {
  const m = new Map<string, WeeklyLine>()
  for (const l of lines) m.set(l.in4, l)
  return [...m.values()]
}

export function serializeWeeklyConfig(cfg: WeeklyConfig): string {
  return JSON.stringify({ ...cfg, lines: dedupe(cfg.lines) })
}

/** IST date (YYYY-MM-DD) of the Monday of the week containing `nowMs`. */
export function mondayOf(nowMs: number): string {
  const ist = new Date(nowMs + 5.5 * 3_600_000)
  const dow = ist.getUTCDay() // 0 Sun … 6 Sat
  const back = (dow + 6) % 7 // days since Monday
  ist.setUTCDate(ist.getUTCDate() - back)
  return ist.toISOString().slice(0, 10)
}

export function isMondayIST(nowMs: number): boolean {
  return new Date(nowMs + 5.5 * 3_600_000).getUTCDay() === 1
}

export interface AppliedWeekly {
  result: ComposeResult
  /** IN4 lines that exist with money but have no place in the config. Shown in Admin; reported under UNPLACED_GROUP. */
  unplaced: string[]
  /** Config lines whose IN4 name no longer exists in the feed. */
  missing: string[]
}

/**
 * Re-shape the composed IN4 tree into Aksha's list: main projects as groups,
 * labelled lines as projects, same-label lines merged, Design lines dropped
 * unless includeDesign. Totals are recomputed from what is shown. Pure.
 */
export function applyWeeklyConfig(input: ComposeResult, cfg: WeeklyConfig): AppliedWeekly {
  const byIn4 = new Map<string, ProjectNode>()
  for (const g of input.groups) for (const p of g.projects) byIn4.set(p.name, p)

  const placed = new Set<string>()
  const missing: string[] = []
  // project → label → merged node (insertion order = config order)
  const groups = new Map<string, Map<string, ProjectNode>>()

  for (const line of cfg.lines) {
    const src = byIn4.get(line.in4)
    if (!src) { missing.push(line.in4); continue }
    placed.add(line.in4)
    if (line.show === false) continue
    if (line.design && !cfg.includeDesign) continue
    const label = line.label?.trim() || line.in4
    const lines = groups.get(line.project) ?? new Map<string, ProjectNode>()
    groups.set(line.project, lines)
    const existing = lines.get(label)
    lines.set(label, existing ? mergeNodes(existing, src) : cloneAs(src, label, line.project))
  }

  // Anything IN4 has that nobody placed, with money, still gets reported — under its own heading.
  const unplaced: string[] = []
  for (const [name, p] of byIn4) {
    if (placed.has(name)) continue
    if (p.budget === 0 && p.spent === 0 && p.approved === 0) continue
    unplaced.push(name)
    const lines = groups.get(UNPLACED_GROUP) ?? new Map<string, ProjectNode>()
    groups.set(UNPLACED_GROUP, lines)
    lines.set(name, cloneAs(p, name, UNPLACED_GROUP))
  }

  const outGroups: GroupNode[] = []
  for (const [name, lines] of groups) {
    const projects = [...lines.values()]
    outGroups.push({
      name,
      projects,
      budget: sum(projects, p => p.budget), approved: sum(projects, p => p.approved),
      spent: sum(projects, p => p.spent), area: sum(projects, p => p.area ?? 0),
    })
  }
  const result: ComposeResult = {
    groups: outGroups,
    totals: {
      budget: sum(outGroups, g => g.budget), approved: sum(outGroups, g => g.approved),
      spent: sum(outGroups, g => g.spent), area: sum(outGroups, g => g.area),
    },
  }
  return { result, unplaced, missing }
}

const sum = <T,>(xs: T[], f: (x: T) => number): number => xs.reduce((s, x) => s + f(x), 0)

/** A line named by its label — the label becomes the KEY for deltas and snapshots, so baselines match week to week. */
function cloneAs(p: ProjectNode, label: string, group: string): ProjectNode {
  const { displayName: _dn, ...rest } = p
  void _dn
  return { ...rest, name: label, group, categories: p.categories.map(cloneCat) }
}
const cloneCat = (c: CatNode): CatNode => ({ ...c, subcats: c.subcats.map(s => ({ ...s })) })

/** Sum two lines into one: money, area, and categories matched by label. */
function mergeNodes(a: ProjectNode, b: ProjectNode): ProjectNode {
  const cats = new Map<string, CatNode>()
  for (const c of [...a.categories, ...b.categories.map(cloneCat)]) {
    const key = c.label.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    const cur = cats.get(key)
    if (!cur) { cats.set(key, c); continue }
    cur.budget += c.budget; cur.approved += c.approved; cur.spent += c.spent
    cur.hasBudget = cur.hasBudget || c.hasBudget
    cur.subcats = mergeSubcats(cur.subcats, c.subcats)
  }
  const area = (a.area ?? 0) + (b.area ?? 0)
  return {
    ...a,
    status: a.status === 'open' || b.status === 'open' ? 'open' : 'closed',
    area: area > 0 ? area : null,
    budget: a.budget + b.budget, approved: a.approved + b.approved, spent: a.spent + b.spent,
    categories: [...cats.values()].sort((x, y) => (x.code || '').localeCompare(y.code || '', undefined, { numeric: true })),
    manual: { budget: !!(a.manual?.budget || b.manual?.budget), approved: !!(a.manual?.approved || b.manual?.approved), spent: !!(a.manual?.spent || b.manual?.spent) },
    uploaded: undefined, manualNote: null, manualAt: null,
  }
}
function mergeSubcats(a: SubCatNode[], b: SubCatNode[]): SubCatNode[] {
  const m = new Map<string, SubCatNode>()
  for (const s of [...a, ...b]) {
    const k = s.label.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    const cur = m.get(k)
    if (cur) { cur.budget += s.budget; cur.approved += s.approved; cur.spent += s.spent }
    else m.set(k, { ...s })
  }
  return [...m.values()]
}

/**
 * Who the report goes to: the chosen map, or (until one is chosen) everyone
 * holding a management role. `card` is the master switch — off means the person
 * is not sent to at all (the Telegram DM rides the in-app card and cannot be
 * split from it); `email` can be switched off on its own.
 */
export function resolveRecipients(
  cfg: WeeklyConfig,
  people: Array<{ id: string; ccRole: string; active: boolean }>,
): Array<{ id: string; card: boolean; email: boolean }> {
  if (cfg.recipients) {
    return people
      .filter(p => p.active && cfg.recipients![p.id]?.card)
      .map(p => ({ id: p.id, ...cfg.recipients![p.id] }))
  }
  return people.filter(p => p.active && DEFAULT_RECIPIENT_ROLES.has(p.ccRole)).map(p => ({ id: p.id, card: true, email: true }))
}
