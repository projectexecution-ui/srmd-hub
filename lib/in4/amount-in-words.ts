// An amount in words, the Indian way — "Rupees Six Lakh Ninety-Two Thousand
// One Hundred Sixty-One Only". IN4's purchase-order template carries a
// [Total_PO_Amount_InWords_POCurrency] tag and IN4 holds no words column
// for it, so this is the one figure on the printed PO that is arithmetic
// rather than a copy. Paise are written only when there are any.

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

/** 0–999 in words; '' for 0. */
function below1000(n: number): string {
  const parts: string[] = []
  const h = Math.floor(n / 100)
  const r = n % 100
  if (h) parts.push(`${ONES[h]} Hundred`)
  if (r < 20) { if (r) parts.push(ONES[r]) }
  else parts.push(TENS[Math.floor(r / 10)] + (r % 10 ? `-${ONES[r % 10]}` : ''))
  return parts.join(' ')
}

/** A whole number in the Indian grouping: crore, lakh, thousand, hundreds. */
export function integerInWords(n: number): string {
  if (!Number.isFinite(n) || n < 0) return ''
  n = Math.floor(n)
  if (n === 0) return 'Zero'
  const parts: string[] = []
  const crore = Math.floor(n / 1e7); n %= 1e7
  const lakh = Math.floor(n / 1e5); n %= 1e5
  const thousand = Math.floor(n / 1e3); n %= 1e3
  if (crore) parts.push(`${integerInWords(crore)} Crore`)
  if (lakh) parts.push(`${below1000(lakh)} Lakh`)
  if (thousand) parts.push(`${below1000(thousand)} Thousand`)
  if (n) parts.push(below1000(n))
  return parts.join(' ')
}

/** "Rupees … Only", with "and … Paise" when the amount has paise. Null for
 *  anything that is not a finite non-negative number, so the template tag
 *  goes blank and is reported rather than printing "Rupees NaN". */
export function amountInWords(amount: unknown): string | null {
  const v = amount == null ? NaN : Number(amount)
  if (!Number.isFinite(v) || v < 0) return null
  const rupees = Math.floor(v)
  const paise = Math.round((v - rupees) * 100)
  if (paise === 100) return amountInWords(rupees + 1)
  const words = integerInWords(rupees)
  return paise > 0
    ? `Rupees ${words} and ${integerInWords(paise)} Paise Only`
    : `Rupees ${words} Only`
}
