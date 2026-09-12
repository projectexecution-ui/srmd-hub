// The Site Register's shared pieces — one definition of what a surface, a
// status, a person and a figure look like, so Discussions, Stakeholders and
// Decisions read as one product rather than three screens.
//
// DESIGN NOTES, so the next person changing this knows what the rules are:
//
//  Surfaces   A card is a soft ring plus one hairline of elevation, never a
//             hard 1px border. Elevation says "object"; a border says "edge",
//             and when everything has a border nothing stands out.
//  Colour     Status is a DOT plus a WORD, never colour alone — a colour-blind
//             reader and a printed page both have to work. Semantic colour
//             (attention / warning / settled) is separate from indigo, which
//             is only ever the action colour.
//  Rails      A 3px rail on the left edge marks a row that needs someone. One
//             rail per screen's worth of meaning; if two things both get a
//             rail, neither reads.
//  Type       11px label / 12px meta / 13px body / 15px heading. Headings get
//             -0.01em tracking, uppercase labels get +0.06em. Figures are
//             always tabular so columns line up.
//  Motion     Hover and open only, 150ms, and everything sits behind
//             prefers-reduced-motion.
//
// Plain functions with no hooks, so a server tab and a client screen can both
// render them.

import type { Tone } from '@/lib/site-register/types'

/* ── Surfaces ───────────────────────────────────────────────────────────── */

export const SURFACE = 'rounded-xl bg-white ring-1 ring-gray-200/80 shadow-[0_1px_2px_rgba(16,24,40,0.04)]'

export function Surface({ children, className = '', pad = true }: {
  children: React.ReactNode; className?: string; pad?: boolean
}) {
  return <div className={`${SURFACE} ${pad ? 'p-4' : ''} ${className}`}>{children}</div>
}

/** A screen's title block: name, one line of what it is, and its actions. */
export function SectionHead({ title, subtitle, actions }: {
  title: string; subtitle?: React.ReactNode; actions?: React.ReactNode
}) {
  return (
    <header className="flex flex-wrap items-start gap-x-4 gap-y-2">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-gray-900">{title}</h2>
        {subtitle && <p className="text-[12px] leading-relaxed text-gray-500 max-w-[68ch] mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="ml-auto flex flex-wrap items-center gap-1.5">{actions}</div>}
    </header>
  )
}

export function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-gray-500">{children}</p>
}

/* ── Colour ─────────────────────────────────────────────────────────────── */

const TINT: Record<Tone, { chip: string; dot: string; text: string; soft: string; rail: string }> = {
  amber:   { chip: 'bg-amber-50 text-amber-800 ring-amber-200',       dot: 'bg-amber-500',   text: 'text-amber-800',   soft: 'bg-amber-50',   rail: 'bg-amber-400' },
  sky:     { chip: 'bg-sky-50 text-sky-800 ring-sky-200',             dot: 'bg-sky-500',     text: 'text-sky-800',     soft: 'bg-sky-50',     rail: 'bg-sky-400' },
  violet:  { chip: 'bg-violet-50 text-violet-800 ring-violet-200',    dot: 'bg-violet-500',  text: 'text-violet-800',  soft: 'bg-violet-50',  rail: 'bg-violet-400' },
  emerald: { chip: 'bg-emerald-50 text-emerald-800 ring-emerald-200', dot: 'bg-emerald-500', text: 'text-emerald-700', soft: 'bg-emerald-50', rail: 'bg-emerald-400' },
  rose:    { chip: 'bg-rose-50 text-rose-800 ring-rose-200',          dot: 'bg-rose-500',    text: 'text-rose-700',    soft: 'bg-rose-50',    rail: 'bg-rose-500' },
  slate:   { chip: 'bg-gray-50 text-gray-700 ring-gray-200',          dot: 'bg-gray-400',    text: 'text-gray-700',    soft: 'bg-gray-50',    rail: 'bg-gray-300' },
}

export const tint = (t: Tone = 'slate') => TINT[t] ?? TINT.slate

/** A reference or a label. Quiet by default; `strong` for the one that is the
 *  row's identity. */
export function Pill({ children, tone = 'slate', strong = false, className = '' }: {
  children: React.ReactNode; tone?: Tone; strong?: boolean; className?: string
}) {
  return (
    <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] ring-1 whitespace-nowrap ${strong ? 'font-bold' : 'font-semibold'} ${tint(tone).chip} ${className}`}>
      {children}
    </span>
  )
}

/** Status: a dot and a word. Never the dot alone, never the word alone in a
 *  colour that has to be decoded. */
export function Status({ tone = 'slate', children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${tint(tone).dot}`} aria-hidden />
      <span className={`text-[12px] font-semibold ${tint(tone).text}`}>{children}</span>
    </span>
  )
}

/* ── People ─────────────────────────────────────────────────────────────── */

// Eight tints, chosen by the name itself, so the same person is the same
// colour on every screen and a list of ten people is scannable. Full class
// strings because Tailwind cannot see a built-up one.
const FACES = [
  'bg-indigo-100 text-indigo-700 ring-indigo-200/70',
  'bg-sky-100 text-sky-700 ring-sky-200/70',
  'bg-emerald-100 text-emerald-700 ring-emerald-200/70',
  'bg-amber-100 text-amber-800 ring-amber-200/70',
  'bg-rose-100 text-rose-700 ring-rose-200/70',
  'bg-violet-100 text-violet-700 ring-violet-200/70',
  'bg-teal-100 text-teal-700 ring-teal-200/70',
  'bg-orange-100 text-orange-800 ring-orange-200/70',
]

function faceOf(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return FACES[h % FACES.length]
}

export function Avatar({ name, size = 'sm' }: { name: string | null; size?: 'sm' | 'md' | 'lg' }) {
  if (!name || name === '—') return null
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()
  const dim = size === 'lg' ? 'h-9 w-9 text-[12px]' : size === 'md' ? 'h-7 w-7 text-[11px]' : 'h-6 w-6 text-[10px]'
  return (
    <span
      className={`inline-grid place-items-center rounded-full font-bold shrink-0 ring-1 ${dim} ${faceOf(name)}`}
      title={name}
      aria-hidden
    >
      {initials}
    </span>
  )
}

/* ── Figures ────────────────────────────────────────────────────────────── */

/**
 * One number, with what it is above it and what it means below. `bar` draws a
 * proportion underneath — a figure with a share is easier to judge than a
 * figure alone.
 */
export function Metric({ label, value, note, tone = 'slate', lead = false, bar }: {
  label: string
  value: string | number
  note?: string
  tone?: Tone
  /** The one figure this screen is about. Exactly one per screen. */
  lead?: boolean
  bar?: { of: number; value: number }
}) {
  const t = tint(tone)
  return (
    <div className={`relative overflow-hidden ${SURFACE} px-3.5 py-3 ${lead ? 'ring-indigo-200' : ''}`}>
      {lead && <span className="absolute inset-x-0 top-0 h-0.5 bg-indigo-500" aria-hidden />}
      <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-gray-500">{label}</p>
      <p className={`mt-1 text-[22px] leading-none font-bold tabular-nums tracking-[-0.02em] ${tone === 'slate' ? 'text-gray-900' : t.text}`}>
        {value}
      </p>
      {note && <p className="mt-1 text-[11px] leading-tight text-gray-500">{note}</p>}
      {bar && bar.of > 0 && (
        <div className="mt-2 h-1 rounded-full bg-gray-100 overflow-hidden" aria-hidden>
          {/* The lead figure's share is drawn in the action colour — a grey bar
              on a grey track is invisible, which is worse than no bar. */}
          <div
            className={`h-full rounded-full ${tone === 'slate' ? (lead ? 'bg-indigo-500' : 'bg-gray-400') : t.rail}`}
            style={{ width: `${Math.max(3, Math.min(100, Math.round((bar.value / bar.of) * 100)))}%` }}
          />
        </div>
      )}
    </div>
  )
}

/**
 * How long something has been waiting, against how long it had. Full and red
 * once it is past due — the shape says "late" before the number is read.
 */
export function AgeBar({ elapsed, allowed, over }: { elapsed: number; allowed: number; over: boolean }) {
  const pct = over ? 100 : allowed > 0 ? Math.min(100, Math.round((elapsed / allowed) * 100)) : 0
  return (
    <div className="mt-1 h-[3px] w-full max-w-[110px] rounded-full bg-gray-100 overflow-hidden" aria-hidden>
      <div
        className={`h-full rounded-full ${over ? 'bg-rose-500' : pct > 70 ? 'bg-amber-400' : 'bg-emerald-400'}`}
        style={{ width: `${Math.max(6, pct)}%` }}
      />
    </div>
  )
}

/** A proportion as a ring — used where a category's progress has to read at a
 *  glance beside its name. */
export function Ring({ done, total, size = 28 }: { done: number; total: number; size?: number }) {
  const r = (size - 4) / 2
  const c = 2 * Math.PI * r
  const pct = total > 0 ? done / total : 0
  const complete = total > 0 && done === total
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0" role="img"
      aria-label={`${done} of ${total} settled`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f1f3f5" strokeWidth="3" />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={complete ? '#059669' : pct > 0 ? '#4f46e5' : '#e5e7eb'}
        strokeWidth="3" strokeLinecap="round"
        strokeDasharray={`${c * pct} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="52%" textAnchor="middle" dominantBaseline="middle"
        className="fill-gray-700 font-bold" style={{ fontSize: 9, fontVariantNumeric: 'tabular-nums' }}>
        {total > 0 ? Math.round(pct * 100) : 0}
      </text>
    </svg>
  )
}

/* ── Controls ───────────────────────────────────────────────────────────── */

/** The primary view switch. One control, one choice — clearer than a row of
 *  buttons where any number could be pressed. */
export function Segmented<T extends string>({ options, value, onChange, size = 'md' }: {
  options: Array<{ key: T; label: string; count?: number; tone?: Tone }>
  value: T
  onChange: (key: T) => void
  size?: 'sm' | 'md'
}) {
  const pad = size === 'sm' ? 'px-2.5 py-1.5 text-[12px] min-h-[36px]' : 'px-3 py-2 text-[12px] min-h-[40px]'
  return (
    <div role="tablist" className="inline-flex flex-wrap items-center gap-0.5 rounded-lg bg-gray-100/80 p-0.5">
      {options.map(o => {
        const on = o.key === value
        return (
          <button
            key={o.key}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.key)}
            className={`${pad} rounded-[7px] font-semibold transition-colors whitespace-nowrap inline-flex items-center gap-1.5
              ${on ? 'bg-white text-gray-900 shadow-[0_1px_2px_rgba(16,24,40,0.06)]' : 'text-gray-600 hover:text-gray-900'}`}
          >
            {o.label}
            {typeof o.count === 'number' && (
              <span className={`tabular-nums text-[11px] rounded px-1 ${on ? (o.tone ? tint(o.tone).chip.split(' ').slice(0, 2).join(' ') : 'bg-gray-100 text-gray-600') : 'text-gray-400'}`}>
                {o.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/** A secondary, multi-choice filter. Reads as a token, and an active one says
 *  how to remove it. */
export function Chip({ on, onClick, children, count }: {
  on: boolean; onClick: () => void; children: React.ReactNode; count?: number
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold min-h-[32px] ring-1 transition-colors
        ${on ? 'bg-gray-900 text-white ring-gray-900' : 'bg-white text-gray-600 ring-gray-200 hover:bg-gray-50'}`}
    >
      {children}
      {typeof count === 'number' && <span className={`tabular-nums ${on ? 'text-white/70' : 'text-gray-400'}`}>{count}</span>}
      {on && <span className="text-white/60 text-[13px] leading-none" aria-hidden>×</span>}
    </button>
  )
}

export function Button({ kind = 'quiet', onClick, children, disabled, type = 'button', className = '' }: {
  kind?: 'primary' | 'quiet' | 'ghost'
  onClick?: () => void
  children: React.ReactNode
  disabled?: boolean
  type?: 'button' | 'submit'
  className?: string
}) {
  const styles = {
    primary: 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-[0_1px_2px_rgba(16,24,40,0.08)]',
    quiet: 'bg-white text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50',
    ghost: 'text-gray-600 hover:text-gray-900 hover:bg-gray-100',
  }[kind]
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 text-[12px] font-semibold min-h-[40px] transition-colors disabled:opacity-50 disabled:pointer-events-none ${styles} ${className}`}
    >
      {children}
    </button>
  )
}

/* ── Nothing to show ────────────────────────────────────────────────────── */

export function EmptyPanel({ icon, title, description, action, tone = 'slate' }: {
  icon: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
  tone?: Tone
}) {
  return (
    <div className={`${SURFACE} flex flex-col items-center justify-center px-6 py-12 text-center`}>
      <span className={`grid place-items-center h-12 w-12 rounded-full ${tint(tone).soft} ${tint(tone).text} mb-3`} aria-hidden>
        {icon}
      </span>
      <p className="text-[14px] font-semibold text-gray-900">{title}</p>
      {description && <p className="mt-1 text-[12px] leading-relaxed text-gray-500 max-w-[46ch]">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

/* ── Overlays ───────────────────────────────────────────────────────────── */

/** One modal shell for every panel across the three tabs: a scrim, a sticky
 *  header, and a body that scrolls on its own so the page behind never does. */
export function Modal({ title, subtitle, onClose, children, width = 'md' }: {
  title: string
  subtitle?: React.ReactNode
  onClose: () => void
  children: React.ReactNode
  width?: 'md' | 'lg'
}) {
  return (
    <>
      <div className="fixed inset-0 bg-gray-900/50 backdrop-blur-[2px] z-40" onClick={onClose} aria-hidden />
      <div className="fixed inset-0 z-50 grid place-items-center p-3 pointer-events-none">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className={`pointer-events-auto w-full ${width === 'lg' ? 'max-w-[760px]' : 'max-w-[580px]'} max-h-[88vh] overflow-y-auto rounded-2xl bg-white shadow-[0_24px_48px_-12px_rgba(16,24,40,0.25)]`}
        >
          <div className="sticky top-0 z-10 flex items-start gap-3 border-b border-gray-100 bg-white/95 backdrop-blur px-5 py-4">
            <div className="min-w-0">
              <p className="text-[15px] font-semibold tracking-[-0.01em] text-gray-900">{title}</p>
              {subtitle && <p className="text-[12px] text-gray-500 mt-0.5">{subtitle}</p>}
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="ml-auto grid place-items-center h-9 w-9 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 shrink-0"
            >
              <span className="text-xl leading-none">&times;</span>
            </button>
          </div>
          <div className="p-5">{children}</div>
        </div>
      </div>
    </>
  )
}

/* ── Forms ──────────────────────────────────────────────────────────────── */

export const FIELD =
  'w-full rounded-lg bg-white px-2.5 py-2 text-[13px] text-gray-900 ring-1 ring-gray-200 min-h-[40px] ' +
  'placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500'

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-gray-500">{label}</p>
      {children}
      {hint && <p className="mt-1 text-[11px] leading-relaxed text-gray-500">{hint}</p>}
    </div>
  )
}

export function Notice({ tone = 'rose', children }: { tone?: Tone; children: React.ReactNode }) {
  const t = tint(tone)
  return <p className={`rounded-lg px-3 py-2 text-[12px] ring-1 ${t.chip}`}>{children}</p>
}
