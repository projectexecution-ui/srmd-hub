import { describe, it, expect } from 'vitest'
import {
  PENDING_STATUSES, isPendingStatus, awaitingLabel, nextSignOffStage,
  canReleaseFrom, canReturnFrom, canSubmitFrom, stageIndexFor,
  plainStatusLabel, isManagementRole, CHAIN_STEPS, type ChainStatus,
} from './chain'

// ============================================================================
// SCENARIO MATRIX for the 3-stage chain:
//   draft → submitted →(PH)→ ph_approved →(Atm)→ atm_approved →(Trustee)→
//   (partially_approved)* → approved → wo_issued → paid; returned from any
//   pending stage. Grouped: valid / invalid / edge.
// ============================================================================

const ALL_STATUSES: ChainStatus[] = [
  'draft', 'draft_blocked', 'submitted', 'ph_approved', 'atm_approved',
  'partially_approved', 'approved', 'returned', 'wo_issued', 'paid', 'cancelled',
]

describe('nextSignOffStage — sequential, no skips', () => {
  describe('valid', () => {
    it('submitted advances to ph_approved (Project Head)', () => {
      expect(nextSignOffStage('submitted')).toBe('ph_approved')
    })
    it('ph_approved advances to atm_approved (Atm Head)', () => {
      expect(nextSignOffStage('ph_approved')).toBe('atm_approved')
    })
  })
  describe('invalid — no sign-off possible anywhere else', () => {
    for (const s of ALL_STATUSES.filter(s => s !== 'submitted' && s !== 'ph_approved')) {
      it(`${s} has no sign-off`, () => expect(nextSignOffStage(s)).toBeNull())
    }
    it('unknown status degrades to null', () => expect(nextSignOffStage('bogus')).toBeNull())
  })
})

describe('canReleaseFrom — Trustee stage only', () => {
  it('allows atm_approved and partially_approved', () => {
    expect(canReleaseFrom('atm_approved')).toBe(true)
    expect(canReleaseFrom('partially_approved')).toBe(true)
  })
  it('refuses everywhere else (no skipping the chain)', () => {
    for (const s of ALL_STATUSES.filter(s => s !== 'atm_approved' && s !== 'partially_approved')) {
      expect(canReleaseFrom(s)).toBe(false)
    }
  })
})

describe('canReturnFrom / canSubmitFrom', () => {
  it('return possible from every pending stage, nowhere else', () => {
    for (const s of PENDING_STATUSES) expect(canReturnFrom(s)).toBe(true)
    for (const s of ['draft', 'returned', 'approved', 'wo_issued', 'paid', 'cancelled']) {
      expect(canReturnFrom(s)).toBe(false)
    }
  })
  it('submit only from draft or returned (resubmit restarts at stage 1)', () => {
    expect(canSubmitFrom('draft')).toBe(true)
    expect(canSubmitFrom('returned')).toBe(true)
    for (const s of ['submitted', 'ph_approved', 'atm_approved', 'partially_approved', 'approved', 'cancelled']) {
      expect(canSubmitFrom(s)).toBe(false)
    }
  })
})

describe('awaitingLabel — inbox grouping', () => {
  it('routes each pending stage to the right approver', () => {
    expect(awaitingLabel('submitted')).toBe('Project Head')
    expect(awaitingLabel('ph_approved')).toBe('Atm Head')
    expect(awaitingLabel('atm_approved')).toBe('Trustee')
    expect(awaitingLabel('partially_approved')).toBe('Trustee')
  })
  it('non-pending statuses have no awaiting label', () => {
    for (const s of ['draft', 'approved', 'returned', 'paid', 'cancelled']) {
      expect(awaitingLabel(s)).toBeNull()
    }
  })
})

describe('stageIndexFor — stepper progress', () => {
  it('is monotonic along the happy path', () => {
    const path = ['draft', 'submitted', 'ph_approved', 'atm_approved', 'approved'] as const
    const idx = path.map(stageIndexFor)
    for (let i = 1; i < idx.length; i++) expect(idx[i]).toBeGreaterThan(idx[i - 1])
  })
  it('returned resets to 0 (chain restarts on resubmit)', () => {
    expect(stageIndexFor('returned')).toBe(0)
  })
  it('partially_approved sits at the Trustee step (3), full approval completes all steps', () => {
    expect(stageIndexFor('partially_approved')).toBe(3)
    expect(stageIndexFor('approved')).toBe(CHAIN_STEPS.length)
    expect(stageIndexFor('wo_issued')).toBe(CHAIN_STEPS.length)
    expect(stageIndexFor('paid')).toBe(CHAIN_STEPS.length)
  })
  it('cancelled is out of the chain; unknown degrades to 0', () => {
    expect(stageIndexFor('cancelled')).toBe(-1)
    expect(stageIndexFor('whatever')).toBe(0)
  })
})

describe('plainStatusLabel — layman wording', () => {
  it('has a plain-word label for every status (no raw enums leak)', () => {
    for (const s of ALL_STATUSES) {
      const label = plainStatusLabel(s)
      expect(label.length).toBeGreaterThan(3)
      expect(label).not.toContain('_')
    }
  })
  it('unknown statuses still render readable text', () => {
    expect(plainStatusLabel('some_new_status')).toBe('some new status')
  })
})

describe('isManagementRole — config-driven predicate', () => {
  const rules = [
    { approver_role: 'project_head', override_role: null },
    { approver_role: 'head', override_role: null },
    { approver_role: 'founder', override_role: 'admin' },
  ]
  it('admin always passes, even with zero rules', () => {
    expect(isManagementRole('admin', [])).toBe(true)
  })
  it('roles on active rules pass (approver or override)', () => {
    expect(isManagementRole('project_head', rules)).toBe(true)
    expect(isManagementRole('head', rules)).toBe(true)
    expect(isManagementRole('founder', rules)).toBe(true)
  })
  it('engineers / viewers / null never pass', () => {
    expect(isManagementRole('engineer', rules)).toBe(false)
    expect(isManagementRole('viewer', rules)).toBe(false)
    expect(isManagementRole(null, rules)).toBe(false)
    expect(isManagementRole(undefined, rules)).toBe(false)
  })
  it('is data-driven — removing a role from the rules removes access', () => {
    const trimmed = rules.filter(r => r.approver_role !== 'head')
    expect(isManagementRole('head', trimmed)).toBe(false)
  })
})

describe('isPendingStatus', () => {
  it('exactly the four pending stages', () => {
    for (const s of PENDING_STATUSES) expect(isPendingStatus(s)).toBe(true)
    for (const s of ['draft', 'approved', 'returned', 'paid', 'cancelled', '']) {
      expect(isPendingStatus(s)).toBe(false)
    }
  })
})
