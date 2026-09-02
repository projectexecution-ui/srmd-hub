'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, Search, ExternalLink, Clock, Zap } from 'lucide-react'

export interface RoofRow {
  key: string
  label: string
  module: string
  /** The module's display name, resolved server-side via the label map so a
   *  renamed module reads the same here as everywhere else. */
  moduleLabel: string
  kind: 'instant' | 'scheduled'
  trigger: string
  schedule?: string
  channels: string[]
  channelsOn: string[]
  respectsRules: boolean
  enabled: boolean
  recipients: string[]
  who: string
  settingsHref: string
  warning?: string
}

const CH_LABEL: Record<string, string> = { in_app: 'In-app', email: 'Email', web_push: 'Phone' }

/**
 * Every message CT Hub sends, in one list, with who receives it.
 *
 * Deliberately read-only: each module keeps its own settings screen and this
 * deep-links to it. The thing that was missing was never an editor — it was a
 * single place to SEE what goes out, to whom, and what is quietly reaching
 * nobody. Search included, because 35 rows is past the point of scanning.
 */
export function RoofClient({ rows }: { rows: RoofRow[] }) {
  const [q, setQ] = useState('')
  const [only, setOnly] = useState<'all' | 'problems' | 'scheduled'>('all')

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return rows.filter(r => {
      if (only === 'problems' && !r.warning && r.respectsRules) return false
      if (only === 'scheduled' && r.kind !== 'scheduled') return false
      if (!needle) return true
      return (
        r.label.toLowerCase().includes(needle) ||
        r.trigger.toLowerCase().includes(needle) ||
        r.who.toLowerCase().includes(needle) ||
        r.module.toLowerCase().includes(needle) ||
        r.recipients.some(p => p.toLowerCase().includes(needle))
      )
    })
  }, [rows, q, only])

  const grouped = useMemo(() => {
    const m = new Map<string, RoofRow[]>()
    for (const r of filtered) {
      const arr = m.get(r.moduleLabel)
      if (arr) arr.push(r)
      else m.set(r.moduleLabel, [r])
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [filtered])

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-2">
        <label className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search by message, module or who receives it…"
            aria-label="Search messages"
            className="w-full rounded-lg border border-gray-300 bg-white pl-9 pr-3 py-2 text-sm min-h-[44px] focus:border-indigo-400 focus:outline-none"
          />
        </label>
        <div className="flex gap-1" role="group" aria-label="Filter">
          {([
            ['all', 'All'],
            ['problems', 'Needs attention'],
            ['scheduled', 'Scheduled only'],
          ] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setOnly(k)}
              aria-pressed={only === k}
              className={[
                'rounded-lg border px-3 text-xs font-semibold min-h-[44px] whitespace-nowrap',
                only === k
                  ? 'border-indigo-300 bg-indigo-50 text-indigo-800'
                  : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 && (
        <p className="text-sm text-gray-500 py-8 text-center">
          Nothing matches &ldquo;{q}&rdquo;.
        </p>
      )}

      {grouped.map(([moduleLabel, list]) => (
        <section key={moduleLabel}>
          <h2 className="text-sm font-bold text-gray-900 mb-2 flex items-baseline gap-2">
            {moduleLabel}
            <span className="text-[11px] font-normal text-gray-400 tabular-nums">{list.length}</span>
          </h2>

          <div className="space-y-2">
            {list.map(r => (
              <article
                key={r.key}
                className={[
                  'rounded-lg border bg-white p-3',
                  r.warning ? 'border-amber-300' : 'border-gray-200',
                ].join(' ')}
              >
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <h3 className="text-sm font-semibold text-gray-900">{r.label}</h3>

                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-gray-500">
                    {r.kind === 'scheduled'
                      ? <><Clock className="h-3 w-3" />{r.schedule}</>
                      : <><Zap className="h-3 w-3" />As it happens</>}
                  </span>

                  {!r.enabled && (
                    <span className="text-[10px] font-bold text-gray-500 bg-gray-100 rounded px-1.5 py-0.5">
                      SWITCHED OFF
                    </span>
                  )}

                  <Link
                    href={r.settingsHref}
                    className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-700 hover:underline min-h-[44px] sm:min-h-0"
                  >
                    Set up <ExternalLink className="h-3 w-3" />
                  </Link>
                </div>

                <p className="text-xs text-gray-500 mt-1">{r.trigger}</p>

                <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 text-[11px]">
                  <div className="min-w-0">
                    <dt className="text-gray-400">Goes to</dt>
                    <dd className="text-gray-800 font-medium">
                      {r.recipients.length > 0
                        ? r.recipients.join(' · ')
                        : <span className="text-amber-700">nobody</span>}
                    </dd>
                  </div>

                  <div>
                    <dt className="text-gray-400">Channels</dt>
                    <dd className="flex gap-1 mt-0.5">
                      {r.respectsRules
                        ? r.channels.map(c => (
                            <span
                              key={c}
                              className={[
                                'rounded px-1.5 py-0.5 font-semibold',
                                r.channelsOn.includes(c)
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : 'bg-gray-100 text-gray-400 line-through',
                              ].join(' ')}
                            >
                              {CH_LABEL[c] ?? c}
                            </span>
                          ))
                        : <span className="text-gray-500">Email, direct</span>}
                    </dd>
                  </div>
                </dl>

                {!r.respectsRules && (
                  <p className="mt-2 text-[11px] text-gray-600 bg-gray-50 border border-gray-200 rounded px-2 py-1.5">
                    Sends straight to its own address list — the switches on{' '}
                    <Link href="/admin/notifications" className="underline font-medium">Notifications</Link>{' '}
                    do not affect it.
                  </p>
                )}

                {r.warning && (
                  <p className="mt-2 text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 flex gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-px" />
                    {r.warning}
                  </p>
                )}
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
