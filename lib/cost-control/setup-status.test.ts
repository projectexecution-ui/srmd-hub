import { describe, it, expect } from 'vitest'
import { setupGaps, isFinished, gapsSentence, type SetupFacts } from './setup-status'

const done: SetupFacts = { kind: 'project', atmHeads: 1, areaSft: 56000, in4Linked: true, in4Available: true, disciplines: 20, subSkills: 90 }

describe('setupGaps', () => {
  it('NGH A, as it stands, is finished', () => {
    expect(setupGaps(done)).toEqual([])
    expect(isFinished(done)).toBe(true)
    expect(gapsSentence([])).toBe('Finished')
  })
  it('an RU sub-project brought in from IN4: no head, no area — two gaps, people and basics', () => {
    const gaps = setupGaps({ ...done, atmHeads: 0, areaSft: 0 })
    expect(gaps.map(g => g.key)).toEqual(['area', 'head'])
    expect(gapsSentence(gaps)).toBe('Not finished — no area, no atm head')
  })
  it('the IN4 link only counts when the BPH sync is on', () => {
    expect(setupGaps({ ...done, in4Linked: false, in4Available: false })).toEqual([])
    expect(setupGaps({ ...done, in4Linked: false, in4Available: true }).map(g => g.key)).toEqual(['in4'])
  })
  it('categories before sub-skills — an empty project says categories, not both', () => {
    expect(setupGaps({ ...done, disciplines: 0, subSkills: 0 }).map(g => g.key)).toEqual(['categories'])
    expect(setupGaps({ ...done, disciplines: 3, subSkills: 0 }).map(g => g.key)).toEqual(['subskills'])
  })
  it('a group is never unfinished — it has no people or categories of its own', () => {
    expect(setupGaps({ kind: 'group', atmHeads: 0, areaSft: null, in4Linked: false, in4Available: true, disciplines: 0, subSkills: 0 })).toEqual([])
  })
  it('every gap names its block, so the strip can jump to it', () => {
    for (const g of setupGaps({ kind: 'subproject', atmHeads: 0, areaSft: null, in4Linked: false, in4Available: true, disciplines: 0, subSkills: 0 })) {
      expect(['basics', 'people', 'categories']).toContain(g.block)
      expect(g.why.length).toBeGreaterThan(10)
    }
  })
})
