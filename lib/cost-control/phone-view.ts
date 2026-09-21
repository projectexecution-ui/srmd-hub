// The Internal Estimate page on a phone — the decisions that are pure.
//
// Aksha, 21 Sep 2026, on the phone layout: "its showing less info and
// confusing us". His picks from the preview (M1–M4, M8–M13) come down to a
// few rules, and the ones that are not markup live here so a test can hold
// them:
//
//   • ONE NAME PER NUMBER. The ERP budget was "Approved Budget (ERP)" in the
//     tile, "ERP" on the category bar and "ERP Budget" on the card — three
//     names reading as three numbers. FIGURE_NAMES is used by the desktop
//     header, the summary card, the category bar and the card alike.
//   • EVERY CARD HAS THE SAME LINES. A line whose value is zero used to be
//     dropped, so no two cards had the same shape. phoneLines always returns
//     the same lines in the same order; a nil value prints as "—".
//   • NO COLOUR BARS ON THE PHONE (his NO to M5). Figures are text.
//   • JUMP CHIPS filter the stack (M11) by the same three facts the alerts
//     strip already counts: something awaiting, over budget, closed.
//   • CARDS / TABLE is a per-phone choice (M13), remembered in localStorage.

/** The column headers of the desktop table, and therefore the only names the
 *  phone may use for the same figures. */
export const FIGURE_NAMES = {
  estimate: 'Internal Estimate',
  awaiting: 'Awaiting approval',
  ctHub: 'Budget (CT Hub)',
  erp: 'Budget (ERP)',
  wo: 'WO / PO',
  paid: 'Paid',
  used: '% used',
} as const

export type FigureKey = keyof typeof FIGURE_NAMES

/** Below this width the table gives way to cards (M12: was 1,280 — an iPad in
 *  landscape and a laptop at 125 % zoom were getting the phone layout). Kept
 *  as a number for the comment's sake; Tailwind's `lg:` is the real switch. */
export const TABLE_FROM_PX = 1024

// ── Cards / Table ────────────────────────────────────────────────────────

export type ViewMode = 'cards' | 'table'
export const VIEW_MODE_KEY = 'cc-ie-phone-view'

/** Whatever came out of storage, made safe. Anything unrecognised is cards. */
export function parseViewMode(raw: unknown): ViewMode {
  return raw === 'table' ? 'table' : 'cards'
}

// ── Jump chips ───────────────────────────────────────────────────────────

export type JumpFilter = 'all' | 'awaiting' | 'over' | 'closed'

export interface CardFlags {
  /** Something on this line is waiting for approval. */
  awaiting: boolean
  /** Paid or committed is past the ERP budget. */
  over: boolean
  /** The line is marked Closed. */
  closed: boolean
}

export function cardMatches(filter: JumpFilter, flags: CardFlags): boolean {
  switch (filter) {
    case 'all': return true
    case 'awaiting': return flags.awaiting
    case 'over': return flags.over
    case 'closed': return flags.closed
  }
}

/** A category matches when any of its cards does. */
export function anyFlags(cards: readonly CardFlags[]): CardFlags {
  return {
    awaiting: cards.some(c => c.awaiting),
    over: cards.some(c => c.over),
    closed: cards.some(c => c.closed),
  }
}

export interface JumpCounts { all: number; awaiting: number; over: number; closed: number }

export interface JumpChip { key: JumpFilter; label: string; count: number }

/** "All" always; the other three only when there is something behind them —
 *  a chip that filters down to nothing is a dead end, not a shortcut. */
export function jumpChips(c: JumpCounts): JumpChip[] {
  const out: JumpChip[] = [{ key: 'all', label: 'All', count: c.all }]
  if (c.awaiting > 0) out.push({ key: 'awaiting', label: 'Awaiting', count: c.awaiting })
  if (c.over > 0) out.push({ key: 'over', label: 'Over budget', count: c.over })
  if (c.closed > 0) out.push({ key: 'closed', label: 'Closed', count: c.closed })
  return out
}

export function countFlags(cards: readonly CardFlags[]): JumpCounts {
  return {
    all: cards.length,
    awaiting: cards.filter(c => c.awaiting).length,
    over: cards.filter(c => c.over).length,
    closed: cards.filter(c => c.closed).length,
  }
}

// ── The lines on a card ──────────────────────────────────────────────────

export interface MoneyLine {
  key: FigureKey
  label: string
  /** null prints as "—". Never omit the line. */
  amount: number | null
  /** Small text beside the amount — "23 % used" on Paid. */
  note?: string
}

export interface LineInput {
  estimate: number
  awaiting: number
  ctHub: number
  erp: number
  wo: number
  paid: number
  /** The ERP columns follow the Cost Control setting, as they do on the desktop. */
  showErp: boolean
}

const nil = (n: number): number | null => (n > 0 ? n : null)

/** Same lines, same order, on every card. Three without ERP, six with. */
export function phoneLines(i: LineInput): MoneyLine[] {
  const lines: MoneyLine[] = [
    { key: 'estimate', label: FIGURE_NAMES.estimate, amount: nil(i.estimate) },
    { key: 'awaiting', label: FIGURE_NAMES.awaiting, amount: nil(i.awaiting) },
    { key: 'ctHub', label: FIGURE_NAMES.ctHub, amount: nil(i.ctHub) },
  ]
  if (i.showErp) {
    lines.push(
      { key: 'erp', label: FIGURE_NAMES.erp, amount: nil(i.erp) },
      { key: 'wo', label: FIGURE_NAMES.wo, amount: nil(i.wo) },
      { key: 'paid', label: FIGURE_NAMES.paid, amount: nil(i.paid), note: usedNote(i.paid, i.erp) },
    )
  }
  return lines
}

/** "23 % used" — Paid ÷ Budget (ERP), the desktop column's own formula.
 *  Nothing when there is no ERP budget to divide by. */
export function usedNote(paid: number, erp: number): string | undefined {
  if (erp <= 0) return undefined
  return `${Math.round((paid / erp) * 100)} % used`
}
