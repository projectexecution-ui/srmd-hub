// Short money and date forms shared by the Command Centre cards. Moved here from
// the JMR module when JMR was removed (10 Sep 2026 clean-up).
import { format as formatDate, parseISO, isValid } from 'date-fns'

/** Short form: ₹82.57 L (lakh) / ₹14.17 Cr (crore). */
export function formatINRShort(n: number): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2)} Cr`
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2)} L`
  if (abs >= 1e3) return `${sign}₹${(abs / 1e3).toFixed(1)} K`
  return `${sign}₹${abs.toFixed(0)}`
}


/** "21 May 26" — compact. Same invalid-date guard as formatDateIN. */
export function formatDateShort(d: string | Date | null | undefined): string {
  if (!d) return '—'
  const date = typeof d === 'string' ? parseISO(d) : d
  if (!isValid(date)) return '—'
  return formatDate(date, 'd MMM yy')
}

