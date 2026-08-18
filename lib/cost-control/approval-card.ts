// The Cost Control budget-approval card, as a CardSpec, for delivery to the
// approver's Telegram (rendered to a PNG by lib/telegram/report-card). It mirrors
// the on-screen "My Approvals" full-picture card — the numbers the approver needs
// to actually CHECK before acting: the ask, ₹/sft, the ERP Budget·WO·Paid
// position, the vs-last-revision delta, approved-so-far → after this, and who
// raised it. Pure + testable: the caller assembles ApprovalCardInput from the
// same queries the approvals page uses. Confidentiality (Internal-Estimate [IB]
// sheets, per-sft / ERP visibility) is enforced by the CALLER before building
// this — the card just renders what it's given.

import type { CardSpec, CardSection, CardRow } from '@/lib/telegram/card-spec'

export type ApprovalStage = 'submitted' | 'ph_approved' | 'atm_approved' | 'partially_approved'

export interface ApprovalCardInput {
  wsCode: string
  project: { code: string; name: string }
  /** sub-skill (preferred) or discipline label */
  work: string
  stage: ApprovalStage
  /** total_amount — the ask, incl GST + contingency (what actually gets approved). */
  amount: number
  area: number | null
  raisedBy: string | null
  daysWaiting: number
  overdue: boolean
  /** ERP strip — pass null (or showErp=false) to hide it (engineer/confidential). */
  erp: { budget: number; wo: number; paid: number } | null
  /** ERP columns on but no BPH-synced budget line → a brand-new ERP budget. */
  erpNew: boolean
  /** vs-last-revision: Rev N + Δ% on total vs the previous version (null for v1). */
  revision: { n: number; deltaPct: number | null } | null
  /** running approved in this sub-skill BEFORE this sheet, and after it. */
  approvedSoFar: number | null
  afterThis: number | null
  showPerSft: boolean
  showErp: boolean
  /** who signs now + the two-tap/label used on the card + button. */
  nextActionLabel: string   // e.g. "Project Head sign-off" / "Atm Head sign-off" / "Trustee release"
}

// Full Indian ₹ (matches the on-screen approval card). Kept local so this pure
// module has no server deps; mirrors lib/utils formatINR grouping.
function inr(v: number): string {
  const n = Math.round(Number(v) || 0)
  return '₹' + n.toLocaleString('en-IN')
}
function perSft(amt: number, area: number | null): string {
  if (!area || area <= 0 || !amt) return ''
  return `₹${Math.round(amt / area).toLocaleString('en-IN')}/sft`
}
function pct(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null
}

const STAGE_ORDER: ApprovalStage[] = ['submitted', 'ph_approved', 'atm_approved']
/** PH → Atm → Trustee chain string with the stage acting NOW marked. */
function stageChain(stage: ApprovalStage): string {
  // Which link is pending: submitted→PH, ph_approved→Atm, atm/partial→Trustee.
  const activeIdx = stage === 'submitted' ? 0 : stage === 'ph_approved' ? 1 : 2
  const labels = ['Project Head', 'Atm Head', 'Trustee']
  // "signed" (not a ✓ glyph — the bundled Noto Sans base has no checkmark, so it
  // would render as a tofu box in the PNG card).
  return labels.map((l, i) => (i === activeIdx ? `» ${l} «` : i < activeIdx ? `${l} signed` : l)).join('  ·  ')
}

export function buildApprovalCardSpec(i: ApprovalCardInput): CardSpec {
  const sameCode = i.project.code && i.project.name && i.project.code.toLowerCase() === i.project.name.toLowerCase()
  const projLabel = sameCode ? i.project.code : `${i.project.code} · ${i.project.name}`

  // ── Stats: the ask + the position ──
  const stats: NonNullable<CardSpec['stats']> = [
    {
      label: 'Amount to approve',
      value: inr(i.amount),
      sub: `${i.showPerSft && perSft(i.amount, i.area) ? perSft(i.amount, i.area) + ' · ' : ''}waiting ${i.daysWaiting}d`,
      tone: i.overdue ? 'danger' : 'brand',
    },
  ]
  if (i.showErp && i.erp) {
    const usedPct = pct(i.erp.paid, i.erp.budget)
    stats.push({
      label: i.erpNew ? 'ERP budget (new)' : 'Budget (ERP)',
      value: inr(i.erp.budget),
      sub: `WO ${inr(i.erp.wo)} · Paid ${inr(i.erp.paid)}${usedPct != null ? ` (${usedPct}%)` : ''}`,
      tone: usedPct != null && usedPct >= 100 ? 'danger' : usedPct != null && usedPct >= 85 ? 'warn' : 'ok',
    })
  } else if (i.revision) {
    stats.push({
      label: `Revision ${i.revision.n}`,
      value: i.revision.deltaPct == null ? '—' : `${i.revision.deltaPct > 0 ? '+' : ''}${i.revision.deltaPct}%`,
      sub: 'vs last approved version',
      tone: i.revision.deltaPct != null && i.revision.deltaPct > 0 ? 'warn' : 'ok',
    })
  }

  // ── Sections ──
  const sections: CardSection[] = []

  const thisRows: CardRow[] = [
    { main: 'This ask', sub: i.work, right: inr(i.amount), rightTone: 'brand' },
  ]
  if (i.revision) {
    thisRows.push({
      main: `Revision ${i.revision.n}`,
      sub: 'change vs the last approved version',
      right: i.revision.deltaPct == null ? '—' : `${i.revision.deltaPct > 0 ? '+' : ''}${i.revision.deltaPct}%`,
      rightTone: i.revision.deltaPct != null && i.revision.deltaPct > 0 ? 'warn' : 'neutral',
    })
  }
  if (i.approvedSoFar != null && i.afterThis != null) {
    thisRows.push({
      main: 'Approved in this sub-skill',
      sub: `so far ${inr(i.approvedSoFar)} → after this ${inr(i.afterThis)}`,
      right: inr(i.afterThis),
      rightTone: 'neutral',
    })
  }
  sections.push({ heading: 'The budget', sub: projLabel, rows: thisRows })

  if (i.showErp && i.erp) {
    sections.push({
      heading: 'ERP position',
      rows: [
        { main: 'Budget', sub: i.erpNew ? 'brand-new ERP budget' : 'from BPH', right: inr(i.erp.budget) },
        { main: 'WO / PO', right: inr(i.erp.wo), rightTone: 'brand' },
        { main: 'Paid', sub: pct(i.erp.paid, i.erp.budget) != null ? `${pct(i.erp.paid, i.erp.budget)}% of budget` : undefined, right: inr(i.erp.paid), rightTone: 'ok' },
      ],
    })
  }

  sections.push({
    heading: 'Approval',
    sub: stageChain(i.stage),
    rows: [{ main: `Waiting on: ${i.nextActionLabel}`, sub: i.raisedBy ? `raised by ${i.raisedBy}` : undefined }],
    banner: { text: 'Approve below (through the same checks as the app), or open in CT Hub to review the working / return it.', tone: 'neutral' },
  })

  return {
    brand: 'Budget approval',
    title: `${i.wsCode} — approve budget`,
    subtitle: `${projLabel} · ${i.work} · Confidential`,
    stats,
    sections,
    footer: 'CT HUB · Cost Control · Confidential — approver only',
  }
}
