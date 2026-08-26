'use client'
// One strip instead of three stacked banners.
//
// On a phone the project view had grown four full-width alert cards above the
// table — awaiting approval, over budget, ready to close, plus the Internal
// Estimate panel — so you scrolled past a wall of boxes before reaching a
// single number. Counts are what you scan for; the prose behind them is what
// you read once you have decided which one matters.
//
// So: the counts always show, as one row of tappable chips. Tap one and only
// that detail opens. Nothing is hidden — it is one tap away instead of four
// screens of scrolling.

import { useState } from 'react'
import Link from 'next/link'
import { Flame, TrendingUp, CheckCircle2, ArrowRight, X } from 'lucide-react'

export interface PendingSheet {
  id: string
  /** "10 MGPS › 1004 BHP" */
  label: string
  amountLabel: string
  /** "With Atm Head" */
  stageLabel: string
  /** Days since it was submitted, or null if never submitted. */
  ageDays: number | null
  href: string
}
export interface PendingAlert {
  count: number
  amountLabel: string | null
  href: string
  thumbruleCount: number
  thumbruleHref: string
  /** The sheets themselves, so he can step straight into one from here
   *  instead of being sent to a list page to find it again. */
  sheets: PendingSheet[]
}
export interface OverBudgetAlert {
  lines: { label: string; amountLabel: string }[]
  totalLabel: string
}
export interface CompletionAlert {
  completedCount: number
  releasedLabel: string | null
  readyCount: number
  readySavingsLabel: string | null
}

type Key = 'pending' | 'over' | 'done'

export function ProjectAlerts({
  pending, over, completion,
}: {
  pending: PendingAlert | null
  over: OverBudgetAlert | null
  completion: CompletionAlert | null
}) {
  // Approvals open by default: they are the only one of the three that is
  // waiting on a person. Over-budget and ready-to-close are standing facts —
  // worth knowing, not worth opening every time you land on the page.
  const [open, setOpen] = useState<Key | null>(pending ? 'pending' : null)

  const chips: { key: Key; tone: string; icon: React.ReactNode; label: string }[] = []
  if (pending) {
    chips.push({
      key: 'pending', tone: 'amber',
      icon: <Flame className="h-3.5 w-3.5" />,
      label: `${pending.count} to approve`,
    })
  }
  if (over) {
    chips.push({
      key: 'over', tone: 'rose',
      icon: <TrendingUp className="h-3.5 w-3.5" />,
      label: `${over.lines.length} over budget`,
    })
  }
  if (completion && (completion.readyCount > 0 || completion.completedCount > 0)) {
    chips.push({
      key: 'done', tone: 'emerald',
      icon: <CheckCircle2 className="h-3.5 w-3.5" />,
      label: completion.readyCount > 0
        ? `${completion.readyCount} can close`
        : `${completion.completedCount} complete`,
    })
  }
  if (chips.length === 0) return null

  const TONES: Record<string, { idle: string; active: string; panel: string }> = {
    amber:   { idle: 'border-amber-200 bg-amber-50 text-amber-900',      active: 'border-amber-400 bg-amber-100 text-amber-900 ring-1 ring-amber-300',      panel: 'bg-amber-50/70 border-amber-200' },
    rose:    { idle: 'border-rose-200 bg-rose-50 text-rose-900',         active: 'border-rose-400 bg-rose-100 text-rose-900 ring-1 ring-rose-300',          panel: 'bg-rose-50/70 border-rose-200' },
    emerald: { idle: 'border-emerald-200 bg-emerald-50 text-emerald-900', active: 'border-emerald-400 bg-emerald-100 text-emerald-900 ring-1 ring-emerald-300', panel: 'bg-emerald-50/70 border-emerald-200' },
  }
  const activeTone = chips.find(c => c.key === open)?.tone ?? 'amber'

  return (
    <section className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      {/* Wraps rather than scrolls sideways. A horizontal scroller kept the
          strip one line tall but clipped the last chip mid-word ("32 c…"),
          which reads as broken — and a sideways scroll you cannot see is a
          sideways scroll nobody uses. Three chips wrap to at most two lines. */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
        {chips.map(c => {
          const t = TONES[c.tone]
          const isOpen = open === c.key
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => setOpen(isOpen ? null : c.key)}
              aria-expanded={isOpen}
              className={`inline-flex flex-shrink-0 items-center gap-1.5 rounded-full border px-3 min-h-[36px] text-[12.5px] font-semibold transition-colors ${isOpen ? t.active : t.idle}`}
            >
              {c.icon}
              {c.label}
              {isOpen ? <X className="h-3 w-3 opacity-60" /> : <span className="text-[10px] opacity-50">›</span>}
            </button>
          )
        })}
      </div>

      {open && (
        <div className={`border-t px-3.5 py-3 text-[12.5px] leading-snug ${TONES[activeTone].panel}`}>
          {open === 'pending' && pending && (
            <>
              <p className="font-semibold text-amber-900">
                {pending.count} working sheet{pending.count === 1 ? '' : 's'} awaiting approval
                {pending.amountLabel && <span className="font-normal"> · {pending.amountLabel} yet to be released</span>}
              </p>

              {/* The sheets themselves. Naming them here and linking each one
                  straight to its voucher saves a hop through a list page where
                  he would have to find the same row again. */}
              {pending.sheets.length > 0 && (
                <ul className="mt-2 divide-y divide-amber-200/70 rounded-lg border border-amber-200 bg-white overflow-hidden">
                  {pending.sheets.map(s => (
                    <li key={s.id}>
                      <Link
                        href={s.href}
                        className="flex items-center gap-3 px-3 py-2.5 min-h-[52px] hover:bg-amber-50/60 active:bg-amber-100/60"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-[12.5px] font-semibold text-gray-900">{s.label}</span>
                          <span className="block text-[11px] text-gray-500">
                            {s.stageLabel}
                            {s.ageDays != null && <> · waiting {s.ageDays === 0 ? 'today' : `${s.ageDays}d`}</>}
                          </span>
                        </span>
                        <span className="flex-shrink-0 text-right">
                          <span className="block text-[12.5px] font-bold tabular-nums text-gray-900">{s.amountLabel}</span>
                        </span>
                        <ArrowRight className="h-4 w-4 flex-shrink-0 text-amber-600" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}

              {(pending.count > pending.sheets.length || pending.thumbruleCount > 0) && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {pending.count > pending.sheets.length && (
                    <Link href={pending.href} className="inline-flex items-center gap-1 min-h-[36px] px-3 rounded-lg bg-amber-600 text-white text-[12px] font-semibold">
                      See all {pending.count} <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  )}
                  {pending.thumbruleCount > 0 && (
                    <Link href={pending.thumbruleHref} className="inline-flex items-center min-h-[36px] px-3 rounded-lg border border-amber-300 bg-white text-[12px] font-semibold text-amber-800">
                      Bulk approve {pending.thumbruleCount} Thumbrule
                    </Link>
                  )}
                </div>
              )}
            </>
          )}

          {open === 'over' && over && (
            <>
              <p className="font-semibold text-rose-900">
                Spent or committed past what ERP released · {over.totalLabel} beyond
              </p>
              <ul className="mt-1.5 space-y-1">
                {over.lines.map(l => (
                  <li key={l.label} className="flex items-baseline justify-between gap-3 text-rose-900">
                    <span className="min-w-0">{l.label}</span>
                    <span className="flex-shrink-0 font-bold tabular-nums">{l.amountLabel}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11.5px] text-rose-700">
                Either the ERP budget needs topping up, or a WO was issued beyond it — check in IN4, then re-pull BPH.
                A work category can read a smaller &ldquo;net&rdquo; figure where its other sub-categories still have budget left.
              </p>
            </>
          )}

          {open === 'done' && completion && (
            <>
              {completion.readyCount > 0 && (
                <p className="font-semibold text-emerald-900">
                  {completion.readyCount} sub-{completion.readyCount === 1 ? 'category' : 'categories'} can be closed — WO and Paid match
                  {completion.readySavingsLabel && <span className="font-normal">, freeing {completion.readySavingsLabel}</span>}
                </p>
              )}
              {completion.completedCount > 0 && (
                <p className={`text-emerald-800 ${completion.readyCount > 0 ? 'mt-1' : 'font-semibold'}`}>
                  {completion.completedCount} already complete
                  {completion.releasedLabel && <> · {completion.releasedLabel} released</>}
                </p>
              )}
              {completion.readyCount > 0 && (
                <p className="mt-2 text-[11.5px] text-emerald-700">
                  Open a work category and look for the <b>Mark complete</b> button on those rows.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </section>
  )
}
