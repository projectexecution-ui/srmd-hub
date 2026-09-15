'use client'
// A lightweight type-to-filter dropdown (combobox). Use in place of a native
// <select> when the option list is long. Controlled by an id `value`; calls
// `onChange(id)` on pick. Keyboard: type to filter, ↑/↓ to move, Enter to pick,
// Esc to close; click-outside closes.
//
// Three things beyond a plain filter, each earning its keep on a real list:
//
//   group  — a heading above a run of options, the same grouping a native
//            <optgroup> gives. 45 projects under 9 parents read as 9 things.
//   pinned — a short "used here lately" run held at the top whatever the
//            filter says. Most gate entries repeat last week's entry.
//   size   — 'big' for the gate and store screens, where a storekeeper is
//            tapping on a phone in the rain and 40px is not enough.
//
// Options must arrive with their groups already contiguous; a repeated group
// name opens a second heading rather than merging. Sorting that way is the
// caller's job because only the caller knows the right order.

import * as React from 'react'
import { ChevronDown, Check, Search } from 'lucide-react'
import {
  filterOptions, arrangeOptions, startsBand, type SelectOption,
} from './searchable-select-rows'

export type { SelectOption }

export function SearchableSelect({
  value, onChange, options, placeholder = 'Select…', disabled = false, id,
  emptyText = 'No matches', required = false, size = 'normal',
  pinned = [], pinnedLabel = 'Used here lately', footer,
}: {
  value: string
  onChange: (id: string) => void
  options: SelectOption[]
  placeholder?: string
  disabled?: boolean
  id?: string
  emptyText?: string
  required?: boolean
  /** 'big' = 56px control and 44px rows, for phone-in-the-field screens. */
  size?: 'normal' | 'big'
  /** Ids held at the top of the list, in this order. */
  pinned?: readonly string[]
  pinnedLabel?: string
  /** Pinned to the bottom of the OPEN dropdown. For the way out of the list —
   *  "not in the list, type it" — which is unreachable underneath the panel. */
  footer?: React.ReactNode
}) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [active, setActive] = React.useState(0)
  const rootRef = React.useRef<HTMLDivElement>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const listRef = React.useRef<HTMLUListElement>(null)

  const big = size === 'big'
  const selected = options.find(o => o.id === value) ?? null

  const filtered = React.useMemo(() => filterOptions(options, query), [options, query])

  const rows = React.useMemo(
    () => arrangeOptions(filtered, pinned, pinnedLabel),
    [filtered, pinned, pinnedLabel],
  )

  React.useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false); setQuery('')
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  React.useEffect(() => { setActive(0) }, [query, open])

  // Keep the keyboard cursor in view — with 659 options the arrow keys walk
  // straight off the bottom of the box otherwise.
  React.useEffect(() => {
    if (!open) return
    listRef.current?.querySelector('[data-active="1"]')?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  function choose(optId: string) {
    onChange(optId)
    setOpen(false)
    setQuery('')
  }

  return (
    <div ref={rootRef} className="relative">
      {/* Hidden input keeps native required-validation working on submit. */}
      {required && (
        <input
          tabIndex={-1}
          aria-hidden
          required
          value={value}
          onChange={() => {}}
          className="sr-only absolute h-0 w-0 opacity-0"
        />
      )}
      <button
        type="button"
        id={id}
        disabled={disabled}
        onClick={() => { if (!disabled) { setOpen(o => !o); setTimeout(() => inputRef.current?.focus(), 0) } }}
        className={`mt-1 flex w-full items-center justify-between gap-2 rounded-xl border bg-white text-left disabled:cursor-not-allowed disabled:opacity-50 ${
          big
            ? 'min-h-[56px] border-2 border-gray-300 px-3.5 py-3 text-[16px] focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100'
            : 'h-10 border-gray-300 px-3 py-2 text-sm'
        }`}
      >
        <span className={selected ? 'truncate text-gray-900' : 'truncate text-gray-400'}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown className={`h-4 w-4 flex-shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
          <div className="flex items-center gap-2 border-b border-gray-100 px-2.5">
            <Search className={`flex-shrink-0 text-gray-400 ${big ? 'h-4 w-4' : 'h-3.5 w-3.5'}`} />
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') { setOpen(false); setQuery('') }
                else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, rows.length - 1)) }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
                else if (e.key === 'Enter') { e.preventDefault(); const r = rows[active]; if (r) choose(r.o.id) }
              }}
              placeholder="Type to filter…"
              className={`w-full bg-transparent outline-none placeholder:text-gray-400 ${
                big ? 'h-12 text-[16px]' : 'h-9 text-sm'
              }`}
            />
          </div>
          <ul ref={listRef} className={`overflow-auto py-1 ${big ? 'max-h-80' : 'max-h-72'}`}>
            {rows.length === 0 && (
              <li className={`px-3 text-gray-400 ${big ? 'py-3 text-[15px]' : 'py-2 text-sm'}`}>{emptyText}</li>
            )}
            {rows.map(({ o, band }, i) => {
              const newBand = startsBand(rows, i)
              return (
                <React.Fragment key={o.id}>
                  {newBand && (
                    <li
                      className="sticky top-0 bg-gray-50 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-500"
                      aria-hidden
                    >
                      {band}
                    </li>
                  )}
                  <li>
                    <button
                      type="button"
                      data-active={i === active ? '1' : '0'}
                      onClick={() => choose(o.id)}
                      onMouseEnter={() => setActive(i)}
                      className={`flex w-full items-center justify-between gap-2 px-3 text-left ${
                        big ? 'min-h-[44px] py-2.5 text-[15px]' : 'py-1.5 text-sm'
                      } ${i === active ? 'bg-blue-50' : ''} ${
                        o.id === value ? 'font-semibold text-blue-800' : 'text-gray-700'
                      }`}
                    >
                      {/* The hint has always been searchable but was never shown, so
                          a list of near-identical codes gave the reader nothing to
                          tell them apart. It is the second line now. */}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{o.label}</span>
                        {o.hint && (
                          <span className="block truncate text-xs font-normal text-gray-500">{o.hint}</span>
                        )}
                      </span>
                      {o.id === value && <Check className="h-3.5 w-3.5 flex-shrink-0 text-blue-600" />}
                    </button>
                  </li>
                </React.Fragment>
              )
            })}
          </ul>
          {footer && (
            <div className="border-t border-gray-100 bg-gray-50">{footer}</div>
          )}
        </div>
      )}
    </div>
  )
}
