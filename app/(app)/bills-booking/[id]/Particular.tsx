'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { shortenBoq } from '@/lib/bills-booking/shorten'

/** A BOQ particular, short by default and expandable.
 *
 *  Aksha, 14 Sep 2026: "the Abstract rows carry Huge BOQ content - can u make
 *  it shorter and when required i want to expand - so its easy for review".
 *
 *  The shortening is rules, not a model — see lib/bills-booking/shorten.ts for
 *  why and for the three rules. Everything the rules removed is one click
 *  away, and a row that hides nothing shows no control at all, so the chevron
 *  always means there is genuinely more to read.
 *
 *  The section path IN4 prefixes ("E) SITC OF INTERNAL WIRING") becomes a grey
 *  chip rather than 30 characters of noise in front of every item. */
export function Particular({ text, expandAll }: { text: string; expandAll?: boolean }) {
  const [open, setOpen] = useState(false)
  const s = shortenBoq(text)
  const showing = open || expandAll

  if (!s.shortened) {
    return <span className="text-[13px]">{s.short}</span>
  }

  return (
    <button
      type="button"
      onClick={() => setOpen(o => !o)}
      aria-expanded={showing}
      title={showing ? 'Hide the rest' : 'Show the full BOQ text'}
      className="group block w-full text-left"
    >
      {s.section && (
        <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-gray-400">
          {s.section}
        </span>
      )}
      <span className="text-[13px] text-gray-900">
        {showing ? s.full : s.short}
        {!showing && <span className="text-gray-400">…</span>}
        <ChevronDown
          className={`ml-1 inline h-3 w-3 shrink-0 text-gray-300 transition-transform group-hover:text-indigo-600 ${showing ? 'rotate-180' : ''}`}
        />
      </span>
    </button>
  )
}

/** The one control that opens every row at once — for a proper read-through
 *  rather than a row-by-row hunt. */
export function ExpandAll({ on, onToggle, n }: { on: boolean; onToggle: () => void; n: number }) {
  if (n === 0) return null
  return (
    <button
      type="button"
      onClick={onToggle}
      className="inline-flex min-h-[32px] items-center gap-1 text-[11px] font-semibold text-indigo-700 hover:text-indigo-900"
    >
      <ChevronDown className={`h-3.5 w-3.5 transition-transform ${on ? 'rotate-180' : ''}`} />
      {on ? 'Shorten all' : `Show full text (${n})`}
    </button>
  )
}
