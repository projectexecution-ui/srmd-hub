'use client'
// Searchable item picker with image thumbnails.
//
// Usage:
//   <ItemPicker items={items} value={itemId} onChange={setItemId} />
//
// Click the field → modal opens with a search box, grouped/filtered grid
// of item cards (image + code + name + unit + category). Click a card →
// modal closes + onChange fires with the chosen item id.

import { useEffect, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import { Search, X, ImageOff, ChevronDown, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface PickerItem {
  id: string
  code: string
  name: string
  unit: string
  category: string | null
  image_url: string | null
}

interface Props {
  items: PickerItem[]
  value: string
  onChange: (id: string) => void
  /** Disable / read-only display */
  disabled?: boolean
  className?: string
  placeholder?: string
}

export function ItemPicker({ items, value, onChange, disabled, className, placeholder }: Props) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [activeCategory, setActiveCategory] = useState<string>('All')
  const searchRef = useRef<HTMLInputElement>(null)

  const selected = items.find(i => i.id === value)

  useEffect(() => {
    if (open) {
      // Autofocus the search box when the modal opens
      setTimeout(() => searchRef.current?.focus(), 50)
    } else {
      setQ('')
      setActiveCategory('All')
    }
  }, [open])

  // Esc to close
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const it of items) if (it.category) set.add(it.category)
    return ['All', ...Array.from(set).sort()]
  }, [items])

  const filtered = useMemo(() => {
    let out = items
    if (activeCategory !== 'All') out = out.filter(i => i.category === activeCategory)
    const lc = q.trim().toLowerCase()
    if (lc) {
      out = out.filter(i =>
        i.code.toLowerCase().includes(lc) ||
        i.name.toLowerCase().includes(lc) ||
        (i.category ?? '').toLowerCase().includes(lc),
      )
    }
    return out
  }, [items, q, activeCategory])

  return (
    <>
      {/* Trigger button — looks like a form input */}
      <button
        type="button"
        onClick={() => !disabled && setOpen(true)}
        disabled={disabled}
        className={cn(
          'flex items-center justify-between w-full h-10 rounded-xl border border-gray-300 bg-white px-3 text-sm text-left hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-600',
          disabled && 'opacity-60 cursor-not-allowed',
          className,
        )}
      >
        {selected ? (
          <span className="inline-flex items-center gap-2 min-w-0">
            <span className="h-7 w-7 rounded-md border border-gray-100 bg-gray-50 overflow-hidden flex items-center justify-center flex-shrink-0">
              {selected.image_url
                ? <Image src={selected.image_url} alt="" width={28} height={28} className="object-cover h-full w-full" unoptimized />
                : <ImageOff className="h-3.5 w-3.5 text-gray-300" />}
            </span>
            <span className="min-w-0 truncate">
              <span className="font-mono text-[11px] text-blue-700 mr-1.5">{selected.code}</span>
              <span className="text-gray-800">{selected.name}</span>
            </span>
          </span>
        ) : (
          <span className="text-gray-400">{placeholder ?? '— Select item —'}</span>
        )}
        <ChevronDown className="h-4 w-4 text-gray-400 flex-shrink-0 ml-2" />
      </button>

      {open && !disabled && (
        <div
          className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 p-2 md:p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
              <Search className="h-4 w-4 text-gray-400 flex-shrink-0" />
              <input
                ref={searchRef}
                type="search"
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Search by code, name or category…"
                className="flex-1 outline-none text-sm placeholder-gray-400"
              />
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-700 p-1">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Category chips */}
            <div className="px-4 pt-3 pb-1 border-b border-gray-100 overflow-x-auto">
              <div className="flex gap-1.5 min-w-min">
                {categories.map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setActiveCategory(c)}
                    className={cn(
                      'inline-flex items-center text-xs font-medium px-3 h-7 rounded-full whitespace-nowrap',
                      activeCategory === c
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200',
                    )}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>

            {/* Item grid */}
            <div className="flex-1 overflow-y-auto p-3">
              {filtered.length === 0 ? (
                <div className="p-10 text-center text-sm text-gray-500">
                  No items match <b>{q || activeCategory}</b>.
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                  {filtered.map(it => {
                    const isSelected = it.id === value
                    return (
                      <button
                        key={it.id}
                        type="button"
                        onClick={() => { onChange(it.id); setOpen(false) }}
                        className={cn(
                          'relative text-left rounded-xl border bg-white p-2 hover:shadow-md hover:-translate-y-0.5 transition-all',
                          isSelected ? 'border-blue-600 ring-2 ring-blue-100' : 'border-gray-200',
                        )}
                      >
                        <div className="aspect-square w-full rounded-lg border border-gray-100 bg-gray-50 overflow-hidden flex items-center justify-center mb-2">
                          {it.image_url
                            ? <Image src={it.image_url} alt={it.name} width={120} height={120} className="object-cover h-full w-full" unoptimized />
                            : <ImageOff className="h-7 w-7 text-gray-300" />}
                        </div>
                        <p className="font-mono text-[10px] font-bold text-blue-700 leading-tight">{it.code}</p>
                        <p className="text-xs font-semibold text-gray-900 leading-tight line-clamp-2 mt-0.5">{it.name}</p>
                        <p className="text-[10px] text-gray-500 mt-0.5">
                          {it.unit}{it.category ? <> · {it.category}</> : null}
                        </p>
                        {isSelected && (
                          <span className="absolute top-1.5 right-1.5 h-5 w-5 rounded-full bg-blue-600 text-white inline-flex items-center justify-center">
                            <Check className="h-3 w-3" />
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="px-4 py-2 border-t border-gray-100 text-[11px] text-gray-500 flex items-center justify-between">
              <span><b>{filtered.length}</b> of {items.length} items</span>
              <span>Press <kbd className="font-mono bg-gray-100 px-1 rounded">Esc</kbd> to close</span>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
