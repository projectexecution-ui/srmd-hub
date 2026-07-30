'use client'
// "Today's chase list" — the one screen that answers "what do I call about
// first?" across EVERY project at once. Two short sections:
//   • Chase delivery  — ordered but not received, biggest ₹ / oldest first
//   • Raise / follow PO — no PO yet, 7–89 days old (fresh <7d is noise,
//                         90+ is the abandoned pile handled elsewhere)
// Tap any row to open the same detail sheet (chase note + drop) used
// everywhere else. Collapsible; remembers its state.

import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { LineRecord } from '@/lib/procurement'
import type { ChaseNote } from '@/lib/procurement/chase-notes'
import { SourceInspector } from './SourceInspector'
import { Zap, ChevronDown, ChevronRight, PackageX, ClipboardList, Building2 } from 'lucide-react'
import { cn } from '@/lib/utils'

const COLLAPSE_KEY = 'ct-today-chase-collapsed'
const TOP_N = 6

function fmtINR(n: number) {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`
  if (n >= 1e3) return `₹${(n / 1e3).toFixed(1)} K`
  return `₹${n.toLocaleString('en-IN')}`
}
function ageClass(a: number | null) {
  if (a == null) return 'text-stone-500'
  if (a >= 30) return 'text-red-700 font-bold'
  if (a >= 14) return 'text-rose-600 font-semibold'
  if (a >= 7) return 'text-amber-700 font-medium'
  return 'text-stone-500'
}
const shortIndent = (no: string) => no.replace('IND/SRASSK/', '').replace('IND/SRET/', '').replace('IND/SRJT/', '')

export function TodaysChaseList({
  lines,
  chaseNotes,
  onNoteSaved,
  onDropped,
}: {
  lines: LineRecord[]
  chaseNotes?: Map<string, ChaseNote>
  onNoteSaved?: (n: ChaseNote) => void
  onDropped?: () => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  const [inspecting, setInspecting] = useState<LineRecord | null>(null)

  useEffect(() => {
    try { setCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1') } catch { /* ignore */ }
  }, [])
  const toggle = () => setCollapsed(c => {
    const next = !c
    try { localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0') } catch { /* ignore */ }
    return next
  })

  const chaseDelivery = useMemo(
    () => lines
      .filter(l => l.pendingQty > 0)
      .sort((a, b) => (b.pendingValue - a.pendingValue) || ((b.indentAgeDays ?? 0) - (a.indentAgeDays ?? 0))),
    [lines],
  )
  const raisePo = useMemo(
    () => lines
      .filter(l => l.status === 'no_po' && (l.indentAgeDays ?? 0) >= 7 && (l.indentAgeDays ?? 0) < 90)
      .sort((a, b) => (b.indentAgeDays ?? 0) - (a.indentAgeDays ?? 0)),
    [lines],
  )

  const total = chaseDelivery.length + raisePo.length
  if (total === 0) return null

  return (
    <div className="bg-white rounded-xl border-2 border-orange-200 shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={toggle}
        className="w-full flex items-center gap-2 px-4 py-3 bg-gradient-to-r from-orange-50 to-amber-50 text-left"
        aria-expanded={!collapsed}
      >
        <Zap className="h-4 w-4 text-orange-700 flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-red-900">Today&apos;s chase list</div>
          <div className="text-[11px] text-stone-500">{total} item{total === 1 ? '' : 's'} to follow up · across all your projects</div>
        </div>
        {collapsed ? <ChevronRight className="h-5 w-5 text-stone-400" /> : <ChevronDown className="h-5 w-5 text-stone-400" />}
      </button>

      {!collapsed && (
        <div className="divide-y divide-stone-100">
          {chaseDelivery.length > 0 && (
            <Section
              title="Chase delivery"
              subtitle="ordered, not yet received"
              icon={<PackageX className="h-3.5 w-3.5 text-amber-600" />}
              count={chaseDelivery.length}
            >
              {chaseDelivery.slice(0, TOP_N).map(ln => (
                <Row key={ln.id} ln={ln} onTap={() => setInspecting(ln)}
                  right={<span className="font-bold text-stone-800 tabular-nums">{ln.pendingValue > 0 ? fmtINR(ln.pendingValue) : '—'}</span>}
                  meta={ln.supplier || shortIndent(ln.indentNo)} />
              ))}
            </Section>
          )}
          {raisePo.length > 0 && (
            <Section
              title="Raise / follow up PO"
              subtitle="no PO yet (7–89 days)"
              icon={<ClipboardList className="h-3.5 w-3.5 text-red-600" />}
              count={raisePo.length}
            >
              {raisePo.slice(0, TOP_N).map(ln => (
                <Row key={ln.id} ln={ln} onTap={() => setInspecting(ln)}
                  right={<span className="text-[11px] text-stone-400">no PO</span>}
                  meta={shortIndent(ln.indentNo)} />
              ))}
            </Section>
          )}
        </div>
      )}

      <SourceInspector
        line={inspecting}
        onClose={() => setInspecting(null)}
        note={inspecting ? chaseNotes?.get(inspecting.indentNo) : undefined}
        onNoteSaved={onNoteSaved}
        onToggleDrop={onDropped}
      />
    </div>
  )
}

function Section({
  title, subtitle, icon, count, children,
}: { title: string; subtitle: string; icon: ReactNode; count: number; children: ReactNode }) {
  const shown = Math.min(count, TOP_N)
  return (
    <div className="px-2 py-2">
      <div className="flex items-center gap-1.5 px-2 py-1">
        {icon}
        <span className="text-[11px] font-bold uppercase tracking-wider text-stone-600">{title}</span>
        <span className="text-[10px] text-stone-400">· {subtitle}</span>
      </div>
      <div className="flex flex-col">{children}</div>
      {count > TOP_N && (
        <div className="text-[10px] text-stone-400 px-2 pt-1">Showing top {shown} of {count} — open the tab to see the rest.</div>
      )}
    </div>
  )
}

function Row({
  ln, onTap, right, meta,
}: { ln: LineRecord; onTap: () => void; right: ReactNode; meta: string }) {
  const age = ln.indentAgeDays ?? null
  return (
    <button type="button" onClick={onTap}
      className="flex items-center gap-2 text-left px-2 py-2 rounded-lg hover:bg-orange-50/60 active:bg-orange-50">
      <div className="min-w-0 flex-1">
        <div className="text-sm text-stone-800 truncate" title={ln.material}>{ln.material}</div>
        <div className="text-[11px] text-stone-500 truncate flex items-center gap-1">
          <Building2 className="h-2.5 w-2.5 flex-shrink-0 text-stone-400" />
          <span className="truncate">{ln.project}</span>
          <span className="text-stone-300">·</span>
          <span className="truncate">{meta}</span>
        </div>
      </div>
      <div className="flex flex-col items-end flex-shrink-0">
        {right}
        <span className={cn('text-[11px] tabular-nums', ageClass(age))}>{age ?? '—'}d</span>
      </div>
      <ChevronRight className="h-4 w-4 text-stone-300 flex-shrink-0" />
    </button>
  )
}
