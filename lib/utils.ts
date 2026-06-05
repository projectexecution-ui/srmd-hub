import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '--'
  return new Date(date).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

export function formatDateTime(date: string | Date | null | undefined): string {
  if (!date) return '--'
  return new Date(date).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  })
}

const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
})

export function formatINR(n: number | string | null | undefined): string {
  const v = typeof n === 'string' ? Number(n) : n
  // !Number.isFinite rejects NaN and ±Infinity (Intl would render "₹∞").
  if (v === null || v === undefined || !Number.isFinite(v as number)) return '—'
  return INR.format(v as number)
}

export function formatNumber(n: number | string | null | undefined, decimals = 2): string {
  const v = typeof n === 'string' ? Number(n) : n
  if (v === null || v === undefined || !Number.isFinite(v as number)) return '—'
  return (v as number).toLocaleString('en-IN', {
    minimumFractionDigits: decimals, maximumFractionDigits: decimals,
  })
}

export function indentStageColor(stage: string): 'default' | 'success' | 'warning' | 'secondary' {
  switch (stage) {
    case 'approved': return 'success'
    case 'verify': return 'warning'
    case 'submitted': return 'default'
    case 'draft':
    default: return 'secondary'
  }
}

export function indentStageLabel(stage: string): string {
  switch (stage) {
    case 'draft': return 'Draft'
    case 'submitted': return 'Submitted'
    case 'verify': return 'In Verification'
    case 'approved': return 'Approved'
    default: return stage
  }
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}
