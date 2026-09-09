import { describe, it, expect } from 'vitest'
import { WORKSPACE_TABS, SETUP_TAB, visibleWorkspaceTabs, findWorkspaceTab } from './workspace'
import {
  kebab, tabSlug, subSlug, tabAccess, subAccess, allowedSubs, landingSub, canOpenWorkspaceTab, visibleWorkspaceTabsV2,
  allowedSubsByTab, buildMatrixSections, allWsSlugs, filterRows, REVAMP_MODULE_SLUGS, type PermLike,
} from './permissions'
import { MODULES } from '@/lib/modules'

const budget = WORKSPACE_TABS[0]
const woPo = findWorkspaceTab('wo-po')!
const indents = findWorkspaceTab('procurement')!
const scBudget = findWorkspaceTab('sc-budgets')!
const jmr = findWorkspaceTab('jmr')!
const qc = findWorkspaceTab('qc')! // unbuilt

const view = (...slugs: string[]): PermLike => Object.fromEntries(slugs.map(s => [s, { view: true, edit: false, admin: false }]))
const deny = (perms: PermLike, ...slugs: string[]): PermLike => ({ ...perms, ...Object.fromEntries(slugs.map(s => [s, { view: false, edit: false, admin: false }])) })

describe('slugs', () => {
  it('names a tab and a pill in role_permissions without touching the schema', () => {
    expect(tabSlug(budget)).toBe('ws:budget')
    expect(tabSlug(woPo)).toBe('ws:wo-po')
    expect(subSlug(budget, 'By order')).toBe('ws:budget:by-order')
    expect(subSlug(woPo, 'BOQ upload')).toBe('ws:wo-po:boq-upload')
    expect(subSlug(jmr, 'Measured vs certified')).toBe('ws:jmr:measured-vs-certified')
    expect(kebab('Consultants & Specialised Cost')).toBe('consultants-and-specialised-cost')
  })
  it('every ws slug is unique, lower-case and never collides with a module slug', () => {
    const all = allWsSlugs()
    expect(new Set(all).size).toBe(all.length)
    expect(all.every(s => /^ws:[a-z0-9-]+(:[a-z0-9-]+)?$/.test(s))).toBe(true)
    const mods = new Set(MODULES.map(m => m.slug))
    expect(all.some(s => mods.has(s))).toBe(false)
  })
})

describe('day one — no ws rows — is exactly today', () => {
  const engineer = view('cost-control', 'procurement-tracker', 'jmr', 'warehouse')
  it('a tab inherits its module', () => {
    expect(tabAccess(engineer, budget)).toEqual({ view: true, source: 'module' })
    expect(tabAccess(engineer, indents)).toEqual({ view: true, source: 'module' })
    expect(tabAccess(engineer, scBudget)).toEqual({ view: false, source: 'module' })
    // unbuilt tabs hang off cost-control, as the ribbon always did
    expect(tabAccess(engineer, qc)).toEqual({ view: true, source: 'module' })
  })
  it('the V2 ribbon equals the old ribbon for every role shape', () => {
    const shapes: PermLike[] = [
      engineer,
      view('cost-control'),
      view('cost-control', 'budget-vs-actual-v2', 'contractor-report'),
      {},
      view('procurement-tracker'), // no cost-control: nothing, as before
    ]
    for (const p of shapes) for (const reviewer of [true, false]) {
      expect(visibleWorkspaceTabsV2(p, new Set(), reviewer).map(t => t.slug)).toEqual(visibleWorkspaceTabs(p, new Set(), reviewer).map(t => t.slug))
    }
  })
  it('every pill is open when the tab is', () => {
    expect(allowedSubs(engineer, budget)).toEqual([0, 1, 2])
    expect(allowedSubs(engineer, woPo)).toEqual([0, 1, 2, 3])
    expect(allowedSubs(engineer, scBudget)).toEqual([])
  })
})

describe('a tab switch of its own', () => {
  const engineer = view('cost-control', 'procurement-tracker', 'jmr')
  it('an explicit deny hides a tab the module would have shown', () => {
    const p = deny(engineer, 'ws:wo-po')
    expect(tabAccess(p, woPo)).toEqual({ view: false, source: 'tab' })
    expect(tabAccess(p, indents)).toEqual({ view: true, source: 'module' })
    expect(visibleWorkspaceTabsV2(p, new Set(), true).map(t => t.slug)).not.toContain('wo-po')
  })
  it('an explicit allow shows a tab the module would have hidden', () => {
    const p = { ...engineer, 'ws:sc-budgets': { view: true } }
    expect(tabAccess(p, scBudget)).toEqual({ view: true, source: 'tab' })
    expect(visibleWorkspaceTabsV2(p, new Set(), true).map(t => t.slug)).toContain('sc-budgets')
  })
  it('a module switched off portal-wide still hides the tab, whatever the tab row says', () => {
    const p = { ...engineer, 'ws:procurement': { view: true } }
    expect(canOpenWorkspaceTab(p, indents, new Set(['procurement-tracker']), true)).toBe(false)
  })
  it('reviewer-only tabs still need the reviewer flag', () => {
    const accounts = findWorkspaceTab('accounts')!
    const p = { ...engineer, 'ws:accounts': { view: true } }
    expect(canOpenWorkspaceTab(p, accounts, new Set(), false)).toBe(false)
    expect(canOpenWorkspaceTab(p, accounts, new Set(), true)).toBe(true)
  })
  it('a row with no view flag is not a decision', () => {
    const p = { ...engineer, 'ws:wo-po': {} }
    expect(tabAccess(p, woPo)).toEqual({ view: true, source: 'module' })
  })
})

describe('pills', () => {
  const engineer = view('cost-control', 'procurement-tracker')
  it('a pill can be closed on its own; the rest stay', () => {
    const p = deny(engineer, 'ws:wo-po:boq-upload')
    expect(subAccess(p, woPo, 'BOQ upload')).toBe(false)
    expect(allowedSubs(p, woPo)).toEqual([0, 1, 2])
  })
  it('a closed tab closes every pill, even one explicitly allowed', () => {
    const p = { ...deny(engineer, 'ws:wo-po'), 'ws:wo-po:pos': { view: true } }
    expect(allowedSubs(p, woPo)).toEqual([])
  })
  it('lands on the pill asked for when allowed, else the first allowed, else nowhere', () => {
    const p = deny(engineer, 'ws:budget:by-category')
    expect(landingSub(p, budget, 0)).toBe(1)
    expect(landingSub(p, budget, 2)).toBe(2)
    expect(landingSub(deny(engineer, 'ws:budget:by-category', 'ws:budget:by-order', 'ws:budget:by-ct'), budget, 0)).toBe(-1)
    const accounts = findWorkspaceTab('accounts')!
    expect(landingSub(engineer, accounts, 3)).toBe(0) // no pills: always 0
  })
  it('the ribbon gets one list per visible tab', () => {
    const p = deny(engineer, 'ws:budget:by-ct')
    expect(allowedSubsByTab(p, [budget, woPo])).toEqual({ '': [0, 1], 'wo-po': [0, 1, 2, 3] })
  })
})

describe('the matrix rows', () => {
  const modules = MODULES.map(m => ({ slug: m.slug, label: m.label }))
  const { sections, legacy } = buildMatrixSections(modules)
  it('has a section per ribbon group, then Setup, then the modules the revamp uses', () => {
    expect(sections.map(s => s.id)).toEqual(['ws-money', 'ws-procurement', 'ws-site', 'ws-documents', 'ws-people', 'ws-setup', 'modules'])
  })
  it('lists every tab with its pills right under it, each pill pointing at its tab', () => {
    const money = sections[0].rows
    expect(money[0]).toMatchObject({ slug: 'ws:budget', kind: 'tab', inherits: 'cost-control' })
    expect(money.slice(1, 4).map(r => r.slug)).toEqual(['ws:budget:by-category', 'ws:budget:by-order', 'ws:budget:by-ct'])
    expect(money.slice(1, 4).every(r => r.parent === 'ws:budget')).toBe(true)
    const all = sections.flatMap(s => s.rows)
    for (const t of [...WORKSPACE_TABS, SETUP_TAB]) expect(all.some(r => r.slug === tabSlug(t))).toBe(true)
    expect(all.filter(r => r.kind === 'tab')).toHaveLength(16)
    expect(all.filter(r => r.kind === 'sub')).toHaveLength(WORKSPACE_TABS.reduce((t, x) => t + x.subs.length, 0))
  })
  it('marks reviewer-only and unbuilt tabs, and says what a tab inherits', () => {
    const all = sections.flatMap(s => s.rows)
    expect(all.find(r => r.slug === 'ws:accounts')).toMatchObject({ reviewerOnly: true })
    expect(all.find(r => r.slug === 'ws:qc')).toMatchObject({ unbuilt: true, inherits: 'cost-control' })
    expect(all.find(r => r.slug === 'ws:procurement')?.hint).toContain('Indent → PO Tracker')
  })
  it('puts the old screens apart and nothing is lost between the two', () => {
    const shown = new Set(sections.find(s => s.id === 'modules')!.rows.map(r => r.slug))
    const old = new Set(legacy.rows.map(r => r.slug))
    for (const m of modules) expect(shown.has(m.slug) || old.has(m.slug)).toBe(true)
    for (const s of shown) expect(old.has(s)).toBe(false)
    for (const s of ['indents', 'pos', 'grns', 'invoices', 'payments', 'vendors', 'inventory', 'uploads', 'blueprint-demo']) expect(old.has(s)).toBe(true)
    for (const s of ['cost-control', 'procurement-tracker', 'admin-permissions']) expect(REVAMP_MODULE_SLUGS.has(s)).toBe(true)
  })
  it('search keeps a pill with its tab and a tab with its pills', () => {
    const rows = sections.flatMap(s => s.rows)
    expect(filterRows(rows, 'boq upload').map(r => r.slug)).toEqual(['ws:wo-po', 'ws:wo-po:boq-upload'])
    // …and the module whose hint names the tab, so the admin sees what gates it.
    expect(filterRows(rows, 'WO / PO').map(r => r.slug)).toEqual(['ws:wo-po', 'ws:wo-po:all-orders', 'ws:wo-po:work-orders', 'ws:wo-po:pos', 'ws:wo-po:boq-upload', 'procurement-tracker'])
    expect(filterRows(rows, '')).toHaveLength(rows.length)
  })
})
