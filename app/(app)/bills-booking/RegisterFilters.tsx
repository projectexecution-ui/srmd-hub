'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Search, Download, Bookmark, X } from 'lucide-react'
import type { View } from '@/lib/bills-booking/register'

/** Search, filters, saved views, export — the register's controls.
 *
 *  Aksha, 16 Sep 2026, screen A: "Build it". None of this existed; at two
 *  hundred bills a month it is the whole screen.
 *
 *  Everything is in the URL, so a view can be bookmarked, sent to someone, and
 *  exported exactly as it is on screen — the Export link carries the same
 *  query. The four built-in views are just URLs. "Saved views" are the user's
 *  own names for URLs, kept in this browser (localStorage) — a convenience,
 *  not a record, so nothing about them has to live in the database. */
export interface FilterCounts { mine: number; late: number; arrived: number; sentBack: number }

const VIEWS: Array<{ key: View; label: string; count?: keyof FilterCounts }> = [
  { key: 'mine',      label: 'My desk',       count: 'mine' },
  { key: 'late',      label: 'Late anywhere', count: 'late' },
  { key: 'arrived',   label: 'Arrived from IN4', count: 'arrived' },
  { key: 'sent_back', label: 'Sent back',     count: 'sentBack' },
  { key: 'all',       label: 'Everything' },
]

type Saved = { name: string; qs: string }
const KEY = 'bb-saved-views'

export function RegisterFilters({ projects, counts, onDesk, closeHref }: {
  projects: Array<{ id: string; code: string }>
  counts: FilterCounts
  /** Whether "My desk" means anything for this person. */
  onDesk: boolean
  /** Where the panel's own close link goes — the same URL the header's icon
   *  toggles, so the two can never disagree about what "closed" means. */
  closeHref?: string
}) {
  const router = useRouter()
  const sp = useSearchParams()
  const view = (sp.get('view') as View | null) ?? (onDesk ? 'mine' : 'all')
  const [q, setQ] = useState(sp.get('q') ?? '')
  const [saved, setSaved] = useState<Saved[]>([])
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')

  useEffect(() => {
    try { setSaved(JSON.parse(localStorage.getItem(KEY) ?? '[]')) } catch { setSaved([]) }
  }, [])
  useEffect(() => { setQ(sp.get('q') ?? '') }, [sp])

  function withParams(mut: (p: URLSearchParams) => void): string {
    const p = new URLSearchParams(sp.toString())
    mut(p)
    const s = p.toString()
    return s ? `/bills-booking?${s}` : '/bills-booking'
  }
  const set = (k: string, v: string | null) => router.push(withParams(p => { if (v) p.set(k, v); else p.delete(k) }))

  function saveCurrent() {
    const n = name.trim()
    if (!n) return
    const next = [...saved.filter(s => s.name !== n), { name: n, qs: sp.toString() }]
    setSaved(next); setNaming(false); setName('')
    try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* private window; fine */ }
  }
  function forget(n: string) {
    const next = saved.filter(s => s.name !== n)
    setSaved(next)
    try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* fine */ }
  }

  const exportHref = `/bills-booking/export${sp.toString() ? `?${sp.toString()}` : ''}`
  const chip = (on: boolean) =>
    `inline-flex min-h-[32px] items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold ${
      on ? 'bg-indigo-600 text-white' : 'border border-gray-300 text-gray-700 hover:bg-gray-50'}`

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
      <form className="flex flex-wrap items-center gap-2" onSubmit={e => { e.preventDefault(); set('q', q.trim() || null) }}>
        <label className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search vendor, order, bill number…"
                 aria-label="Search bills"
                 className="h-10 w-full rounded-lg border border-gray-300 pl-8 pr-3 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
        </label>
        <select value={sp.get('project') ?? ''} onChange={e => set('project', e.target.value || null)}
                aria-label="Project" className="h-10 rounded-lg border border-gray-300 bg-white px-2.5 text-sm text-gray-700">
          <option value="">All projects</option>
          {projects.map(p => <option key={p.id} value={p.code}>{p.code}</option>)}
        </select>
        <select value={sp.get('type') ?? ''} onChange={e => set('type', e.target.value || null)}
                aria-label="Order type" className="h-10 rounded-lg border border-gray-300 bg-white px-2.5 text-sm text-gray-700">
          <option value="">WO + PO</option>
          <option value="WO">WO only</option>
          <option value="PO">PO only</option>
        </select>
        <label className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-gray-300 px-2.5 text-sm text-gray-700">
          <input type="checkbox" checked={sp.get('late') === '1'} onChange={e => set('late', e.target.checked ? '1' : null)} className="accent-indigo-600" />
          Late only
        </label>
        <button type="submit" className="h-10 rounded-lg bg-gray-900 px-3 text-sm font-semibold text-white">Search</button>
        <Link href={exportHref} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-gray-300 px-3 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              title="Download what is on screen as a spreadsheet">
          <Download className="h-4 w-4" /> Export
        </Link>
        {closeHref && (
          <Link href={closeHref} scroll={false} aria-label="Hide search and filters"
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700">
            <X className="h-4 w-4" />
          </Link>
        )}
      </form>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <span className="text-[12px] text-gray-500">Views:</span>
        {VIEWS.filter(v => v.key !== 'mine' || onDesk).map(v => (
          <Link key={v.key} href={withParams(p => { p.set('view', v.key) })} className={chip(view === v.key)}>
            {v.label}
            {v.count && counts[v.count] > 0 && (
              <span className={`rounded-full px-1.5 text-[10.5px] tabular-nums ${view === v.key ? 'bg-white/20' : 'bg-gray-100 text-gray-600'}`}>{counts[v.count]}</span>
            )}
          </Link>
        ))}
        {saved.map(s => (
          <span key={s.name} className="inline-flex items-center">
            <Link href={s.qs ? `/bills-booking?${s.qs}` : '/bills-booking'} className={chip(sp.toString() === s.qs)}>
              <Bookmark className="h-3 w-3" /> {s.name}
            </Link>
            <button type="button" onClick={() => forget(s.name)} aria-label={`Forget view ${s.name}`}
                    className="ml-0.5 rounded-full p-1 text-gray-400 hover:text-gray-700"><X className="h-3 w-3" /></button>
          </span>
        ))}
        {naming ? (
          <form className="inline-flex items-center gap-1" onSubmit={e => { e.preventDefault(); saveCurrent() }}>
            <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Name this view"
                   className="h-8 w-40 rounded-lg border border-gray-300 px-2 text-[12px]" />
            <button type="submit" className="h-8 rounded-lg bg-indigo-600 px-2.5 text-[12px] font-semibold text-white">Save</button>
            <button type="button" onClick={() => setNaming(false)} className="h-8 px-1.5 text-[12px] text-gray-500">Cancel</button>
          </form>
        ) : (
          <button type="button" onClick={() => setNaming(true)}
                  className="inline-flex min-h-[32px] items-center rounded-full border border-dashed border-gray-300 px-2.5 py-1 text-[12px] text-gray-500 hover:text-gray-800">
            + save current
          </button>
        )}
      </div>
    </div>
  )
}
