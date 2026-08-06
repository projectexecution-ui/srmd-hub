// "Needs you now" — the top of the My Day home. One cross-module list of every
// item waiting on THIS person's action (from my_approval_inbox), each a one-tap
// deep link. Universal: anyone who approves anything sees their queue here; a
// clear inbox shows an honest "all caught up".

import Link from 'next/link'
import { formatINR } from '@/lib/utils'
import { labelFor } from '@/lib/module-labels'
import { inboxActionLabel } from '@/lib/approvals/inbox-action'
import { CheckCircle2, ArrowRight, Clock, Bell } from 'lucide-react'

export interface InboxItem {
  module_slug: string
  doc_type: string
  doc_id: string | null
  doc_no: string | null
  doc_url: string
  next_stage: string | null
  project_code: string | null
  project_name: string | null
  amount: number | null
  urgency: string | null
  created_at: string
  /** What the item is FOR — CC sub-skill / indent sub-project (null for others). */
  work_label: string | null
  /** Who raised/owns it (null where not resolved). */
  raised_by: string | null
}

type ModuleLabels = Parameters<typeof labelFor>[0]

const MOD_EMOJI: Record<string, string> = {
  'cost-control': '📐', 'indents': '📦', 'procurement-tracker': '📦', 'pos': '📦',
  'grns': '📦', 'invoices': '🧾', 'bills-pipeline': '🧾', 'jmr': '📏',
  'inventory': '🏬', 'daily-site-report': '🧱',
}

const MAX_SHOWN = 6

function ageDays(iso: string, now: number): number {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return 0
  return Math.max(0, Math.floor((now - t) / 86_400_000))
}

export function NeedsYouNow({
  items, moduleLabels, error,
}: {
  items: InboxItem[]
  moduleLabels: ModuleLabels
  error?: boolean
}) {
  const now = Date.now()
  const total = items.length
  const urgent = items.filter(r => r.urgency === 'urgent' || r.urgency === 'emergency' || ageDays(r.created_at, now) >= 2)
  const totalAmount = items.reduce((s, r) => s + (r.amount ?? 0), 0)

  // If the inbox failed we must say so — an empty list would otherwise look
  // identical to "all caught up" and someone misses an approval.
  if (error) {
    return (
      <section className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
        <p className="font-semibold">Couldn’t load what needs you.</p>
        <p className="text-rose-700 text-xs mt-0.5">Usually transient — refresh. If it persists, tell your admin.</p>
      </section>
    )
  }

  if (total === 0) {
    return (
      <section className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 flex items-center gap-3">
        <CheckCircle2 className="h-6 w-6 text-emerald-600 flex-shrink-0" />
        <div>
          <p className="text-sm font-semibold text-emerald-900">You’re all caught up</p>
          <p className="text-xs text-emerald-700/90">Nothing is waiting on your action right now.</p>
        </div>
      </section>
    )
  }

  const shown = items.slice(0, MAX_SHOWN)

  return (
    <section className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-100 bg-gradient-to-r from-blue-50/70 to-transparent">
        <div className="flex items-center gap-2 min-w-0">
          <Bell className="h-4 w-4 text-blue-700 flex-shrink-0" />
          <h2 className="text-sm font-bold text-gray-900">Needs you now</h2>
          <span className="text-xs font-semibold text-blue-700 bg-blue-100 rounded-full px-2 py-0.5">{total}</span>
          {urgent.length > 0 && (
            <span className="text-xs font-semibold text-rose-700 bg-rose-100 rounded-full px-2 py-0.5">{urgent.length} urgent</span>
          )}
          {totalAmount > 0 && (
            <span className="text-xs font-medium text-gray-500 hidden sm:inline truncate">· {formatINR(totalAmount)} waiting</span>
          )}
        </div>
        <Link href="/approvals" className="text-xs font-semibold text-blue-700 hover:underline flex-shrink-0 inline-flex items-center gap-1">
          View all <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      <ul className="divide-y divide-gray-100">
        {shown.map((r, i) => {
          const age = ageDays(r.created_at, now)
          const late = r.urgency === 'urgent' || r.urgency === 'emergency' || age >= 2
          const emoji = MOD_EMOJI[r.module_slug] ?? '•'
          const modLabel = labelFor(moduleLabels, r.module_slug)
          // Dedupe "NGH A · NGH A" → "NGH A".
          const proj = r.project_code && r.project_name && r.project_code !== r.project_name
            ? `${r.project_code} · ${r.project_name}`
            : (r.project_code || r.project_name || '')
          // Headline = the work it's FOR when we know it, else the doc no.
          const headline = r.work_label || r.doc_no || modLabel
          // Meta = module · project · who raised it · (doc no when a work headline bumped it).
          const meta = [modLabel, proj || null, r.raised_by ? `by ${r.raised_by}` : null,
                        (r.work_label && r.doc_no) ? r.doc_no : null].filter(Boolean).join(' · ')
          return (
            <li key={`${r.doc_id ?? r.doc_url}-${i}`}>
              <Link
                href={r.doc_url}
                className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50/80 transition-colors"
              >
                <span className={`h-9 w-9 rounded-xl flex items-center justify-center text-base flex-shrink-0 ${late ? 'bg-rose-50' : 'bg-blue-50'}`}>{emoji}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-gray-900 truncate">{headline}</p>
                  <p className="text-xs text-gray-500 truncate">{meta}</p>
                </div>
                {r.next_stage && (
                  <span className={`hidden md:inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold flex-shrink-0 ${late ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-800'}`}
                    title="What this item needs from you">
                    {inboxActionLabel(r.next_stage)}
                  </span>
                )}
                <div className="flex flex-col items-end gap-1 flex-shrink-0 w-[84px] text-right">
                  {r.amount != null && r.amount > 0 && (
                    <span className="text-sm font-bold text-gray-900 tabular-nums">{formatINR(r.amount)}</span>
                  )}
                  <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${late ? 'text-rose-700' : 'text-gray-400'}`}>
                    <Clock className="h-3 w-3" />{age === 0 ? 'today' : `${age}d`}
                  </span>
                </div>
              </Link>
            </li>
          )
        })}
      </ul>

      {total > MAX_SHOWN && (
        <Link href="/approvals" className="block text-center text-xs font-semibold text-blue-700 hover:bg-blue-50/60 py-2.5 border-t border-gray-100">
          + {total - MAX_SHOWN} more waiting on you →
        </Link>
      )}
    </section>
  )
}
