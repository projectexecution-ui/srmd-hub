import { describe, it, expect } from 'vitest'
import { revampFromSetting, REVAMP_ON } from './live'

describe('revampFromSetting — the CT Hub V1 toggle', () => {
  it('shows the revamp on live when the toggle is absent or v2', () => {
    expect(revampFromSetting(null, false)).toBe(REVAMP_ON)
    expect(revampFromSetting(undefined, false)).toBe(REVAMP_ON)
    expect(revampFromSetting('v2', false)).toBe(REVAMP_ON)
  })
  it('puts the previous CT Hub back for everyone when the toggle says v1', () => {
    expect(revampFromSetting('v1', false)).toBe(false)
  })
  it('the trial deployment always shows the revamp, toggle or not', () => {
    expect(revampFromSetting('v1', true)).toBe(true)
    expect(revampFromSetting(null, true)).toBe(true)
  })
})
