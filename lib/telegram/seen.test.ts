import { describe, it, expect } from 'vitest'
import { withoutSeen } from './seen'

describe('withoutSeen', () => {
  it('drops the Seen button and any row it emptied, keeps the rest', () => {
    expect(withoutSeen([
      [{ text: '✓ Seen', callback_data: 'seen:abc' }, { text: 'Open', url: 'https://x' }],
      [{ text: '✓ Seen', callback_data: 'seen:abc' }],
      [{ text: 'Rates', url: 'https://y' }],
    ])).toEqual([[{ text: 'Open', url: 'https://x' }], [{ text: 'Rates', url: 'https://y' }]])
  })
  it('handles a message with no keyboard', () => {
    expect(withoutSeen(undefined)).toEqual([])
  })
})
