'use client'

import { useMemo, useState } from 'react'
import { Check, Search, X } from 'lucide-react'
import { Marked } from './PartyPicker'

export interface OwnerPerson {
  id: string
  name: string
  role: string
  /** The role as this hub labels it ("site eng", "ATM HEAD"). */
  roleLabel: string
  /** The bill desks this person sits on ("CT Disc Head — Civil"), so the card
   *  says what they actually do rather than only the role. */
  desks: string[]
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

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

/** Who will process the bill — the Site Head.
 *
 *  Aksha, 10 Oct 2026: "if i have assigned many people for other Designation
 *  why is their name coming and it is looking very basic". So: the seat set
 *  for this building or project comes first and is pre-selected; then the
 *  people whose role is site engineer, site head or project head; everyone
 *  else only on "Show everyone". Anonymous accounts never. One tap picks.
 *
 *  Aksha, 13 Oct 2026: "the name picker should be advanced havin search
 *  features". So the search box is always there and searches EVERYONE — by
 *  name, role or desk ("mep", "disc head") — arrow keys and Enter pick, and
 *  each card names the desks the person sits on. */
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
  const [hi, setHi] = useState(0)

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

  const words = norm(q).split(' ').filter(Boolean)
  const searching = words.length > 0
  const shown = sorted.filter(p => {
    // Typing searches everybody — the "site people" fold is only for browsing.
    if (searching) {
      const hay = norm([p.name, p.roleLabel, ...p.desks].join(' | '))
      return words.every(w => hay.includes(w))
    }
    return all || suggested.has(p.id) || SITE_ROLES.has(p.role) || p.id === value
  })
  const hidden = sorted.length - sorted.filter(p => suggested.has(p.id) || SITE_ROLES.has(p.role) || p.id === value).length
  const at = Math.min(hi, Math.max(shown.length - 1, 0))

  return (
    <div>
      <label className="mb-2 flex h-11 items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-500/20">
        <Search className="h-4 w-4 shrink-0 text-gray-400" />
        <input value={q} aria-label="Find a person" placeholder={`Name, role or desk — ${people.length} people in CT Hub`}
               onChange={e => { setQ(e.target.value); setHi(0) }}
               onKeyDown={e => {
                 if (e.key === 'ArrowDown') { e.preventDefault(); setHi(Math.min(at + 1, shown.length - 1)) }
                 else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(Math.max(at - 1, 0)) }
                 else if (e.key === 'Enter' && shown[at]) { e.preventDefault(); onChange(shown[at].id); setQ('') }
                 else if (e.key === 'Escape') setQ('')
               }}
               className="w-full bg-transparent text-sm outline-none" />
        {q && (
          <button type="button" onClick={() => setQ('')} aria-label="Clear the search"
                  className="flex h-8 w-8 items-center justify-center rounded text-gray-400 hover:text-gray-700">
            <X className="h-4 w-4" />
          </button>
        )}
      </label>
      {searching && (
        <p className="mb-1.5 text-[11.5px] text-gray-500">
          Showing {shown.length} of {people.length} people · ↑ ↓ to move, Enter to pick
        </p>
      )}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {shown.map((p, i) => {
          const on = p.id === value
          const star = suggested.has(p.id)
          const lit = searching && i === at
          return (
            <button key={p.id} type="button" onClick={() => { onChange(p.id); setQ('') }} aria-pressed={on}
                    onMouseEnter={() => searching && setHi(i)}
                    className={`flex min-h-[52px] items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors ${
                      on ? 'border-indigo-600 bg-indigo-50 ring-2 ring-indigo-500/20'
                        : lit ? 'border-indigo-300 bg-indigo-50/60'
                          : 'border-gray-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/40'}`}>
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-bold ${
                on ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700'}`}>{initials(p.name)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-gray-900"><Marked text={p.name} q={q} /></span>
                <span className="block text-[11px] leading-snug text-gray-500">
                  {star && <span className="font-semibold text-indigo-700">Site Head here · </span>}
                  <Marked text={[p.roleLabel, ...p.desks].join(' · ')} q={q} />
                </span>
              </span>
              {on && <Check className="h-4 w-4 shrink-0 text-indigo-600" />}
            </button>
          )
        })}
        {shown.length === 0 && (
          <p className="text-sm text-gray-500 sm:col-span-2">Nobody in CT Hub matches “{q.trim()}”.</p>
        )}
      </div>
      {!searching && hidden > 0 && (
        <button type="button" onClick={() => setAll(v => !v)}
                className="mt-2 text-[12px] font-semibold text-indigo-700 hover:underline min-h-[32px]">
          {all ? 'Show only site people' : `Show everyone (${hidden} more)`}
        </button>
      )}
    </div>
  )
}
