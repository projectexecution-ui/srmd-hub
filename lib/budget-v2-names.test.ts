import { describe, it, expect } from 'vitest'
import { applyDisplayNames, shownName, type ComposeResult, type ProjectNode } from './budget-v2'

const proj = (name: string): ProjectNode =>
  ({ name, group: 'G', status: 'open', area: null, budget: 0, approved: 0, spent: 0, categories: [] })

const tree = (...names: string[]): ComposeResult =>
  ({ groups: [{ name: 'G', budget: 0, approved: 0, spent: 0, area: 0, projects: names.map(proj) }], totals: { budget: 0, approved: 0, spent: 0, area: 0 } })

describe('applyDisplayNames — trustee reports read CT Hub names, keys stay BPH', () => {
  it('stamps the hub name and leaves the BPH name (the key) untouched', () => {
    const t = applyDisplayNames(tree('New Guest House B - Execution'), { 'New Guest House B - Execution': 'NGH B' })
    const p = t.groups[0].projects[0]
    expect(p.name).toBe('New Guest House B - Execution')
    expect(p.displayName).toBe('NGH B')
    expect(shownName(p)).toBe('NGH B')
  })
  it('an unlinked project shows its BPH name and carries no displayName', () => {
    const t = applyDisplayNames(tree('Raj Uphaar'), {})
    expect(t.groups[0].projects[0].displayName).toBeUndefined()
    expect(shownName(t.groups[0].projects[0])).toBe('Raj Uphaar')
  })
  it('does not stamp a name identical to BPH’s, or a blank one', () => {
    const t = applyDisplayNames(tree('SRAH', 'CV4'), { SRAH: 'SRAH', CV4: '   ' })
    expect(t.groups[0].projects.every(p => p.displayName === undefined)).toBe(true)
  })
})
