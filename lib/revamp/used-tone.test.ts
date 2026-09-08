import { describe, it, expect } from 'vitest'
import { usedTone, USED_LEGEND } from './used-tone'

describe('usedTone — the one colour rule for % used', () => {
  it('bands exactly as the tabs did before they shared it', () => {
    expect(usedTone(120)).toBe('text-rose-700')
    expect(usedTone(100.1)).toBe('text-rose-700')
    expect(usedTone(100)).toBe('text-red-600')
    expect(usedTone(96)).toBe('text-red-600')
    expect(usedTone(95)).toBe('text-amber-700')
    expect(usedTone(81)).toBe('text-amber-700')
    expect(usedTone(80)).toBe('text-emerald-700')
    expect(usedTone(0)).toBe('text-emerald-700')
  })
  it('no figure is quiet grey, never a colour that claims something', () => {
    expect(usedTone(null)).toBe('text-gray-400')
    expect(usedTone(undefined)).toBe('text-gray-400')
    expect(usedTone(NaN)).toBe('text-gray-400')
  })
  it('the legend has one dot per band, in the same order', () => {
    expect(USED_LEGEND.map(l => l.label)).toEqual(['over budget', '95–100 %', '80–95 %', 'under 80 %'])
    expect(USED_LEGEND[0].dot).toBe('bg-rose-700')
  })
})
