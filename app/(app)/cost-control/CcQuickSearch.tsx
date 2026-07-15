'use client'
// Quick-jump search on the Cost Control dashboard — type a project code or
// name, pick a match, go straight there. Client-side over the already-loaded
// project list (no extra round trip).

import { useState, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Search, ArrowRight } from 'lucide-react'

type Proj = { id: string; code: string; name: string; group?: string | null }

export function CcQuickSearch({ projects }: { projects: Proj[] }) {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)

  const matches = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return []
    return projects
      .filter(p => p.code.toLowerCase().includes(s) || p.name.toLowerCase().includes(s) || (p.group ?? '').toLowerCase().includes(s))
      .slice(0, 8)
  }, [q, projects])

  function go(p: Proj) {
    setOpen(false); setQ('')
    router.push(`/cost-control/projects/${p.id}`)
  }

  return (
    <div ref={wrapRef} className="relative" onBlur={e => { if (!wrapRef.current?.contains(e.relatedTarget as Node)) setOpen(false) }}>
      <div className="flex items-center gap-1.5 h-9 px-2.5 rounded-md border border-gray-300 bg-white">
        <Search className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
        <input
          value={q}
          onChange={e => { setQ(e.target.value); setOpen(true); setActive(0) }}
          onFocus={() => q && setOpen(true)}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, matches.length - 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
            else if (e.key === 'Enter' && matches[active]) { e.preventDefault(); go(matches[active]) }
            else if (e.key === 'Escape') setOpen(false)
          }}
          placeholder="Find a project…"
          className="w-40 md:w-48 text-sm bg-transparent outline-none placeholder:text-gray-400"
        />
      </div>
      {open && matches.length > 0 && (
        <div className="absolute right-0 z-30 mt-1 w-72 max-h-80 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
          {matches.map((p, i) => (
            <button
              key={p.id}
              type="button"
              onMouseEnter={() => setActive(i)}
              onClick={() => go(p)}
              className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left ${i === active ? 'bg-indigo-50' : 'hover:bg-gray-50'}`}
            >
              <span className="min-w-0">
                <span className="font-mono text-[11px] font-bold text-indigo-700 mr-2">{p.code}</span>
                <span className="text-sm text-gray-900">{p.name}</span>
              </span>
              <ArrowRight className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
