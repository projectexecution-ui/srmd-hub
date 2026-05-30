'use client'
import type { ProjectSummary, IndentStatus } from '@/lib/procurement'

interface Props {
  summary: ProjectSummary
  onJumpToIndent?: (filter: IndentStatus | 'all') => void
}

export function FunnelBand({ summary, onJumpToIndent }: Props) {
  const { total, indentOnlyNoPo, poRaisedGrnPending, poDoneGrnReceived } = summary
  const Btn = ({ filter, dot, label, count }: { filter: IndentStatus; dot: string; label: string; count: number }) => {
    const cls = `inline-flex items-center gap-1.5 text-stone-600 ${onJumpToIndent ? 'hover:text-stone-900 cursor-pointer' : ''}`
    const inner = (
      <>
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        {label}
        <b className="text-stone-900 tabular-nums">{count}</b>
      </>
    )
    return onJumpToIndent
      ? <button type="button" className={cls} onClick={() => onJumpToIndent(filter)}>{inner}</button>
      : <span className={cls}>{inner}</span>
  }
  return (
    <div className="bg-white rounded-xl border border-orange-200 px-4 py-3 mb-6 flex flex-wrap gap-x-6 gap-y-2 text-xs">
      <Btn filter="Indent Only – No PO"      dot="bg-red-500"     label="No PO yet"               count={indentOnlyNoPo} />
      <Btn filter="PO Raised – GRN Pending"  dot="bg-amber-500"   label="PO raised — GRN pending" count={poRaisedGrnPending} />
      <Btn filter="PO Done & GRN Received"   dot="bg-emerald-500" label="GRN received"            count={poDoneGrnReceived} />
      <span className="text-stone-400 ml-auto">{total} total indents</span>
    </div>
  )
}
