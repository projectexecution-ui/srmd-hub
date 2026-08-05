'use client'
// Plain numeric quantity input. Deliberately NOT MoneyInput — that control adds
// ₹ lakh/crore comma grouping and forces 2 decimals, which is wrong for material
// counts ("50 bags", "2.5 ton", "12 nos"). This is a bare number field.

import { Input } from '@/components/ui/input'

export function QtyInput({
  value, onChange, placeholder = 'qty', className, disabled,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
}) {
  return (
    <Input
      type="number"
      inputMode="decimal"
      min={0}
      step="any"
      value={value}
      disabled={disabled}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className={className}
    />
  )
}
