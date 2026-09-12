// Small shared pieces for the three Site Register tabs. Plain functions with
// no hooks, so the same component renders on the server tab and inside the
// client screens — one definition of what a status looks like.

import type { Tone } from '@/lib/site-register/types'

const TONES: Record<Tone, string> = {
  amber: 'bg-amber-50 text-amber-800 border-amber-200',
  sky: 'bg-sky-50 text-sky-800 border-sky-200',
  violet: 'bg-violet-50 text-violet-800 border-violet-200',
  emerald: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  rose: 'bg-rose-50 text-rose-800 border-rose-200',
  slate: 'bg-gray-100 text-gray-700 border-gray-200',
}

export function Pill({ children, tone = 'slate', strong = false }: {
  children: React.ReactNode
  tone?: Tone
  strong?: boolean
}) {
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] ${strong ? 'font-bold' : 'font-semibold'} whitespace-nowrap ${TONES[tone]}`}>
      {children}
    </span>
  )
}

/** Initials in a circle — used wherever a person is named in a list, so the
 *  eye finds the row before it reads the name. */
export function Who({ name, size = 'sm' }: { name: string | null; size?: 'sm' | 'md' }) {
  if (!name) return null
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()
  const dim = size === 'md' ? 'h-7 w-7 text-[11px]' : 'h-6 w-6 text-[10px]'
  return (
    <span className={`inline-grid place-items-center rounded-full bg-gray-200 text-gray-700 font-bold shrink-0 ${dim}`} aria-hidden>
      {initials}
    </span>
  )
}

/** A figure with its label above it — the counters across the top of a tab. */
export function Counter({ label, value, note, tone = 'slate', emphasise = false }: {
  label: string
  value: string | number
  note?: string
  tone?: Tone
  emphasise?: boolean
}) {
  const text = tone === 'rose' ? 'text-rose-700' : tone === 'amber' ? 'text-amber-800' : tone === 'emerald' ? 'text-emerald-700' : 'text-gray-900'
  return (
    <div className={`rounded-lg bg-white p-3 ${emphasise ? 'border-2 border-indigo-300' : 'border border-gray-200'}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`text-xl font-bold tabular-nums leading-tight mt-0.5 ${text}`}>{value}</p>
      {note && <p className="text-[11px] text-gray-500 leading-tight">{note}</p>}
    </div>
  )
}

/** The panel a screen shows instead of a configuration control when the
 *  reader may not configure. Says what it is and who can change it, rather
 *  than leaving a dead button. */
export function ConfigNote({ children }: { children: React.ReactNode }) {
  return <p className="text-[12px] text-gray-500">{children}</p>
}
