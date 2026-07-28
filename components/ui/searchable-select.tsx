'use client'
// A lightweight type-to-filter dropdown (combobox). Use in place of a native
// <select> when the option list is long. Controlled by an id `value`; calls
// `onChange(id)` on pick. Keyboard: type to filter, ↑/↓ to move, Enter to pick,
// Esc to close; click-outside closes.

import * as React from 'react'
import { ChevronDown, Check, Search } from 'lucide-react'

export interface SelectOption { id: string; label: string; hint?: string }

export function SearchableSelect({
  value, onChange, options, placeholder = 'Select…', disabled = false, id,
  emptyText = 'No matches', required = false,
}: {
  value: string
  onChange: (id: string) => void
  options: SelectOption[]
  placeholder?: string
  disabled?: boolean
  id?: string
  emptyText?: string
  required?: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [active, setActive] = React.useState(0)
  const rootRef = React.useRef<HTMLDivElement>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)

  const selected = options.find(o => o.id === value) ?? null

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter(o =>
      o.label.toLowerCase().includes(q) || (o.hint ?? '').toLowerCase().includes(q),
    )
  }, [options, query])

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
        className="mt-1 flex h-10 w-full items-center justify-between gap-2 rounded-xl border border-gray-300 bg-white px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className={selected ? 'truncate text-gray-900' : 'truncate text-gray-400'}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown className={`h-4 w-4 flex-shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
          <div className="flex items-center gap-2 border-b border-gray-100 px-2.5">
            <Search className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') { setOpen(false); setQuery('') }
                else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, filtered.length - 1)) }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
                else if (e.key === 'Enter') { e.preventDefault(); const o = filtered[active]; if (o) choose(o.id) }
              }}
              placeholder="Type to filter…"
              className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-gray-400"
            />
          </div>
          <ul className="max-h-60 overflow-auto py-1">
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-sm text-gray-400">{emptyText}</li>
            )}
            {filtered.map((o, i) => (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => choose(o.id)}
                  onMouseEnter={() => setActive(i)}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm ${
                    i === active ? 'bg-blue-50' : ''
                  } ${o.id === value ? 'font-semibold text-blue-800' : 'text-gray-700'}`}
                >
                  <span className="truncate">{o.label}</span>
                  {o.id === value && <Check className="h-3.5 w-3.5 flex-shrink-0 text-blue-600" />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
