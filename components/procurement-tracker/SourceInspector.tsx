'use client'
// Read-only modal that shows the EXACT source-Excel rows that
// produced a given LineRecord, alongside the parsed values. Lets
// Aksha verify "what the parser computed" against "what's actually
// in the upload" without leaving the page.

import { useEffect, useState } from 'react'
import type { LineRecord, SourceRow } from '@/lib/procurement'
import { X, FileSpreadsheet, Tag, MessageSquare, PhoneCall, Loader2, Check } from 'lucide-react'
import { toast } from 'sonner'
import type { ChaseNote } from '@/lib/procurement/chase-notes'
import { chasedLabel } from '@/lib/procurement/chase-notes'

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

export function SourceInspector({
  line,
  onClose,
  note,
  onNoteSaved,
}: {
  line: LineRecord | null
  onClose: () => void
  /** Existing chase note for this line's indent, if any. */
  note?: ChaseNote
  /** When provided, the chase-note editor is shown; called with the fresh note after a save. */
  onNoteSaved?: (n: ChaseNote) => void
}) {
  const [draft, setDraft] = useState('')
  const [current, setCurrent] = useState<ChaseNote | null>(null)
  const [saving, setSaving] = useState<null | 'note' | 'chase'>(null)

  // Close on Escape
  useEffect(() => {
    if (!line) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [line, onClose])

  // Re-seed the editor whenever a different line (indent) opens.
  useEffect(() => {
    setCurrent(note ?? null)
    setDraft(note?.note ?? '')
  }, [line?.indentNo, note])

  async function save(markChased: boolean) {
    if (!line) return
    setSaving(markChased ? 'chase' : 'note')
    try {
      const res = await fetch('/api/procurement-tracker/chase-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ indentNo: line.indentNo, note: draft, markChased }),
      })
      const json = await res.json()
      if (!res.ok || json.error) { toast.error(json.error || 'Could not save the note.'); return }
      setCurrent(json.note)
      onNoteSaved?.(json.note)
      toast.success(markChased ? 'Chase logged' : 'Note saved')
    } catch {
      toast.error('Network error — note not saved.')
    } finally {
      setSaving(null)
    }
  }

  if (!line) return null
  const rows = line.sourceRows ?? []
  const lastChased = chasedLabel(current?.lastChasedAt)

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
          {/* Chase note — per-indent follow-up memory (only when wired) */}
          {onNoteSaved && (
            <div className="px-5 py-4 border-b border-stone-100 bg-amber-50/40">
              <div className="flex items-center justify-between gap-2 mb-2">
                <h4 className="text-[10px] uppercase tracking-wider text-amber-800 font-bold inline-flex items-center gap-1.5">
                  <MessageSquare className="h-3.5 w-3.5" /> Chase note
                </h4>
                {lastChased && (
                  <span className="text-[11px] text-stone-500 inline-flex items-center gap-1">
                    <Check className="h-3 w-3 text-emerald-600" /> Last chased <b className="text-stone-700 font-medium">{lastChased}</b>
                  </span>
                )}
              </div>
              <textarea
                value={draft}
                onChange={e => setDraft(e.target.value)}
                rows={2}
                placeholder="e.g. Called vendor — promised dispatch by Fri. Awaiting LR."
                className="w-full rounded-lg border border-stone-200 bg-white text-sm text-stone-800 placeholder:text-stone-400 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-200 focus:border-amber-300 resize-y"
              />
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => save(true)}
                  disabled={saving !== null}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold bg-gradient-to-br from-orange-700 to-red-900 text-white px-3 py-1.5 rounded-lg hover:opacity-90 disabled:opacity-50"
                  title="Save the note and mark this indent as chased today"
                >
                  {saving === 'chase' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PhoneCall className="h-3.5 w-3.5" />}
                  Mark chased now
                </button>
                <button
                  type="button"
                  onClick={() => save(false)}
                  disabled={saving !== null || draft === (current?.note ?? '')}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-stone-600 hover:text-stone-900 bg-white border border-stone-200 hover:border-stone-300 px-3 py-1.5 rounded-lg disabled:opacity-40"
                >
                  {saving === 'note' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  Save note only
                </button>
                {current?.updatedByName && (
                  <span className="text-[10px] text-stone-400 ml-auto">by {current.updatedByName}</span>
                )}
              </div>
            </div>
          )}

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
