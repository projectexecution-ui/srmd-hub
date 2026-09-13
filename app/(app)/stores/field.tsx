'use client'

import type { ReactNode } from 'react'
import { Check, ChevronLeft, Truck, Package, Hand, Container, Car, Box } from 'lucide-react'

/**
 * The FIELD kit — for the screens a security guard and a storekeeper use on a
 * phone, outdoors, often one-handed.
 *
 * A deliberately different design register from the desk screens. Those are
 * dense because Aksha reads them at a laptop; these are the opposite:
 *
 *   · ONE question per screen, so nothing has to be scanned
 *   · plain words and short lines — never a database column's name
 *   · 64px targets and 17-26px type — a gloved thumb in bright sun
 *   · a picture on every choice, because the picture is read first
 *   · the primary action fixed to the bottom, always in the same place
 *
 * Nothing here is used by the reports, and nothing from the reports is used
 * here. Mixing the two is what makes an app that is wrong for both.
 */

/* ── Screen chrome ──────────────────────────────────────────────────────── */

/** A slim bar, not dots: at seven steps dots become a puzzle of their own. */
export function Progress({ current, total }: { current: number; total: number }) {
  const pct = Math.round(((current + 1) / total) * 100)
  return (
    <div className="space-y-1.5">
      <div className="h-1.5 w-full rounded-full bg-gray-200 overflow-hidden">
        <div className="h-full rounded-full bg-indigo-600 transition-[width] duration-300 motion-reduce:transition-none"
          style={{ width: `${pct}%` }} />
      </div>
      <p className="text-[12px] font-semibold text-gray-400 tabular-nums">{current + 1} / {total}</p>
    </div>
  )
}

export function Question({ t, hint }: { t: string; hint?: string }) {
  return (
    <div className="space-y-1">
      <h2 className="text-[26px] font-bold text-gray-900 leading-tight text-balance">{t}</h2>
      {hint && <p className="text-[15px] text-gray-500 pt-1.5">{hint}</p>}
    </div>
  )
}

/** A field label — small caps, quiet, above the thing it names. */
export function Label({ t, className = '' }: { t: string; className?: string }) {
  return (
    <span className={`block text-[11px] font-bold uppercase tracking-wider text-gray-500 ${className}`}>
      {t}
    </span>
  )
}

/* ── Choices ────────────────────────────────────────────────────────────── */

const ICONS = {
  trailer: Container, truck: Truck, tempo: Car, pickup: Package, hand: Hand, other: Box,
} as const
export type IconKey = keyof typeof ICONS

/**
 * A big tappable card. The whole card changes colour when picked rather than a
 * small check in the corner — at arm's length in sunlight, a colour change
 * across the card is what reads, not an icon.
 */
export function BigChoice({
  t, sub, icon, selected, onClick,
}: { t: string; sub?: string; icon?: IconKey; selected: boolean; onClick: () => void }) {
  const Icon = icon ? ICONS[icon] : null
  return (
    <button
      type="button" onClick={onClick} aria-pressed={selected}
      className={`w-full text-left rounded-2xl border-2 flex items-center gap-4 px-4 py-4 min-h-[72px] transition-colors
        ${selected
          ? 'border-indigo-600 bg-indigo-50 ring-4 ring-indigo-100'
          : 'border-gray-200 bg-white hover:border-gray-300 active:bg-gray-50'}`}
    >
      {Icon && (
        <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl
          ${selected ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-500'}`}>
          <Icon className="h-6 w-6" strokeWidth={2} />
        </span>
      )}
      {/* Title and consequence on their OWN lines. Run together with a dash
          they wrapped to three cramped lines on a 375px phone, which is the
          one width that matters here. */}
      <span className="flex-1 min-w-0">
        <span className="block text-[17px] font-semibold text-gray-900 leading-snug">{t}</span>
        {sub && <span className="block text-[14px] leading-snug text-gray-500 mt-0.5">{sub}</span>}
      </span>
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2
        ${selected ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-gray-300'}`}>
        {selected && <Check className="h-4 w-4" strokeWidth={3} />}
      </span>
    </button>
  )
}

/* ── Input ──────────────────────────────────────────────────────────────── */

export function BigInput({
  t, value, onChange, placeholder, mode, upper, autoFocus,
}: {
  t?: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  /** `tel` puts the phone's number pad up — worth far more than a label. */
  mode?: 'text' | 'tel' | 'numeric'
  upper?: boolean
  autoFocus?: boolean
}) {
  return (
    <label className="block space-y-1.5">
      {t && <Label t={t} />}
      <input
        value={value}
        onChange={e => onChange(upper ? e.target.value.toUpperCase() : e.target.value)}
        placeholder={placeholder}
        inputMode={mode === 'tel' ? 'tel' : mode === 'numeric' ? 'decimal' : 'text'}
        autoFocus={autoFocus}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        className={`w-full rounded-2xl border-2 border-gray-300 bg-white px-4 py-3.5 min-h-[64px]
          text-[20px] text-gray-900 placeholder:text-gray-300
          focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-100
          ${upper ? 'font-mono tracking-wide' : ''}`}
      />
    </label>
  )
}

/** Quick picks above a text field — a guard types "Balaji" far less often than
 *  he taps it, and the same shop comes six times a week. */
export function QuickPicks({ options, onPick }: { options: string[]; onPick: (v: string) => void }) {
  if (options.length === 0) return null
  return (
    <div className="flex flex-wrap gap-2">
      {options.slice(0, 6).map(o => (
        <button
          key={o} type="button" onClick={() => onPick(o)}
          className="rounded-full border-2 border-gray-200 bg-white px-4 py-2.5 min-h-[48px]
            text-[14px] font-semibold text-gray-700 active:bg-gray-100 max-w-full truncate"
        >
          {o}
        </button>
      ))}
    </div>
  )
}

/* ── Actions ────────────────────────────────────────────────────────────── */

/**
 * The bottom bar. Fixed position on a phone so the primary action is always
 * under the thumb and never moves between screens — a guard learns one place
 * to press and stops reading the button at all.
 */
export function BottomBar({
  onBack, onNext, nextLabel, nextDisabled, busy, children,
}: {
  onBack?: () => void
  onNext?: () => void
  nextLabel: string
  nextDisabled?: boolean
  busy?: boolean
  children?: ReactNode
}) {
  return (
    <div className="sticky bottom-0 -mx-4 sm:mx-0 mt-6 border-t border-gray-200 bg-white/95 backdrop-blur px-4 py-3
      pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:rounded-b-2xl sm:border-x">
      {children}
      <div className="flex items-stretch gap-2.5">
        {onBack && (
          <button
            type="button" onClick={onBack} aria-label="Back"
            className="flex items-center justify-center rounded-2xl border-2 border-gray-300 bg-white px-4 min-h-[60px] min-w-[60px] active:bg-gray-100"
          >
            <ChevronLeft className="h-6 w-6 text-gray-600" strokeWidth={2.5} />
          </button>
        )}
        <button
          type="button" onClick={onNext} disabled={nextDisabled || busy}
          className="flex-1 rounded-2xl bg-indigo-700 px-5 min-h-[60px] text-white font-bold text-[19px]
            active:bg-indigo-800 disabled:bg-gray-200 disabled:text-gray-400 transition-colors"
        >
          {busy ? '…' : nextLabel}
        </button>
      </div>
    </div>
  )
}

/** The one card a field screen lives inside. */
export function FieldCard({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-md">
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm px-4 pt-5 pb-0 sm:pb-0">
        {children}
      </div>
    </div>
  )
}

/** What a field screen shows when it has something to say — never a blank box. */
export function BigNotice({ kind, title, sub }: { kind: 'ok' | 'bad'; title: string; sub?: string }) {
  const ok = kind === 'ok'
  return (
    <div role="alert" className={`rounded-2xl border-2 px-4 py-3.5 ${
      ok ? 'border-emerald-300 bg-emerald-50' : 'border-rose-300 bg-rose-50'}`}>
      <p className={`text-[16px] font-bold whitespace-pre-line ${ok ? 'text-emerald-900' : 'text-rose-900'}`}>{title}</p>
      {sub && <p className={`text-[14px] mt-1 ${ok ? 'text-emerald-800' : 'text-rose-800'}`}>{sub}</p>}
    </div>
  )
}

/** Quantity, changed by thumb. Typing 2400 on a phone keypad in the rain is
 *  where wrong numbers come from; ± for small counts, the field for big ones. */
export function Stepper({
  value, onChange, step = 1, unit,
}: { value: string; onChange: (v: string) => void; step?: number; unit?: string }) {
  const n = Number(value) || 0
  const bump = (by: number) => onChange(String(Math.max(0, Math.round((n + by) * 1000) / 1000)))
  return (
    <div className="flex items-stretch gap-2">
      <button type="button" onClick={() => bump(-step)} aria-label="Less"
        className="w-14 rounded-xl border-2 border-gray-300 bg-white text-[24px] font-bold text-gray-600 active:bg-gray-100 min-h-[56px]">
        −
      </button>
      <div className="flex-1 relative">
        <input
          value={value} onChange={e => onChange(e.target.value)} inputMode="decimal"
          className="w-full h-full rounded-xl border-2 border-gray-300 bg-white px-3 text-center
            text-[22px] font-bold tabular-nums text-gray-900 min-h-[56px]
            focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-100"
        />
        {unit && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[13px] font-semibold text-gray-400 pointer-events-none">{unit}</span>}
      </div>
      <button type="button" onClick={() => bump(step)} aria-label="More"
        className="w-14 rounded-xl border-2 border-gray-300 bg-white text-[24px] font-bold text-gray-600 active:bg-gray-100 min-h-[56px]">
        +
      </button>
    </div>
  )
}
