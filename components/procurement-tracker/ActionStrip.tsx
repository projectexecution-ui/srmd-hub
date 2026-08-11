'use client'
import type { ProjectSummary, IndentStatus } from '@/lib/procurement'
import { shortIndent } from '@/lib/procurement/shared'
import { AlertTriangle, PackageX, UserX, FileText } from 'lucide-react'

function fmtINR(n: number) {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`
  if (n >= 1e3) return `₹${(n / 1e3).toFixed(1)} K`
  return `₹${n.toLocaleString('en-IN')}`
}

interface Props {
  summary: ProjectSummary
  onJumpToIndent?: (filter: IndentStatus | 'all') => void
  onJumpToPending?: () => void
}

export function ActionStrip({ summary, onJumpToIndent, onJumpToPending }: Props) {
  const oldest = summary.oldestPendingPo
  const biggest = summary.biggestPendingLine
  const worst = summary.worstVendor
  const biggestInvoice = summary.biggestPendingInvoice

  if (!oldest && !biggest && !worst && !biggestInvoice) return null

  const cardCount = [oldest, biggest, worst, biggestInvoice].filter(Boolean).length
  const cols = cardCount === 4 ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-3'

  const Card = ({ accent, children, onClick }: {
    accent: 'red' | 'amber' | 'rose' | 'indigo'
    children: React.ReactNode
    onClick?: () => void
  }) => {
    const border = {
      red:    'border-l-red-500',
      amber:  'border-l-amber-500',
      rose:   'border-l-rose-500',
      indigo: 'border-l-indigo-500',
    }[accent]
    const cls = `bg-white rounded-xl border border-orange-200 p-4 border-l-4 ${border} ${onClick ? 'hover:shadow-md transition-shadow text-left w-full' : ''}`
    return onClick
      ? <button type="button" onClick={onClick} className={cls}>{children}</button>
      : <div className={cls}>{children}</div>
  }

  return (
    <div className={`grid grid-cols-1 ${cols} gap-3 mb-6`}>
      {oldest && (
        <Card accent="red" onClick={onJumpToIndent ? () => onJumpToIndent('Indent Only – No PO') : undefined}>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-500 inline-flex items-center gap-1.5 mb-1">
            <AlertTriangle className="h-3 w-3 text-red-500" /> Oldest pending PO
          </p>
          <p className="text-sm font-bold text-stone-800 truncate" title={oldest.indentNo}>
            {shortIndent(oldest.indentNo)}
          </p>
          <p className="text-xs text-stone-500 mt-0.5">
            {oldest.worstAgeDays != null ? `${oldest.worstAgeDays}d old · ` : ''}{oldest.block || oldest.subProject}
          </p>
          <p className="text-[11px] text-stone-400 mt-0.5">
            {oldest.linesNoPo} of {oldest.totalLines} lines need PO
          </p>
        </Card>
      )}

      {biggest && (
        <Card accent="amber" onClick={onJumpToPending}>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-500 inline-flex items-center gap-1.5 mb-1">
            <PackageX className="h-3 w-3 text-amber-500" /> Biggest pending receipt
          </p>
          <p className="text-sm font-bold text-stone-800">{fmtINR(biggest.pendingValue)}</p>
          <p className="text-xs text-stone-500 mt-0.5 truncate" title={`${biggest.material} · ${biggest.supplier}`}>
            {biggest.material || biggest.indentNo} · {biggest.supplier || '—'}
          </p>
          <p className="text-[11px] text-stone-400 mt-0.5 tabular-nums">
            pending {biggest.pendingQty.toLocaleString('en-IN')} {biggest.uom}
            {biggest.oldestPoAgeDays != null ? ` · ${biggest.oldestPoAgeDays}d since PO` : ''}
          </p>
        </Card>
      )}

      {worst && (
        <Card accent="rose" onClick={onJumpToPending}>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-500 inline-flex items-center gap-1.5 mb-1">
            <UserX className="h-3 w-3 text-rose-500" /> Worst-offender vendor
          </p>
          <p className="text-sm font-bold text-stone-800 truncate" title={worst.name}>{worst.name}</p>
          <p className="text-xs text-stone-500 mt-0.5">
            {worst.overdueLines} overdue · {worst.pendingLines} pending total
          </p>
          <p className="text-[11px] text-stone-400 mt-0.5">
            {fmtINR(worst.pendingValue)} owed
            {worst.avgLagDays != null && <> · avg lag {worst.avgLagDays}d</>}
          </p>
        </Card>
      )}

      {biggestInvoice && (
        <Card accent="indigo">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-500 inline-flex items-center gap-1.5 mb-1">
            <FileText className="h-3 w-3 text-indigo-500" /> Biggest pending invoice
          </p>
          <p className="text-sm font-bold text-stone-800">{fmtINR(biggestInvoice.grnValue - biggestInvoice.invoiceAmount)}</p>
          <p className="text-xs text-stone-500 mt-0.5 truncate" title={`${biggestInvoice.material} · ${biggestInvoice.supplier}`}>
            {biggestInvoice.material || biggestInvoice.indentNo} · {biggestInvoice.supplier || '—'}
          </p>
          <p className="text-[11px] text-stone-400 mt-0.5">
            received {biggestInvoice.receivedQty} · invoiced for {fmtINR(biggestInvoice.invoiceAmount)}
          </p>
        </Card>
      )}
    </div>
  )
}
