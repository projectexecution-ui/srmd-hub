'use client'

import { useMemo, useState } from 'react'
import { Check, Search } from 'lucide-react'

export interface OwnerPerson {
  id: string
  name: string
  role: string
  /** The role as this hub labels it ("site eng", "ATM HEAD"). */
  roleLabel: string
}

/** A Site Head seat on the desks screen: who, for which building or project. */
export interface SiteHeadSeat {
  userId: string
  projectId: string | null
  subprojectId: number | null
}

/** Roles that do the Site Head's work. Everyone else is behind "Show everyone". */
const SITE_ROLES = new Set(['engineer', 'site_staff', 'project_head'])

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '?'

/** Who will process the bill — the Site Head.
 *
 *  Aksha, 10 Oct 2026: "if i have assigned many people for other Designation
 *  why is their name coming and it is looking very basic". So: the seat set
 *  for this building or project comes first and is pre-selected; then the
 *  people whose role is site engineer, site head or project head; everyone
 *  else only on "Show everyone". Anonymous accounts never. One tap picks. */
export function OwnerPicker({ people, seats, projectId, subprojectId, value, onChange }: {
  people: OwnerPerson[]
  seats: SiteHeadSeat[]
  projectId: string | null
  subprojectId: number | null
  value: string
  onChange: (id: string) => void
}) {
  const [all, setAll] = useState(false)
  const [q, setQ] = useState('')

  // The desk's own seat wins: this building, then this project, then the
  // hub-wide default row.
  const suggested = useMemo(() => {
    const bySub = subprojectId != null ? seats.filter(s => s.subprojectId === subprojectId) : []
    const byProj = projectId ? seats.filter(s => s.subprojectId == null && s.projectId === projectId) : []
    const global = seats.filter(s => s.subprojectId == null && s.projectId == null)
    const pick = bySub.length ? bySub : byProj.length ? byProj : global
    return new Set(pick.map(s => s.userId))
  }, [seats, projectId, subprojectId])

  const sorted = useMemo(() => {
    const rank = (p: OwnerPerson) => (suggested.has(p.id) ? 0 : SITE_ROLES.has(p.role) ? 1 : 2)
    return [...people].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
  }, [people, suggested])

  const shown = sorted.filter(p => {
    if (!all && !suggested.has(p.id) && !SITE_ROLES.has(p.role) && p.id !== value) return false
    if (q.trim() && !p.name.toLowerCase().includes(q.trim().toLowerCase())) return false
    return true
  })
  const hidden = sorted.length - sorted.filter(p => suggested.has(p.id) || SITE_ROLES.has(p.role) || p.id === value).length

  return (
    <div>
      {sorted.length > 8 && (
        <label className="mb-2 flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 h-10">
          <Search className="h-4 w-4 text-gray-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Type a name" aria-label="Find a person"
                 className="w-full bg-transparent text-sm outline-none" />
        </label>
      )}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {shown.map(p => {
          const on = p.id === value
          const star = suggested.has(p.id)
          return (
            <button key={p.id} type="button" onClick={() => onChange(p.id)} aria-pressed={on}
                    className={`flex min-h-[52px] items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors ${
                      on ? 'border-indigo-600 bg-indigo-50 ring-2 ring-indigo-500/20' : 'border-gray-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/40'}`}>
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-bold ${
                on ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700'}`}>{initials(p.name)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-gray-900">{p.name}</span>
                <span className="block truncate text-[11px] text-gray-500">
                  {star ? <span className="font-semibold text-indigo-700">Site Head here</span> : p.roleLabel}
                </span>
              </span>
              {on && <Check className="h-4 w-4 shrink-0 text-indigo-600" />}
            </button>
          )
        })}
        {shown.length === 0 && (
          <p className="text-sm text-gray-500 sm:col-span-2">Nobody matches. {!all && hidden > 0 ? 'Try "Show everyone".' : ''}</p>
        )}
      </div>
      {hidden > 0 && (
        <button type="button" onClick={() => setAll(v => !v)}
                className="mt-2 text-[12px] font-semibold text-indigo-700 hover:underline min-h-[32px]">
          {all ? 'Show only site people' : `Show everyone (${hidden} more)`}
        </button>
      )}
    </div>
  )
}
