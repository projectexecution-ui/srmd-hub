import type { ReactNode } from 'react'

/** The phone rendering of every table in this section.
 *
 *  Seven of the eight tables here were browser-only — In flight alone is nine
 *  columns and about 1,100px wide, with the Sanction button, the one action on
 *  the page, off the right edge. The house rule is that every screen ships for
 *  phone and browser, and a change that lands on one is not finished.
 *
 *  One primitive rather than seven hand-built card blocks, so a column added to
 *  a table and forgotten on the phone is a smaller class of mistake: the pages
 *  pass the same row objects to both.
 */

export function CardList({ children }: { children: ReactNode }) {
  return <div className="space-y-2.5 md:hidden">{children}</div>
}

export interface CardFact {
  k: string
  v: ReactNode
  /** Pull the eye without repainting the whole card. */
  tone?: 'bad' | 'warn' | 'good'
}

const TONE: Record<string, string> = {
  bad: 'text-red-600 font-semibold',
  warn: 'text-amber-700 font-medium',
  good: 'text-emerald-700 font-medium',
}

export function Card({ title, sub, amount, amountLabel, facts = [], action, flagged, note }: {
  /** Usually the number a person reads — an ENP, a WO, a bill no. */
  title: ReactNode
  sub?: ReactNode
  /** The one figure the row is about, kept top-right where the eye lands. */
  amount?: string
  amountLabel?: string
  facts?: CardFact[]
  action?: ReactNode
  flagged?: boolean
  note?: ReactNode
}) {
  return (
    <div className={`rounded-xl border bg-white p-3.5 ${flagged ? 'border-red-200 bg-red-50/40' : 'border-gray-200'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-gray-900">{title}</div>
          {sub && <div className="mt-0.5 truncate text-xs text-gray-500">{sub}</div>}
        </div>
        {amount && (
          <div className="shrink-0 text-right">
            <div className="text-sm font-semibold tabular-nums text-gray-900">{amount}</div>
            {amountLabel && <div className="text-[10.5px] text-gray-400">{amountLabel}</div>}
          </div>
        )}
      </div>

      {facts.length > 0 && (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          {facts.map(f => (
            <div key={f.k}>
              <dt className="text-gray-500">{f.k}</dt>
              <dd className={`tabular-nums ${f.tone ? TONE[f.tone] : 'text-gray-800'}`}>{f.v}</dd>
            </div>
          ))}
        </dl>
      )}

      {note && <p className="mt-2 text-[11px] text-gray-500">{note}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

/** The figure under a list on a phone, so the total is never only in a table
 *  footer somebody has to scroll sideways to reach. */
export function CardTotal({ n, label, amount }: { n: number; label: string; amount?: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm font-semibold">
      <span>{n} {label}</span>
      {amount && <span className="tabular-nums">{amount}</span>}
    </div>
  )
}
