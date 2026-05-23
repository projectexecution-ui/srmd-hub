// Indian-format number/currency/date helpers for the JMR module.
//
// We deliberately do NOT use Intl.NumberFormat('en-IN', ...) everywhere
// because it returns full digits (e.g. "1,23,45,678") which is what we
// want — but for the "₹82.57 L" / "₹14.17 Cr" tile format we need our
// own short formatter.

import { format as formatDate, parseISO } from 'date-fns'

export function formatINR(n: number, opts: { decimals?: number } = {}): string {
  const { decimals = 0 } = opts
  if (n == null || isNaN(n)) return '—'
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  const fixed = abs.toFixed(decimals)
  const [intPart, decPart] = fixed.split('.')
  // Indian grouping: last 3 digits, then groups of 2.
  const lastThree = intPart.slice(-3)
  const rest = intPart.slice(0, -3)
  const grouped = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + lastThree : lastThree
  return `${sign}₹${grouped}${decPart ? '.' + decPart : ''}`
}

/** Short form: ₹82.57 L (lakh) / ₹14.17 Cr (crore). */
export function formatINRShort(n: number): string {
  if (n == null || isNaN(n)) return '—'
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2)} Cr`
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2)} L`
  if (abs >= 1e3) return `${sign}₹${(abs / 1e3).toFixed(1)} K`
  return `${sign}₹${abs.toFixed(0)}`
}

/** Plain Indian-grouped number, no currency symbol. */
export function formatNumberIN(n: number, decimals = 0): string {
  if (n == null || isNaN(n)) return '—'
  return formatINR(n, { decimals }).replace('₹', '').trim()
}

/** "21 May 2026" — never US-style. */
export function formatDateIN(d: string | Date | null | undefined): string {
  if (!d) return '—'
  const date = typeof d === 'string' ? parseISO(d) : d
  return formatDate(date, 'd MMM yyyy')
}

/** "21 May 26" — compact. */
export function formatDateShort(d: string | Date | null | undefined): string {
  if (!d) return '—'
  const date = typeof d === 'string' ? parseISO(d) : d
  return formatDate(date, 'd MMM yy')
}

export function todayISO(): string {
  return formatDate(new Date(), 'yyyy-MM-dd')
}
