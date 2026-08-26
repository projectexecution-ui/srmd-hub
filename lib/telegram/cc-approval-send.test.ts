import { describe, it, expect } from 'vitest'
import { approvalKeyboard, confirmReleaseKeyboard, waitingKeyboard, CB_PREFIX } from './cc-approval-send'

const UUID = 'b68b7d2a-5ae1-4c86-bb26-005d9405f172'
const PROJ = '768e48c0-6a01-4c95-b406-1ccc8c82a93b'
const DISC = '22ec0071-9eb9-46fb-89a5-0c0555fa1940'
const SUB  = '18d9ebc7-d65f-4cb9-9510-73e96c94b647'

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

  it('adds a full-project button beside the sheet button when the project is known', () => {
    const kb = approvalKeyboard('submitted', UUID, false, {
      projectId: PROJ, disciplineId: DISC, subSkillId: SUB,
    })
    const row = kb.inline_keyboard[1]
    // The sheet button MUST stay first — it is the only way to return or
    // part-approve, which Telegram can't do.
    expect(row[0].url).toContain(`/cost-control/working-sheets/${UUID}`)
    expect(row[1].url).toContain(`/cost-control/projects/${PROJ}?focus_disc=${DISC}&focus_sub=${SUB}&ws=${UUID}`)
  })

  it('omits the project button when there is no project', () => {
    expect(approvalKeyboard('submitted', UUID).inline_keyboard[1]).toHaveLength(1)
    expect(approvalKeyboard('atm_approved', UUID).inline_keyboard[1]).toHaveLength(1)
  })

  it('confirm keyboard has relok + cancel', () => {
    const kb = confirmReleaseKeyboard(UUID)
    const verbs = kb.inline_keyboard[0].map(b => b.callback_data)
    expect(verbs).toContain(`${CB_PREFIX}:relok:${UUID}`)
    expect(verbs).toContain(`${CB_PREFIX}:cancel:${UUID}`)
  })

  it('waiting keyboard uses wait + scancel verbs', () => {
    const verbs = waitingKeyboard(UUID).inline_keyboard.flat().map(b => b.callback_data).filter(Boolean)
    expect(verbs).toContain(`${CB_PREFIX}:wait:${UUID}`)
    expect(verbs).toContain(`${CB_PREFIX}:scancel:${UUID}`)
  })

  it('every callback_data stays within Telegram’s 64-byte limit', () => {
    const all = [
      ...approvalKeyboard('submitted', UUID).inline_keyboard,
      ...approvalKeyboard('atm_approved', UUID).inline_keyboard,
      ...confirmReleaseKeyboard(UUID).inline_keyboard,
      ...waitingKeyboard(UUID).inline_keyboard,
    ].flat()
    for (const b of all) {
      if (b.callback_data) expect(Buffer.byteLength(b.callback_data, 'utf8')).toBeLessThanOrEqual(64)
    }
  })
})
