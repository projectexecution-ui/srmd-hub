'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Search, ChevronRight, CircleDot, Check } from 'lucide-react'

export interface BrowserScreen {
  href: string
  label: string
  hint: string
  moduleLabel: string
  area: string
  areaLabel: string
  /** Job names that touch this screen, so a searched-for screen still says
   *  what it is FOR rather than only what it is called. */
  jobs: string[]
}

export interface BrowserTask {
  id: string
  label: string
  hint: string
  anyOrder?: boolean
  steps: Array<{ href: string; why: string; optional?: boolean; label: string; moduleLabel: string }>
}

/**
 * Admin, organised by the job rather than by where the code lives.
 *
 * Three layers, in the order a person needs them:
 *   1. what is wrong right now      (rendered by the server, above this)
 *   2. what you probably came to do (the jobs — each one an ordered checklist)
 *   3. every screen, searchable     (for when you already know the name)
 *
 * The A–Z list is deliberately last and collapsed. It is the old Admin, kept
 * because someone who knows the screen they want should not have to guess which
 * job owns it — but it is no longer the first thing you meet.
 */
export function AdminBrowser({ tasks, screens }: { tasks: BrowserTask[]; screens: BrowserScreen[] }) {
  const [open, setOpen] = useState<string | null>(null)
  const [q, setQ] = useState('')

  const needle = q.trim().toLowerCase()
  const results = useMemo(() => {
    if (!needle) return []
    return screens.filter(s =>
      s.label.toLowerCase().includes(needle) ||
      s.hint.toLowerCase().includes(needle) ||
      s.moduleLabel.toLowerCase().includes(needle) ||
      s.areaLabel.toLowerCase().includes(needle) ||
      s.jobs.some(j => j.toLowerCase().includes(needle)),
    )
  }, [screens, needle])

  const byArea = useMemo(() => {
    const m = new Map<string, BrowserScreen[]>()
    for (const s of screens) {
      const arr = m.get(s.areaLabel)
      if (arr) arr.push(s)
      else m.set(s.areaLabel, [s])
    }
    return [...m.entries()]
  }, [screens])

  return (
    <div className="space-y-5">
      {/* Search first — it short-circuits everything below when you know the name. */}
      <label className="relative block">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search all settings — by name, module or job…"
          aria-label="Search settings screens"
          className="w-full rounded-lg border border-gray-300 bg-white pl-9 pr-3 py-2 text-sm min-h-[44px] focus:border-indigo-400 focus:outline-none"
        />
      </label>

      {needle && (
        <section aria-label="Search results">
          <h2 className="text-sm font-bold text-gray-900 mb-2">
            {results.length} match{results.length === 1 ? '' : 'es'}
          </h2>
          {results.length === 0 && (
            <p className="text-sm text-gray-500 py-6 text-center">
              Nothing matches &ldquo;{q}&rdquo;.
            </p>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            {results.map(s => <ScreenCard key={s.href} s={s} />)}
          </div>
        </section>
      )}

      {!needle && (
        <>
          <section>
            <h2 className="text-sm font-bold text-gray-900 mb-1">What do you want to do?</h2>
            <p className="text-xs text-gray-500 mb-2.5">
              Each job lists every screen it touches, in order. Most of them cross three or four
              modules, which is why they were hard to find one by one.
            </p>

            <div className="space-y-2">
              {tasks.map(t => {
                const isOpen = open === t.id
                const required = t.steps.filter(s => !s.optional).length
                return (
                  <div key={t.id} className="rounded-lg border border-gray-200 bg-white overflow-hidden">
                    <button
                      onClick={() => setOpen(isOpen ? null : t.id)}
                      aria-expanded={isOpen}
                      className="w-full text-left px-3 py-3 min-h-[44px] flex items-start gap-2 hover:bg-gray-50"
                    >
                      <ChevronRight
                        className={`h-4 w-4 text-gray-400 flex-shrink-0 mt-0.5 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-gray-900">{t.label}</span>
                        <span className="block text-xs text-gray-500 mt-0.5">{t.hint}</span>
                      </span>
                      <span className="text-[11px] text-gray-400 tabular-nums flex-shrink-0 whitespace-nowrap">
                        {t.steps.length} step{t.steps.length === 1 ? '' : 's'}
                      </span>
                    </button>

                    {isOpen && (
                      <ol className="border-t border-gray-100 divide-y divide-gray-100">
                        {t.steps.map((step, i) => (
                          <li key={step.href}>
                            <Link
                              href={step.href}
                              className="flex items-start gap-3 px-3 py-2.5 min-h-[44px] hover:bg-indigo-50/40"
                            >
                              <span
                                className="mt-0.5 flex-shrink-0 h-5 w-5 rounded-full bg-gray-100 text-[10px] font-bold text-gray-600 flex items-center justify-center tabular-nums"
                                aria-hidden
                              >
                                {t.anyOrder ? '·' : i + 1}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="text-sm text-gray-900 font-medium">{step.label}</span>
                                {step.optional && (
                                  <span className="ml-1.5 text-[10px] font-semibold text-gray-400">
                                    IF NEEDED
                                  </span>
                                )}
                                <span className="block text-xs text-gray-500">{step.why}</span>
                              </span>
                              {step.moduleLabel && (
                                <span className="text-[10px] text-gray-400 flex-shrink-0 hidden sm:block">
                                  {step.moduleLabel}
                                </span>
                              )}
                            </Link>
                          </li>
                        ))}
                      </ol>
                    )}

                    {isOpen && (
                      <p className="px-3 py-2 bg-gray-50 border-t border-gray-100 text-[11px] text-gray-500 flex items-center gap-1.5">
                        {t.anyOrder
                          ? <><CircleDot className="h-3 w-3" /> Any order — these do not depend on each other.</>
                          : <><Check className="h-3 w-3" /> {required} needed, the rest only if they apply.</>}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          </section>

          <details className="rounded-lg border border-gray-200 bg-white">
            <summary className="px-3 py-3 min-h-[44px] cursor-pointer text-sm font-semibold text-gray-900 flex items-center gap-2">
              Every screen, A–Z
              <span className="text-[11px] font-normal text-gray-400 tabular-nums">{screens.length}</span>
            </summary>
            <div className="px-3 pb-3 space-y-4 border-t border-gray-100 pt-3">
              {byArea.map(([areaLabel, list]) => (
                <section key={areaLabel}>
                  <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">
                    {areaLabel}
                  </h3>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {list.map(s => <ScreenCard key={s.href} s={s} />)}
                  </div>
                </section>
              ))}
            </div>
          </details>
        </>
      )}
    </div>
  )
}

function ScreenCard({ s }: { s: BrowserScreen }) {
  return (
    <Link
      href={s.href}
      className="rounded-lg border border-gray-200 bg-white p-3 hover:border-indigo-300 hover:bg-indigo-50/20 min-h-[44px] block"
    >
      <p className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-gray-900">{s.label}</span>
        {s.moduleLabel && (
          <span className="text-[10px] text-gray-400 flex-shrink-0">{s.moduleLabel}</span>
        )}
      </p>
      <p className="text-xs text-gray-500 mt-0.5">{s.hint}</p>
      {s.jobs.length > 0 && (
        <p className="text-[10px] text-gray-400 mt-1">Used for: {s.jobs.join(' · ')}</p>
      )}
    </Link>
  )
}
