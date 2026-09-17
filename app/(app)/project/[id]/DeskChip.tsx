'use client'
// "7 on your desk · 1 in IN4" — one chip in the project header.
//
// Aksha, 17 Sep 2026 (option B): the counts already exist, but they are
// scattered across thirteen tabs as 15px badges, so finding out whether a
// project wants anything from you means scanning the whole ribbon. This totals
// them in one place and, on hover or tap, names which tab each number is on.
//
// It also answers the question he asked first — "i need some hovering info on
// the Numbers ... as there are 2 platform Notifications". The two colours are
// two different systems and nothing on screen ever said so:
//
//   AMBER  CT Hub. On your desk. You can act now.
//   TEAL   IN4. Parked at Verify over there. Not your click — and IN4 has no
//          per-record link, so this never pretends to be a task you can open.
//
// Counts arrive as props from the layout, which already loads both for the
// ribbon's badges. No query of its own.

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

export interface DeskLine {
  /** Tab slug, for the link. '' is Budget, the cockpit index. */
  slug: string
  label: string
  n: number
  /** 'mine' → amber, CT Hub. 'in4' → teal, parked at Verify. */
  where: 'mine' | 'in4'
  /** The sentence the ribbon badge already uses, reused verbatim. */
  note?: string
}

export function DeskChip({ projectId, lines }: { projectId: string; lines: DeskLine[] }) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)

  // Tap opens it on a phone, where there is no hover; outside-click and Escape
  // close it. Hover alone would make this desktop-only.
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false)
    }
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onEsc)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onEsc) }
  }, [open])

  const mine = lines.filter(l => l.where === 'mine').reduce((s, l) => s + l.n, 0)
  const in4 = lines.filter(l => l.where === 'in4').reduce((s, l) => s + l.n, 0)
  if (mine === 0 && in4 === 0) return null

  return (
    <div ref={wrap} className="relative flex-shrink-0 group">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className={cn(
          'inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[12px] font-semibold min-h-[28px]',
          mine > 0
            ? 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
            : 'border-teal-300 bg-teal-50 text-teal-800 hover:bg-teal-100',
        )}
      >
        {mine > 0 && <span>{mine} on your desk</span>}
        {in4 > 0 && (
          <span className={cn(
            'inline-flex items-center rounded-full border border-teal-300 bg-teal-100 text-teal-800 px-1.5 text-[11px]',
            mine === 0 && 'border-0 bg-transparent px-0',
          )}>
            {in4} in IN4
          </span>
        )}
      </button>

      {/* Hover on a pointer, tap anywhere. `group-hover` alone would never open
          on a phone, and `open` alone would need a tap on a desktop. */}
      <div
        className={cn(
          'absolute left-0 top-[calc(100%+6px)] z-30 w-[280px] rounded-xl border border-gray-200 bg-white p-2.5 shadow-xl',
          'transition-opacity',
          open ? 'opacity-100' : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto',
        )}
      >
        {lines.filter(l => l.n > 0).map(l => (
          <Link
            key={l.slug || 'budget'}
            href={l.slug ? `/project/${projectId}/${l.slug}` : `/project/${projectId}`}
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 rounded-lg px-1.5 py-1.5 text-[12.5px] text-gray-700 hover:bg-gray-50 min-h-[32px]"
          >
            <span className={cn('h-2 w-2 rounded-full flex-shrink-0', l.where === 'mine' ? 'bg-amber-500' : 'bg-teal-500')} />
            <span className="font-medium text-gray-900">{l.label}</span>
            {l.note && <span className="text-gray-400 truncate">· {l.note}</span>}
            <span className="ml-auto font-bold tabular-nums">{l.n}</span>
          </Link>
        ))}
        <p className="mt-1.5 border-t border-gray-100 pt-1.5 px-1.5 text-[11px] text-gray-500">
          <b className="text-amber-700">Amber</b> is yours to act on in CT Hub.
          <b className="text-teal-700"> Teal</b> is waiting at Verify in IN4 — not your click.
        </p>
      </div>
    </div>
  )
}
