// "Needs you now" — the top of the home. Cost Control budget approvals waiting
// on this person are grouped by PROJECT → sub-discipline (reading exactly like
// My Approvals: project budget approved so far → after, every budget shown, no
// redundant "Approve" pill). Any non-budget items (indents, JMR, site reports)
// follow as a simple list. A clear inbox shows an honest "all caught up".

import Link from 'next/link'
import { formatINR } from '@/lib/utils'
import { labelFor } from '@/lib/module-labels'
import { inboxActionLabel } from '@/lib/approvals/inbox-action'
import { CheckCircle2, ArrowRight, Clock, Bell } from 'lucide-react'
import type { HomeBudgetProject } from '@/lib/cost-control/my-budget-approvals'

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

const MAX_OTHER = 6

// Soft, distinct colour per project (stable by project code) — same palette as
// My Approvals so the two screens feel like one system.
const TONES = [
  { rail: 'border-l-indigo-300', head: 'bg-indigo-50/70', code: 'bg-indigo-100 text-indigo-700', avatar: 'bg-indigo-100 text-indigo-700' },
  { rail: 'border-l-teal-300',   head: 'bg-teal-50/70',   code: 'bg-teal-100 text-teal-700',     avatar: 'bg-teal-100 text-teal-700' },
  { rail: 'border-l-violet-300', head: 'bg-violet-50/70', code: 'bg-violet-100 text-violet-700', avatar: 'bg-violet-100 text-violet-700' },
  { rail: 'border-l-rose-300',   head: 'bg-rose-50/70',   code: 'bg-rose-100 text-rose-700',     avatar: 'bg-rose-100 text-rose-700' },
  { rail: 'border-l-sky-300',    head: 'bg-sky-50/70',    code: 'bg-sky-100 text-sky-700',       avatar: 'bg-sky-100 text-sky-700' },
  { rail: 'border-l-amber-300',  head: 'bg-amber-50/70',  code: 'bg-amber-100 text-amber-700',   avatar: 'bg-amber-100 text-amber-700' },
]
function toneFor(key: string) {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return TONES[h % TONES.length]
}

function ageDays(iso: string, now: number): number {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return 0
  return Math.max(0, Math.floor((now - t) / 86_400_000))
}
function isLate(urgency: string | null, iso: string, now: number): boolean {
  return urgency === 'urgent' || urgency === 'emergency' || ageDays(iso, now) >= 2
}

export function NeedsYouNow({
  budgetProjects, otherItems, totalCount, moduleLabels, error,
}: {
  budgetProjects: HomeBudgetProject[]
  otherItems: InboxItem[]
  totalCount: number
  moduleLabels: ModuleLabels
  error?: boolean
}) {
  // Server component — renders once per request, so this is a stable "as-of-now"
  // snapshot for age/urgency, not an impure render.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now()

  if (error) {
    return (
      <section className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
        <p className="font-semibold">Couldn’t load what needs you.</p>
        <p className="text-rose-700 text-xs mt-0.5">Usually transient — refresh. If it persists, tell your admin.</p>
      </section>
    )
  }

  if (totalCount === 0) {
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

  const budgetAmount = budgetProjects.reduce((s, p) => s + p.disciplines.reduce((ds, d) => ds + d.items.reduce((is, i) => is + i.amount, 0), 0), 0)
  const otherAmount = otherItems.reduce((s, r) => s + (r.amount ?? 0), 0)
  const totalAmount = budgetAmount + otherAmount
  const budgetUrgent = budgetProjects.reduce((s, p) => s + p.disciplines.reduce((ds, d) => ds + d.items.filter(i => isLate(i.urgency, i.createdAt, now)).length, 0), 0)
  const otherUrgent = otherItems.filter(r => isLate(r.urgency, r.created_at, now)).length
  const urgent = budgetUrgent + otherUrgent
  const shownOther = otherItems.slice(0, MAX_OTHER)

  return (
    <section className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-100 bg-gradient-to-r from-blue-50/70 to-transparent">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <Bell className="h-4 w-4 text-blue-700 flex-shrink-0" />
          <h2 className="text-sm font-bold text-gray-900">Needs you now</h2>
          <span className="text-xs font-semibold text-blue-700 bg-blue-100 rounded-full px-2 py-0.5">{totalCount}</span>
          {urgent > 0 && (
            <span className="text-xs font-semibold text-rose-700 bg-rose-100 rounded-full px-2 py-0.5">{urgent} urgent</span>
          )}
          {totalAmount > 0 && (
            <span className="text-xs font-medium text-gray-500 hidden sm:inline truncate tabular-nums">· {formatINR(totalAmount)} waiting</span>
          )}
        </div>
        <Link href="/approvals" className="text-xs font-semibold text-blue-700 hover:underline flex-shrink-0 inline-flex items-center gap-1">
          View all <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {/* ── Budget approvals — project → sub-discipline → every budget ── */}
      {budgetProjects.map(proj => {
        const tone = toneFor(proj.code || proj.projectId)
        return (
          <div key={proj.projectId} className={`border-l-4 ${tone.rail} border-b border-gray-100`}>
            <div className={`px-4 py-2.5 ${tone.head}`}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`inline-flex h-6 w-6 items-center justify-center rounded-md text-xs flex-shrink-0 ${tone.avatar}`}>🏢</span>
                <span className="text-sm font-bold text-gray-900 truncate">{proj.name ?? '—'}</span>
                {proj.code && <span className={`font-mono text-[11px] rounded px-1.5 py-0.5 flex-shrink-0 ${tone.code}`}>{proj.code}</span>}
              </div>
              <div className="mt-1.5 flex items-baseline gap-x-2 gap-y-0.5 flex-wrap tabular-nums">
                <span className="text-[10px] uppercase tracking-wide text-gray-400">Project budget approved</span>
                <span className="text-sm font-bold text-gray-900">{formatINR(proj.before)}</span>
                <ArrowRight className="h-3 w-3 text-gray-400 self-center" />
                <span className="text-sm font-bold text-emerald-700">{formatINR(proj.after)}</span>
                <span className="text-[11px] text-gray-500">if you approve {proj.count === 1 ? 'this' : 'these'} (+{formatINR(proj.increment)})</span>
              </div>
            </div>

            <div className="pb-1">
              {proj.disciplines.map(disc => (
                <div key={disc.disciplineId}>
                  <div className="flex items-baseline justify-between gap-2 px-4 py-1.5 bg-gray-100/70 border-y border-gray-200">
                    <span className="text-[11px] font-bold text-gray-700 uppercase tracking-wide truncate inline-flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-sm bg-gray-400 flex-shrink-0" />
                      {disc.name ?? '—'}
                    </span>
                    <span className="text-[11px] text-gray-500 tabular-nums whitespace-nowrap normal-case">
                      approved <b className="text-gray-800">{formatINR(disc.before)}</b> → <b className="text-emerald-700">{formatINR(disc.after)}</b>
                    </span>
                  </div>
                  <div className="divide-y divide-gray-100 px-4">
                    {disc.items.map(it => {
                      const late = isLate(it.urgency, it.createdAt, now)
                      const age = ageDays(it.createdAt, now)
                      return (
                        <Link key={it.id} href={it.docUrl} className="flex items-center gap-3 py-2 hover:bg-gray-50/70 rounded-lg -mx-1 px-1 transition-colors">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-gray-900 truncate">{it.subName ?? it.wsCode ?? '—'}</p>
                            {it.wsCode && <p className="text-[11px] font-mono text-gray-400 truncate">{it.wsCode}</p>}
                          </div>
                          {late && (
                            <span className="hidden sm:inline-flex items-center gap-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-100 text-[10px] font-bold px-2 py-0.5 flex-shrink-0">
                              <Clock className="h-3 w-3" />{age === 0 ? 'today' : `${age}d`}
                            </span>
                          )}
                          <span className="text-sm font-bold text-gray-900 tabular-nums flex-shrink-0 whitespace-nowrap">{formatINR(it.amount)}</span>
                        </Link>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })}

      {/* ── Anything else waiting (non-budget) — kept as a simple list ── */}
      {shownOther.length > 0 && (
        <ul className="divide-y divide-gray-100">
          {shownOther.map((r, i) => {
            const late = isLate(r.urgency, r.created_at, now)
            const age = ageDays(r.created_at, now)
            const emoji = MOD_EMOJI[r.module_slug] ?? '•'
            const modLabel = labelFor(moduleLabels, r.module_slug)
            const proj = r.project_code && r.project_name && r.project_code !== r.project_name
              ? `${r.project_code} · ${r.project_name}`
              : (r.project_code || r.project_name || '')
            const headline = r.work_label || r.doc_no || modLabel
            const meta = [modLabel, proj || null, r.raised_by ? `by ${r.raised_by}` : null].filter(Boolean).join(' · ')
            return (
              <li key={`${r.doc_id ?? r.doc_url}-${i}`}>
                <Link href={r.doc_url} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50/80 transition-colors">
                  <span className={`h-9 w-9 rounded-xl flex items-center justify-center text-base flex-shrink-0 ${late ? 'bg-rose-50' : 'bg-blue-50'}`}>{emoji}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-900 truncate">{headline}</p>
                    <p className="text-xs text-gray-500 truncate">{meta}</p>
                  </div>
                  {r.next_stage && (
                    <span className={`hidden md:inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold flex-shrink-0 ${late ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-800'}`}>
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
      )}

      {otherItems.length > MAX_OTHER && (
        <Link href="/approvals" className="block text-center text-xs font-semibold text-blue-700 hover:bg-blue-50/60 py-2.5 border-t border-gray-100">
          + {otherItems.length - MAX_OTHER} more waiting on you →
        </Link>
      )}
    </section>
  )
}
