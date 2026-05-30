'use client'
import type { IndentStatus, LineStatus } from '@/lib/procurement-tracker'

const INDENT_CONFIG: Record<IndentStatus, { label: string; className: string }> = {
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

const LINE_CONFIG: Record<LineStatus, { label: string; className: string }> = {
  received: { label: 'Received',      className: 'bg-emerald-50 text-emerald-700 border border-emerald-200' },
  partial:  { label: 'Partial GRN',   className: 'bg-amber-50 text-amber-700 border border-amber-200' },
  pending:  { label: 'PO – No GRN',   className: 'bg-orange-50 text-orange-700 border border-orange-200' },
  no_po:    { label: 'No PO',         className: 'bg-red-50 text-red-700 border border-red-200' },
}

export function StatusBadge({ status }: { status: IndentStatus }) {
  const c = INDENT_CONFIG[status]
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${c.className}`}>
      {c.label}
    </span>
  )
}

export function LineStatusBadge({ status }: { status: LineStatus }) {
  const c = LINE_CONFIG[status]
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${c.className}`}>
      {c.label}
    </span>
  )
}
