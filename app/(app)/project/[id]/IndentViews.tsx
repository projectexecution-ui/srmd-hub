'use client'
import { useState, useMemo, useEffect, useCallback } from 'react'
import type { LineRecord } from '@/lib/procurement'
import type { ChaseNote } from '@/lib/procurement/chase-notes'
import { PendingReceiptsView } from '@/components/procurement-tracker/PendingReceiptsView'
import { IndentsNeedingPoView } from '@/components/procurement-tracker/IndentsNeedingPoView'
import { CompletedView } from '@/components/procurement-tracker/CompletedView'
import { PackageX, ClipboardList, CheckCircle2 } from 'lucide-react'

type View = 'pending' | 'needs-po' | 'completed'

/**
 * The Indent → PO tracker's OWN three views, inside the project cockpit.
 *
 * Deliberately the same components the tracker page renders —
 * PendingReceiptsView / IndentsNeedingPoView / CompletedView — rather than a
 * second implementation. They already carry the chase notes, the ageing, the
 * grouping, the search and the source drill-down; rebuilding any of that here
 * would mean two versions to keep in step and two places for a bug to hide.
 *
 * The only difference from the tracker page is the input: these lines are the
 * ones attributed to THIS project (and anything under it), instead of the
 * whole portfolio filtered by a chip.
 *
 * Aksha's two questions, which is why these three views and nothing else:
 *   1. What have I ordered but not received?  → Pending receipts
 *   2. What has my purchase team not PO'd?    → Needs PO
 */
export function IndentViews({ lines, projectName }: { lines: LineRecord[]; projectName: string }) {
  const [view, setView] = useState<View>('pending')
  const [chaseNotes, setChaseNotes] = useState<Map<string, ChaseNote>>(new Map())

  // Team-shared chase notes, same source as the tracker page. Best-effort: a
  // failure here must not take the tab down, it just means no note chips.
  useEffect(() => {
    let cancelled = false
    fetch('/api/procurement-tracker/chase-notes')
      .then(r => (r.ok ? r.json() : null))
      .then(json => {
        if (cancelled || !json?.notes) return
        setChaseNotes(new Map((json.notes as ChaseNote[]).map(n => [n.indentNo, n])))
      })
      .catch(() => { /* no notes, no problem */ })
    return () => { cancelled = true }
  }, [])

  const onNoteSaved = useCallback((n: ChaseNote) => {
    setChaseNotes(prev => new Map(prev).set(n.indentNo, n))
  }, [])

  const pending = useMemo(() => lines.filter(l => l.pendingQty > 0), [lines])
  const needsPo = useMemo(() => lines.filter(l => l.status === 'no_po'), [lines])
  const completed = useMemo(
    () => lines.filter(l => l.status === 'received' && l.pos.length > 0 && l.grns.length > 0),
    [lines],
  )

  // 30 days is the tracker's own overdue mark. Surfaced on the tab button so a
  // problem is visible without opening the view.
  const overdue = (rows: LineRecord[]) => rows.filter(l => (l.indentAgeDays ?? 0) >= 30).length
  const pendingOverdue = overdue(pending)
  const needsPoOverdue = overdue(needsPo)

  const tabs: Array<{ id: View; label: string; icon: typeof PackageX; count: number; late: number; tone: string }> = [
    { id: 'pending',   label: 'Pending receipts', icon: PackageX,      count: pending.length,   late: pendingOverdue, tone: 'amber' },
    { id: 'needs-po',  label: 'Needs PO',         icon: ClipboardList, count: needsPo.length,   late: needsPoOverdue, tone: 'rose' },
    { id: 'completed', label: 'Completed',        icon: CheckCircle2,  count: completed.length, late: 0,              tone: 'emerald' },
  ]

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {tabs.map(t => {
          const Icon = t.icon
          const active = view === t.id
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setView(t.id)}
              className={[
                'inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors min-h-[44px]',
                active
                  ? 'border-gray-900 bg-gray-900 text-white'
                  : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50',
              ].join(' ')}
            >
              <Icon className={`h-4 w-4 ${active ? '' : t.tone === 'amber' ? 'text-amber-600' : t.tone === 'rose' ? 'text-rose-600' : 'text-emerald-600'}`} />
              {t.label}
              <span className={[
                'rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums',
                active ? 'bg-white/20 text-white'
                  : t.late > 0 ? 'bg-red-100 text-red-800'
                  : t.tone === 'emerald' ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-amber-100 text-amber-800',
              ].join(' ')}>
                {t.count}{!active && t.late > 0 ? ` · ${t.late}!` : ''}
              </span>
            </button>
          )
        })}
      </div>

      {view === 'pending' && (
        <PendingReceiptsView lines={pending} projectName={projectName} chaseNotes={chaseNotes} onNoteSaved={onNoteSaved} />
      )}
      {view === 'needs-po' && (
        <IndentsNeedingPoView lines={needsPo} projectName={projectName} chaseNotes={chaseNotes} onNoteSaved={onNoteSaved} />
      )}
      {view === 'completed' && (
        <CompletedView lines={completed} projectName={projectName} />
      )}
    </div>
  )
}
