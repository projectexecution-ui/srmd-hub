// Pure money-string helpers — Indian (lakh/crore) grouping.
// Extracted from components/ui/money-input.tsx so they can be unit-tested
// and reused without pulling in React. No DOM, no side effects.
//
//   12345         → "12,345"
//   150000        → "1,50,000"
//   1500000.50    → "15,00,000.50"

/** Strip a free-typed string down to a raw numeric string (no commas).
 *  Keeps at most one leading minus (when allowed) and one decimal point,
 *  and truncates the fractional part to `decimals` places. */
export function stripToRaw(s: string, allowNegative: boolean, decimals: number): string {
  // Keep digits, optional leading minus, single dot
  let cleaned = s.replace(/[^0-9.\-]/g, '')
  // Single leading minus
  const neg = allowNegative && cleaned.startsWith('-')
  cleaned = cleaned.replace(/-/g, '')
  // Single decimal point
  const firstDot = cleaned.indexOf('.')
  if (firstDot !== -1) {
    cleaned = cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '')
  }
  // Truncate decimals
  if (decimals === 0) {
    cleaned = cleaned.replace(/\..*$/, '')
  } else if (firstDot !== -1) {
    const dot = cleaned.indexOf('.')
    cleaned = cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1, dot + 1 + decimals)
  }
  return (neg ? '-' : '') + cleaned
}

/** Format a raw numeric string with Indian digit grouping. Intermediate
 *  typing states ("", "-", ".", "-.") are returned untouched so the caret
 *  logic in the input behaves while the user is mid-entry. */
export function formatIndian(raw: string): string {
  if (raw === '' || raw === '-' || raw === '.' || raw === '-.') return raw
  const neg = raw.startsWith('-')
  const body = neg ? raw.slice(1) : raw
  const dot = body.indexOf('.')
  const intPart = dot === -1 ? body : body.slice(0, dot)
  const fracPart = dot === -1 ? '' : body.slice(dot)  // includes the "."
  if (intPart === '') return (neg ? '-' : '') + fracPart
  // Indian grouping: last 3 digits, then groups of 2
  const intNum = intPart.replace(/^0+(?=\d)/, '') // strip leading zeros but keep a lone 0
  const head = intNum.length > 3 ? intNum.slice(0, intNum.length - 3) : ''
  const tail = intNum.slice(-3)
  const grouped = (head ? head.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' : '') + tail
  return (neg ? '-' : '') + grouped + fracPart
}

/** Count digit characters to the left of a caret position. Used by the
 *  input to keep the caret stable as commas shift around. */
export function countDigitsLeftOf(value: string, caret: number): number {
  let n = 0
  for (let i = 0; i < Math.min(caret, value.length); i++) {
    if (/[0-9]/.test(value[i])) n++
  }
  return n
}

/** Inverse of countDigitsLeftOf: given a formatted string and a digit
 *  count, return the caret index that puts that many digits to its left. */
export function caretPosForDigitCount(formatted: string, digitCount: number): number {
  let seen = 0
  for (let i = 0; i < formatted.length; i++) {
    if (/[0-9]/.test(formatted[i])) {
      if (seen === digitCount) return i
      seen++
    }
  }
  return formatted.length
}
