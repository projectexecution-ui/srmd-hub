'use client'

// The search box on the Admin home — for anyone who already knows a screen's
// name and does not want to guess which door it is behind (A1). Filters the
// tabs this viewer may open; the list is handed in from the server so the
// gates are decided there.

import { useState } from 'react'
import Link from 'next/link'
import { Search, ArrowRight } from 'lucide-react'

export interface SearchItem { href: string; label: string; hint: string; door: string }

export function AdminSearch({ items }: { items: SearchItem[] }) {
  const [q, setQ] = useState('')
  const needle = q.trim().toLowerCase()
  const hits = needle
    ? items.filter(i => `${i.door} ${i.label} ${i.hint}`.toLowerCase().includes(needle)).slice(0, 10)
    : []
  return (
    <div className="relative">
      <label className="flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-3 min-h-[44px] focus-within:border-indigo-400">
        <Search className="h-4 w-4 text-gray-400 flex-shrink-0" />
        <input
          id="admin-search"
          type="search"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Find a setting — bills e-mail, roles, IN4, recycle bin…"
          className="w-full bg-transparent text-sm outline-none placeholder:text-gray-400"
          autoComplete="off"
        />
      </label>
      {needle && (
        <ul className="absolute left-0 right-0 z-20 mt-1 rounded-xl border border-gray-200 bg-white shadow-lg divide-y divide-gray-100 overflow-hidden">
          {hits.length === 0 && <li className="px-3.5 py-3 text-sm text-gray-500">Nothing called “{q.trim()}”. Try the word on the screen — “desk”, “digest”, “module”.</li>}
          {hits.map(h => (
            <li key={h.href}>
              <Link href={h.href} className="flex items-center gap-3 px-3.5 py-2.5 min-h-[44px] hover:bg-gray-50">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-gray-900">{h.label} <span className="text-gray-400 font-normal">· {h.door}</span></span>
                  <span className="block text-xs text-gray-500 truncate">{h.hint}</span>
                </span>
                <ArrowRight className="h-4 w-4 text-gray-300 flex-shrink-0" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
