// "My Work" — the engineer side of the My Day home. The cross-module
// "Needs you now" list only covers things waiting on you to APPROVE; an
// engineer's own drafts-to-send and returned-to-fix don't appear there. This
// strip surfaces those as one-tap shortcuts. Renders nothing when the person
// has no such work, so it never adds noise for pure approvers.
//
// Sync component — data is fetched in the page and passed in (same pattern as
// NeedsYouNow), so it never blocks or breaks the home render.

import Link from 'next/link'

export interface CcWorkCounts {
  returned: number
  drafts: number
  awaiting: number
}

export function CostControlSnapshot({ counts }: { counts: CcWorkCounts }) {
  const { returned, drafts, awaiting } = counts
  if (returned + drafts + awaiting === 0) return null

  const tiles = [
    { show: returned > 0, n: returned, label: 'Returned to fix', tone: 'rose',
      href: '/cost-control/working-sheets?status=returned', cta: 'Fix & resend →' },
    { show: drafts > 0, n: drafts, label: drafts === 1 ? 'Draft to send' : 'Drafts to send', tone: 'amber',
      href: '/cost-control/working-sheets?status=draft', cta: 'Send for approval →' },
    { show: awaiting > 0, n: awaiting, label: 'Awaiting approval', tone: 'blue',
      href: '/cost-control/working-sheets', cta: 'Track →' },
  ].filter(t => t.show)

  const toneCls: Record<string, { stripe: string; n: string; cta: string }> = {
    rose:  { stripe: 'bg-rose-500',  n: 'text-rose-700',  cta: 'text-rose-700' },
    amber: { stripe: 'bg-amber-500', n: 'text-amber-700', cta: 'text-amber-700' },
    blue:  { stripe: 'bg-blue-500',  n: 'text-blue-700',  cta: 'text-blue-700' },
  }

  return (
    <section>
      <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500 mb-3">Your budget work</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {tiles.map(t => {
          const c = toneCls[t.tone]
          return (
            <Link key={t.label} href={t.href}
              className="relative overflow-hidden bg-white border border-gray-200 rounded-2xl p-4 hover:shadow-md hover:-translate-y-0.5 transition-all">
              <span className={`absolute left-0 top-0 bottom-0 w-1 ${c.stripe}`} />
              <div className={`text-3xl font-extrabold tabular-nums ${c.n}`}>{t.n}</div>
              <div className="text-sm text-gray-600 mt-0.5">{t.label}</div>
              <div className={`text-xs font-semibold mt-2 ${c.cta}`}>{t.cta}</div>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
