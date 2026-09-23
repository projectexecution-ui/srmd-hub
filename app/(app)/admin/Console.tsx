'use client'
// The Admin console's chrome: the Today ribbon (folded to one line, opens on
// tap — P2) and the rail of doors with a count and a status dot each (P1).
// Aksha, 23 Sep 2026: direction B · Console. On a phone the rail is a row of
// chips under the ribbon.

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Users, Building2, Mail, Database, Settings2, ArrowRight, ChevronDown, ChevronRight } from 'lucide-react'
import type { DoorId } from '@/lib/admin/doors'
import type { TodayRow } from '@/lib/admin/today'
import type { RailBadge, FoldedToday } from '@/lib/admin/rail'

export interface RailDoor { id: DoorId; href: string; label: string; badge: RailBadge }

const ICON: Record<DoorId, React.ComponentType<{ className?: string }>> = {
  people: Users, projects: Building2, messages: Mail, data: Database, hub: Settings2,
}
const DOT: Record<RailBadge['tone'], string> = {
  none: 'bg-gray-300', ok: 'bg-emerald-500', warn: 'bg-amber-500', bad: 'bg-rose-500',
}
const BADGE: Record<RailBadge['tone'], string> = {
  none: 'text-gray-500', ok: 'text-emerald-700', warn: 'text-amber-800 font-semibold', bad: 'text-rose-700 font-semibold',
}

export function Rail({ doors }: { doors: RailDoor[] }) {
  const pathname = usePathname()
  const active = (d: RailDoor) => pathname === d.href || pathname.startsWith(d.href + '/')
  return (
    <nav aria-label="Admin doors" className="lg:sticky lg:top-6 lg:self-start">
      {/* Phone / tablet: chips in a row. Desktop: the rail. */}
      <ul className="flex lg:flex-col gap-1.5 lg:gap-1 overflow-x-auto lg:overflow-visible -mx-1 px-1 pb-1 lg:pb-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {doors.map(d => {
          const Icon = ICON[d.id]
          const on = active(d)
          return (
            <li key={d.id} className="flex-shrink-0">
              <Link
                href={d.href}
                aria-current={on ? 'page' : undefined}
                className={`flex items-center gap-2.5 rounded-xl border px-3 min-h-[44px] lg:min-h-[52px] lg:w-[220px] text-[13px] ${
                  on ? 'bg-indigo-50 border-indigo-200 text-indigo-900' : 'bg-white border-gray-200 text-gray-800 hover:bg-gray-50'
                }`}
              >
                <Icon className={`h-4 w-4 flex-shrink-0 ${on ? 'text-indigo-700' : 'text-gray-500'}`} />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold leading-tight">{d.label}</span>
                  <span className={`hidden lg:flex items-center gap-1.5 text-[11.5px] leading-tight ${BADGE[d.badge.tone]}`}>
                    <i className={`inline-block h-2 w-2 rounded-full ${DOT[d.badge.tone]}`} aria-hidden />{d.badge.text}
                  </span>
                </span>
                {/* Phone: the dot alone says whether anything is wrong. */}
                <i className={`lg:hidden inline-block h-2 w-2 rounded-full flex-shrink-0 ${DOT[d.badge.tone]}`} aria-label={d.badge.text} title={d.badge.text} />
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

export function TodayRibbon({ rows, folded }: { rows: TodayRow[]; folded: FoldedToday }) {
  const [open, setOpen] = useState(false)
  const rail = folded.tone === 'bad' ? 'border-rose-500 bg-rose-50' : folded.tone === 'warn' ? 'border-amber-500 bg-amber-50' : folded.tone === 'ok' ? 'border-emerald-500 bg-emerald-50' : 'border-gray-300 bg-gray-50'
  const ink = folded.tone === 'bad' ? 'text-rose-950' : folded.tone === 'warn' ? 'text-amber-950' : folded.tone === 'ok' ? 'text-emerald-900' : 'text-gray-800'
  if (rows.length === 0) {
    return <p className={`rounded-r-xl border-l-4 px-4 py-2.5 text-sm ${rail} ${ink}`}>{folded.line} Every feed ran, every job is recorded, nobody is waiting for access.</p>
  }
  return (
    <section aria-label="Today" className={`rounded-r-xl border-l-4 ${rail}`}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className={`flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm min-h-[44px] ${ink}`}
      >
        {open ? <ChevronDown className="h-4 w-4 flex-shrink-0 opacity-70" /> : <ChevronRight className="h-4 w-4 flex-shrink-0 opacity-70" />}
        <span className="min-w-0 flex-1 truncate">{folded.line}</span>
        <span className="text-[12px] opacity-70 whitespace-nowrap">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <ul className="border-t border-black/5 divide-y divide-black/5">
          {rows.map(r => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2">
              <p className={`text-sm min-w-0 flex-1 ${r.tone === 'bad' ? 'text-rose-950' : r.tone === 'warn' ? 'text-amber-950' : 'text-gray-700'}`}>{r.text}</p>
              <Link href={r.href} className={`inline-flex items-center gap-1 rounded-lg border bg-white px-3 py-1.5 text-[13px] font-semibold min-h-[36px] hover:bg-gray-50 ${r.tone === 'bad' ? 'border-rose-300 text-rose-900' : r.tone === 'warn' ? 'border-amber-300 text-amber-900' : 'border-gray-300 text-gray-800'}`}>
                {r.action} <ArrowRight className="h-3 w-3" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
