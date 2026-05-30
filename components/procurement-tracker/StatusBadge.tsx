'use client'
import type { IndentStatus } from '@/lib/procurement-tracker'

const config: Record<IndentStatus, { label: string; className: string }> = {
  'PO Done & GRN Received': {
    label: 'GRN Done',
    className: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  },
  'PO Raised – GRN Pending': {
    label: 'GRN Pending',
    className: 'bg-amber-50 text-amber-700 border border-amber-200',
  },
  'Indent Only – No PO': {
    label: 'No PO Yet',
    className: 'bg-red-50 text-red-700 border border-red-200',
  },
}

export function StatusBadge({ status }: { status: IndentStatus }) {
  const c = config[status]
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${c.className}`}>
      {c.label}
    </span>
  )
}
