import { describe, it, expect } from 'vitest'
import { approvalKeyboard, confirmReleaseKeyboard, CB_PREFIX } from './cc-approval-send'

const UUID = 'b68b7d2a-5ae1-4c86-bb26-005d9405f172'

describe('approvalKeyboard', () => {
  it('PH/Atm sign-off card → sign verb + open-in-app url', () => {
    for (const stage of ['submitted', 'ph_approved'] as const) {
      const kb = approvalKeyboard(stage, UUID)
      expect(kb.inline_keyboard[0][0].callback_data).toBe(`${CB_PREFIX}:sign:${UUID}`)
      expect(kb.inline_keyboard[1][0].url).toContain(`/cost-control/working-sheets/${UUID}`)
    }
  })

  it('Trustee card → rel verb', () => {
    for (const stage of ['atm_approved', 'partially_approved'] as const) {
      expect(approvalKeyboard(stage, UUID).inline_keyboard[0][0].callback_data).toBe(`${CB_PREFIX}:rel:${UUID}`)
    }
  })

  it('test mode uses non-mutating verbs (tsign/trel)', () => {
    expect(approvalKeyboard('submitted', UUID, true).inline_keyboard[0][0].callback_data).toBe(`${CB_PREFIX}:tsign:${UUID}`)
    expect(approvalKeyboard('atm_approved', UUID, true).inline_keyboard[0][0].callback_data).toBe(`${CB_PREFIX}:trel:${UUID}`)
  })

  it('confirm keyboard has relok + cancel', () => {
    const kb = confirmReleaseKeyboard(UUID)
    const verbs = kb.inline_keyboard[0].map(b => b.callback_data)
    expect(verbs).toContain(`${CB_PREFIX}:relok:${UUID}`)
    expect(verbs).toContain(`${CB_PREFIX}:cancel:${UUID}`)
  })

  it('every callback_data stays within Telegram’s 64-byte limit', () => {
    const all = [
      ...approvalKeyboard('submitted', UUID).inline_keyboard,
      ...approvalKeyboard('atm_approved', UUID).inline_keyboard,
      ...confirmReleaseKeyboard(UUID).inline_keyboard,
    ].flat()
    for (const b of all) {
      if (b.callback_data) expect(Buffer.byteLength(b.callback_data, 'utf8')).toBeLessThanOrEqual(64)
    }
  })
})
