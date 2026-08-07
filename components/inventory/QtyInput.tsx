'use client'
// Numeric quantity input with Indian digit grouping while typing:
//   11111   → "11,111"
//   150000  → "1,50,000"
//   2.5     → "2.5"      (decimals kept as typed — never padded to .00)
//
// Deliberately NOT MoneyInput — no ₹ and no forced 2 decimals, which are wrong
// for material counts ("50 bags", "2.5 ton", "12 nos"). It reuses the shared
// lib/money grouping + caret helpers so the grouping matches everywhere and the
// caret stays put as commas shift. Value is exchanged with the parent as a RAW
// string (no commas), so callers that do Number(value) keep working unchanged.

import { useEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { stripToRaw, formatIndian, countDigitsLeftOf, caretPosForDigitCount } from '@/lib/money'

const DECIMALS = 3 // allow fractional units (e.g. 2.5 ton) but keep it sane

export function QtyInput({
  value, onChange, placeholder = 'qty', className, disabled, id,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  id?: string
}) {
  const [display, setDisplay] = useState<string>(formatIndian(stripToRaw(value ?? '', false, DECIMALS)))
  const innerRef = useRef<HTMLInputElement | null>(null)

  // Keep the shown value in sync when the parent changes it externally
  // (e.g. the store-issue form pre-fills "to hand over" quantities).
  useEffect(() => {
    const next = formatIndian(stripToRaw(value ?? '', false, DECIMALS))
    setDisplay(prev => (prev !== next ? next : prev))
  }, [value])

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const before = e.target.value
    const caret = e.target.selectionStart ?? before.length
    const digitsLeft = countDigitsLeftOf(before, caret)
    const raw = stripToRaw(before, false, DECIMALS)
    const next = formatIndian(raw)
    setDisplay(next)
    onChange(raw)
    requestAnimationFrame(() => {
      if (!innerRef.current) return
      const pos = caretPosForDigitCount(next, digitsLeft)
      try { innerRef.current.setSelectionRange(pos, pos) } catch { /* noop */ }
    })
  }

  return (
    <Input
      id={id}
      ref={innerRef}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={display}
      disabled={disabled}
      onChange={handleChange}
      placeholder={placeholder}
      className={className}
    />
  )
}
