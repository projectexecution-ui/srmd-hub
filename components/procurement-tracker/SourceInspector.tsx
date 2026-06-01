'use client'
// Read-only modal that shows the EXACT source-Excel rows that
// produced a given LineRecord, alongside the parsed values. Lets
// Aksha verify "what the parser computed" against "what's actually
// in the upload" without leaving the page.

import { useEffect } from 'react'
import type { LineRecord, SourceRow } from '@/lib/procurement'
import { X, FileSpreadsheet, Tag } from 'lucide-react'

const ROLE_STYLES: Record<SourceRow['role'], { label: string; bg: string; text: string }> = {
  indent:   { label: 'Indent',   bg: 'bg-red-50',     text: 'text-red-800' },
  material: { label: 'Material', bg: 'bg-orange-50',  text: 'text-orange-800' },
  po:       { label: 'PO',       bg: 'bg-amber-50',   text: 'text-amber-900' },
  grn:      { label: 'GRN',      bg: 'bg-emerald-50', text: 'text-emerald-800' },
  invoice:  { label: 'Invoice',  bg: 'bg-indigo-50',  text: 'text-indigo-800' },
}

function fmtCell(v: string | number | null): string {
  if (v == null) return ''
  if (typeof v === 'number') return v.toLocaleString('en-IN')
  return String(v)
}

export function SourceInspector({ line, onClose }: { line: LineRecord | null; onClose: () => void }) {
  // Close on Escape
  useEffect(() => {
    if (!line) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [line, onClose])

  if (!line) return null
  const rows = line.sourceRows ?? []

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-stretch md:items-center md:justify-center p-0 md:p-4"
      onClick={onClose}
    >
      <div
        className="bg-white w-full md:max-w-4xl md:max-h-[90vh] md:rounded-2xl shadow-xl flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-3 border-b border-stone-200 bg-stone-50 flex-shrink-0">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-stone-800 flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 text-orange-700" />
              Source rows for this material
            </h3>
            <p className="text-[11px] text-stone-500 mt-0.5 font-mono truncate">{line.indentNo}</p>
          </div>
          <button
            onClick={onClose}
            className="text-stone-400 hover:text-stone-700 flex-shrink-0"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Parsed-vs-source summary */}
          <div className="px-5 py-4 border-b border-stone-100">
            <h4 className="text-[10px] uppercase tracking-wider text-stone-500 font-semibold mb-2">Parser's view</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs">
              <KV k="Material"        v={line.material} />
              <KV k="UOM"             v={line.uom || '—'} />
              <KV k="Indent date"     v={line.indentDate} />
              <KV k="Block"           v={line.block || '—'} />
              <KV k="Project"         v={line.project} />
              <KV k="Discipline"      v={line.discipline} />
              <KV k="Indent qty"      v={line.indentQty} />
              <KV k="Ordered qty"     v={line.orderedQty} />
              <KV k="Received qty"    v={line.receivedQty} />
              <KV k="Pending qty"     v={line.pendingQty} />
              <KV k="GRN value (₹)"   v={line.grnValue.toLocaleString('en-IN')} />
              <KV k="Pending value (₹)" v={line.pendingValue.toLocaleString('en-IN')} />
              <KV k="Supplier"        v={line.supplier || '—'} />
              <KV k="Status"          v={line.status} />
              <KV k="POs attached"    v={line.pos.length} />
              <KV k="GRNs attached"   v={line.grns.length} />
            </div>
          </div>

          {/* Source rows */}
          <div className="px-5 py-4">
            <h4 className="text-[10px] uppercase tracking-wider text-stone-500 font-semibold mb-2">
              Excel source rows ({rows.length})
            </h4>
            {rows.length === 0 ? (
              <p className="text-xs text-stone-500 italic">
                No source rows captured for this material. (Older uploads parsed before this feature shipped don&apos;t have them — re-upload to populate.)
              </p>
            ) : (
              <div className="space-y-3">
                {rows.map((sr, i) => (
                  <div key={`${sr.rowIndex}-${i}`} className="border border-stone-200 rounded-lg overflow-hidden">
                    <div className={`flex items-center gap-2 px-3 py-1.5 ${ROLE_STYLES[sr.role].bg} border-b border-stone-100`}>
                      <Tag className={`h-3 w-3 ${ROLE_STYLES[sr.role].text}`} />
                      <span className={`text-[10px] font-bold uppercase tracking-wider ${ROLE_STYLES[sr.role].text}`}>
                        {ROLE_STYLES[sr.role].label}
                      </span>
                      <span className="text-[10px] text-stone-500 ml-auto font-mono">
                        row {sr.rowIndex + 1} {/* Excel users see 1-based row numbers */}
                      </span>
                    </div>
                    <table className="w-full text-xs">
                      <tbody className="divide-y divide-stone-50">
                        {sr.cells.map((c, j) => (
                          <tr key={j}>
                            <td className="px-3 py-1 text-[11px] text-stone-500 font-medium w-1/3 align-top whitespace-nowrap">
                              {c.label}
                            </td>
                            <td className="px-3 py-1 text-stone-800 break-words">{fmtCell(c.value)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="px-5 py-2 border-t border-stone-100 text-[10px] text-stone-400 bg-stone-50 flex-shrink-0">
          Read-only · cross-check with IN4 to spot any genuine bug
        </div>
      </div>
    </div>
  )
}

function KV({ k, v }: { k: string; v: string | number }) {
  return (
    <div className="flex items-baseline gap-2 min-w-0">
      <span className="text-stone-500 text-[11px] flex-shrink-0">{k}:</span>
      <span className="font-medium text-stone-800 truncate" title={String(v)}>{v}</span>
    </div>
  )
}
