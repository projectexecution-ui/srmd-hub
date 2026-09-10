import { describe, it, expect } from 'vitest'
import { skillLabel, projectChip, groupBand } from './names'

describe('skillLabel — IN4 category names carry their code', () => {
  it('drops the leading numeric code and keeps the words', () => {
    expect(skillLabel('03 Civil')).toBe('Civil')
    expect(skillLabel('09 Fire Fighting Works')).toBe('Fire Fighting Works')
    expect(skillLabel('602 Sanitary Fittings')).toBe('Sanitary Fittings')
    expect(skillLabel('03 Civil (old)')).toBe('Civil (old)')
  })
  it('leaves a name with no code alone, and collapses stray whitespace', () => {
    expect(skillLabel('Finishes')).toBe('Finishes')
    expect(skillLabel('  Purchase   orders ')).toBe('Purchase orders')
  })
  it('never returns empty for a name that is only a code', () => {
    expect(skillLabel('12')).toBe('12')
    expect(skillLabel(null)).toBe('')
  })
})

describe('projectChip — short name over code, never anything else', () => {
  it('prefers a set short name', () => {
    expect(projectChip('NGH Common', 'NGHCE')).toBe('NGH Common')
  })
  it('falls back to the code when the short name is empty or blank', () => {
    expect(projectChip(null, 'NGHCE')).toBe('NGHCE')
    expect(projectChip('   ', 'NGHCE')).toBe('NGHCE')
  })
})

describe('groupBand — the chain the dashboard band already used, plus short_name', () => {
  it('group_label wins, then short_name, then code, then name', () => {
    expect(groupBand({ group_label: 'New Guest House', short_name: 'NGH', code: 'NGHG', name: 'NGH' })).toBe('New Guest House')
    expect(groupBand({ group_label: null, short_name: 'NGH', code: 'NGHG', name: 'x' })).toBe('NGH')
    expect(groupBand({ group_label: '  ', short_name: null, code: 'NGHG', name: 'x' })).toBe('NGHG')
    expect(groupBand({ code: '', name: 'Only a name' })).toBe('Only a name')
  })
})
