// ONE ordering rule for cost-control disciplines, shared by every surface that
// lists them (project view, engineer view, Master Excel export) so the screen
// and the spreadsheet can never disagree.
//
// Why this isn't just `display_order`: `cc_disciplines.display_order` is
// NOT NULL DEFAULT 0, and the admin form coerces a blank box to 0
// (DisciplinesAdmin.tsx). So a discipline added without an explicit order gets
// 0 — which sorts it ABOVE "01 Site Pre-lims" instead of after the numbered
// list. On SRAH that put "53 OT'S" and "54 Specialized Flooring" at the very
// top of the table, and because nothing broke the 0-vs-0 tie their relative
// order could flip between page loads.
//
// The rule: an explicit display_order (> 0) is honoured, because that is the
// admin deliberately placing the discipline. Order 0 (or null) means "unset" —
// fall back to the discipline's own code number, which is the sequence people
// read off the master budget (01, 02, 03 … 20, then 53, 54). Codes with no
// leading digits sort last. Every comparison ends on the raw code string, so
// the order is total and stable across requests.

export interface OrderableDiscipline {
  code: string | null
  display_order: number | null
}

/**
 * Leading digits of a discipline code as a number — '03' → 3, '02E' → 2,
 * '001' → 1. Returns Infinity for a code with no leading digit so those
 * disciplines land at the end rather than at the top.
 */
export function disciplineCodeNumber(code: string | null | undefined): number {
  const digits = /^\s*(\d+)/.exec(code ?? '')
  return digits ? Number(digits[1]) : Number.POSITIVE_INFINITY
}

/** The effective sort rank: explicit display_order, else the code number. */
export function disciplineRank(d: OrderableDiscipline): number {
  return d.display_order && d.display_order > 0
    ? d.display_order
    : disciplineCodeNumber(d.code)
}

/** Comparator for Array.prototype.sort — total and deterministic. */
export function compareDisciplines(a: OrderableDiscipline, b: OrderableDiscipline): number {
  return (
    disciplineRank(a) - disciplineRank(b) ||
    disciplineCodeNumber(a.code) - disciplineCodeNumber(b.code) ||
    (a.code ?? '').localeCompare(b.code ?? '')
  )
}

/** Convenience: a new array in display order. Never mutates the input. */
export function sortDisciplines<T extends OrderableDiscipline>(rows: readonly T[]): T[] {
  return [...rows].sort(compareDisciplines)
}
