'use client'
// MoneyInput — number input that formats Indian-style while typing.
//
//   12345         → "12,345"
//   150000        → "1,50,000"
//   1500000.50    → "15,00,000.50"
//
// Value is exchanged with the parent as a string ("" when empty, raw digits
// + optional decimal otherwise) so existing forms that use string state for
// number fields keep working — same shape as <Input type="number" />.
//
// Caret position is preserved as the comma count shifts. We compute the
// number of digit characters to the left of the caret before formatting,
// then place the caret such that the same number of digits sits to its
// left after formatting.

import { forwardRef, useEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'

interface Props extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  value: string | number | null | undefined
  /** Called with the RAW value (e.g. "150000.5" or ""). Never includes commas. */
  onChange: (raw: string) => void
  /** Only relevant for the placeholder — display the placeholder with commas too. */
  placeholder?: string
  /** Allow negative numbers. Default false. */
  allowNegative?: boolean
  /** Decimal places to allow during typing. Default 2. Pass 0 for integers only. */
  decimals?: number
}

function stripToRaw(s: string, allowNegative: boolean, decimals: number): string {
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

function formatIndian(raw: string): string {
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

function countDigitsLeftOf(value: string, caret: number): number {
  let n = 0
  for (let i = 0; i < Math.min(caret, value.length); i++) {
    if (/[0-9]/.test(value[i])) n++
  }
  return n
}

function caretPosForDigitCount(formatted: string, digitCount: number): number {
  let seen = 0
  for (let i = 0; i < formatted.length; i++) {
    if (/[0-9]/.test(formatted[i])) {
      if (seen === digitCount) return i
      seen++
    }
  }
  return formatted.length
}

export const MoneyInput = forwardRef<HTMLInputElement, Props>(function MoneyInput(
  { value, onChange, placeholder, allowNegative = false, decimals = 2, ...rest }, ref,
) {
  // Display string is what the user sees in the input (with commas).
  const initialRaw =
    value == null || value === '' ? '' :
    typeof value === 'number' ? String(value) :
    stripToRaw(String(value), allowNegative, decimals)
  const [display, setDisplay] = useState<string>(formatIndian(initialRaw))
  const innerRef = useRef<HTMLInputElement | null>(null)

  // Keep display in sync if parent value changes externally.
  useEffect(() => {
    const raw =
      value == null || value === '' ? '' :
      typeof value === 'number' ? String(value) :
      stripToRaw(String(value), allowNegative, decimals)
    const next = formatIndian(raw)
    if (next !== display) setDisplay(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.target
    const before = input.value
    const caret = input.selectionStart ?? before.length
    const digitsLeft = countDigitsLeftOf(before, caret)
    const raw = stripToRaw(before, allowNegative, decimals)
    const next = formatIndian(raw)
    setDisplay(next)
    onChange(raw)
    // Restore caret on the next tick after React applies the new value
    requestAnimationFrame(() => {
      if (!innerRef.current) return
      const pos = caretPosForDigitCount(next, digitsLeft)
      try {
        innerRef.current.setSelectionRange(pos, pos)
      } catch { /* some browsers throw for number inputs; we render as text */ }
    })
  }

  return (
    <Input
      {...rest}
      ref={(el) => {
        innerRef.current = el
        if (typeof ref === 'function') ref(el)
        else if (ref) (ref as React.MutableRefObject<HTMLInputElement | null>).current = el
      }}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={display}
      onChange={handleChange}
      placeholder={placeholder ? formatIndian(stripToRaw(placeholder, allowNegative, decimals)) || placeholder : undefined}
    />
  )
})
