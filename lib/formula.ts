import { Parser } from 'expr-eval'

/**
 * Sandboxed formula evaluator for Quantification Templates (Cost Control).
 *
 * Templates declare a set of columns (e.g. `nos`, `L`, `B`) and a formula
 * string (e.g. `nos*L*B`). When an engineer fills a row, we evaluate the
 * formula against the row's values to derive `computed_qty`.
 *
 * Safety constraints:
 *   - Only standard math (`+ - * / ^ ()` and built-in functions).
 *   - Identifiers must appear in the declared `columns` list — otherwise
 *     a typo like `nso*L*B` would silently return NaN/0.
 *   - Null/undefined values default to 1 (per spec §5.8: nulls treated as 1).
 *   - Result is a finite number; otherwise throw.
 */
export interface QtyColumn {
  key: string
  label: string
  type: 'number' | 'text'
  required?: boolean
}

export class FormulaError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message)
    this.name = 'FormulaError'
  }
}

const parser = new Parser({
  operators: {
    add: true,
    subtract: true,
    multiply: true,
    divide: true,
    power: true,
    factorial: false,
    assignment: false,
    comparison: false,
    logical: false,
    conditional: false,
    remainder: true,
    concatenate: false,
    in: false,
  },
})

// Clear built-in functions and constants so column keys can shadow them safely.
;(parser as unknown as { functions: Record<string, unknown> }).functions = {}
;(parser as unknown as { consts: Record<string, unknown> }).consts = {}

export function validateFormula(formula: string, columns: QtyColumn[]): void {
  if (!formula || !formula.trim()) return
  let expr
  try {
    expr = parser.parse(formula)
  } catch (err) {
    throw new FormulaError(`Formula has a syntax error: ${formula}`, err)
  }
  const declared = new Set(columns.map(c => c.key))
  const referenced = expr.variables({ withMembers: false })
  for (const id of referenced) {
    if (!declared.has(id)) {
      throw new FormulaError(
        `Formula references "${id}" which is not a declared column. Available columns: ${[...declared].join(', ') || '(none)'}.`,
      )
    }
  }
}

export function evaluateFormula(
  formula: string,
  columns: QtyColumn[],
  values: Record<string, unknown>,
): number {
  if (!formula || !formula.trim()) {
    const manual = values['manual_qty']
    const n = typeof manual === 'number' ? manual : Number(manual)
    if (Number.isFinite(n)) return n
    return 0
  }

  validateFormula(formula, columns)

  const scope: Record<string, number> = {}
  for (const col of columns) {
    if (col.type !== 'number') continue
    const raw = values[col.key]
    const n =
      raw === null || raw === undefined || raw === ''
        ? 1
        : typeof raw === 'number'
          ? raw
          : Number(raw)
    if (!Number.isFinite(n)) {
      throw new FormulaError(`Column "${col.key}" has non-numeric value: ${JSON.stringify(raw)}`)
    }
    scope[col.key] = n
  }

  let result: number
  try {
    result = parser.parse(formula).evaluate(scope)
  } catch (err) {
    throw new FormulaError(`Failed to evaluate formula "${formula}"`, err)
  }
  if (!Number.isFinite(result)) {
    throw new FormulaError(`Formula "${formula}" produced non-finite result for values ${JSON.stringify(values)}`)
  }
  return result
}
