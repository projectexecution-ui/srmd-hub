'use client'

// A near drop-in replacement for a <textarea> that adds @-mentions. Type "@",
// pick a person from the dropdown, and their "@Full Name" is inserted. On every
// change it hands the parent both the text and the mentioned user IDs (derived
// from the text), so the submit path can notify them. Drop this into any comment
// box; it fetches the mentionable users itself (cached across instances).

import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { mentionIdsInText, mentionToken, splitMentions, type MentionUser } from '@/lib/mentions/parse'

let cache: MentionUser[] | null = null
let inflight: Promise<MentionUser[]> | null = null
function loadUsers(): Promise<MentionUser[]> {
  if (cache) return Promise.resolve(cache)
  if (!inflight) {
    inflight = fetch('/api/users/mentionable')
      .then(r => (r.ok ? r.json() : { users: [] }))
      .then((d: { users?: MentionUser[] }) => { cache = d.users ?? []; return cache })
      .catch(() => { cache = []; return cache })
  }
  return inflight
}

interface Props {
  value: string
  onChange: (value: string, mentionIds: string[]) => void
  placeholder?: string
  rows?: number
  maxLength?: number
  disabled?: boolean
  className?: string
}

export function MentionTextarea({ value, onChange, placeholder, rows = 2, maxLength, disabled, className }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const [users, setUsers] = useState<MentionUser[]>(cache ?? [])
  const [menuOpen, setMenuOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [atPos, setAtPos] = useState<number | null>(null)
  const [hi, setHi] = useState(0)

  useEffect(() => { loadUsers().then(setUsers) }, [])

  const matches = useMemo(() => {
    if (!menuOpen) return []
    const q = query.trim().toLowerCase()
    return users.filter(u => u.name.toLowerCase().includes(q)).slice(0, 8)
  }, [menuOpen, query, users])

  // Recompute the active "@ token" (from the last '@' up to the caret, no newline).
  function refreshTrigger(text: string, caret: number) {
    const upto = text.slice(0, caret)
    const at = upto.lastIndexOf('@')
    if (at === -1) { setMenuOpen(false); setAtPos(null); return }
    const between = upto.slice(at + 1)
    // stop the trigger on a newline or an over-long query
    if (between.includes('\n') || between.length > 40) { setMenuOpen(false); setAtPos(null); return }
    setAtPos(at); setQuery(between); setHi(0); setMenuOpen(true)
  }

  function emit(text: string) {
    onChange(text, mentionIdsInText(text, users))
  }

  // Character ranges [start, end) of every complete "@Name" in the text, so a
  // whole mention can be treated as one unit (highlight + one-press delete).
  function mentionRanges(text: string): Array<[number, number]> {
    const ranges: Array<[number, number]> = []
    let pos = 0
    for (const s of splitMentions(text, users)) {
      if (s.type === 'mention') ranges.push([pos, pos + s.value.length])
      pos += s.value.length
    }
    return ranges
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const text = e.target.value
    emit(text)
    refreshTrigger(text, e.target.selectionStart ?? text.length)
  }

  function pick(u: MentionUser) {
    const el = ref.current
    if (el == null || atPos == null) return
    const caret = el.selectionStart ?? value.length
    const before = value.slice(0, atPos)
    const after = value.slice(caret)
    const inserted = mentionToken(u.name)
    const next = before + inserted + after
    setMenuOpen(false); setAtPos(null)
    emit(next)
    // restore caret just after the inserted mention
    requestAnimationFrame(() => {
      const pos = (before + inserted).length
      el.focus(); el.setSelectionRange(pos, pos)
    })
  }

  // Delete a whole "@Name" in one keystroke instead of letter-by-letter.
  function tryAtomicDelete(e: React.KeyboardEvent<HTMLTextAreaElement>): boolean {
    const el = ref.current
    if (!el || (e.key !== 'Backspace' && e.key !== 'Delete')) return false
    const start = el.selectionStart ?? 0
    const end = el.selectionEnd ?? 0
    if (start !== end) return false // a range is selected → let the browser handle it
    const ranges = mentionRanges(value)
    let hit: [number, number] | undefined
    if (e.key === 'Backspace') {
      // caret right after "@Name"
      hit = ranges.find(([, b]) => b === start)
      // caret right after "@Name " (the inserted token's trailing space) → take both
      if (!hit && value[start - 1] === ' ') {
        const r = ranges.find(([, b]) => b === start - 1)
        if (r) hit = [r[0], start]
      }
    } else {
      // Delete: caret right before "@Name"
      hit = ranges.find(([a]) => a === start)
    }
    if (!hit) return false
    e.preventDefault()
    const next = value.slice(0, hit[0]) + value.slice(hit[1])
    setMenuOpen(false); setAtPos(null)
    emit(next)
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(hit![0], hit![0]) })
    return true
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (tryAtomicDelete(e)) return
    if (!menuOpen || matches.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => (h + 1) % matches.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => (h - 1 + matches.length) % matches.length) }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(matches[hi]) }
    else if (e.key === 'Escape') { setMenuOpen(false); setAtPos(null) }
  }

  // Shared box metrics so the highlight overlay lines up exactly under the
  // textarea's characters (same font, padding, border width, wrapping).
  const boxClass = cn('w-full rounded-md border p-2 text-sm', className)

  return (
    <div className="relative">
      {/* Highlight layer behind the (transparent-text) textarea: the same text,
          with each "@Name" tinted, so a mention reads as one coloured chunk. */}
      <div
        ref={overlayRef}
        aria-hidden
        className={cn(boxClass, 'pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words border-transparent bg-white text-gray-900')}
      >
        {splitMentions(value, users).map((s, i) =>
          s.type === 'mention'
            ? <span key={i} className="rounded bg-blue-100 text-blue-800">{s.value}</span>
            : <span key={i}>{s.value}</span>,
        )}
        {value.endsWith('\n') ? ' ' : ''}
      </div>
      <textarea
        ref={ref}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={() => setTimeout(() => setMenuOpen(false), 120)}
        onClick={e => refreshTrigger(value, e.currentTarget.selectionStart ?? value.length)}
        onScroll={e => { if (overlayRef.current) overlayRef.current.scrollTop = e.currentTarget.scrollTop }}
        rows={rows}
        maxLength={maxLength}
        disabled={disabled}
        placeholder={placeholder}
        className={cn(boxClass, 'relative border-gray-200 bg-transparent text-transparent caret-gray-900 placeholder:text-gray-400')}
      />
      {menuOpen && matches.length > 0 && (
        <ul className="absolute z-20 left-0 right-0 mt-1 max-h-56 overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg py-1">
          {matches.map((u, i) => (
            <li key={u.id}>
              <button
                type="button"
                onMouseDown={e => { e.preventDefault(); pick(u) }}
                onMouseEnter={() => setHi(i)}
                className={cn('flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm', i === hi ? 'bg-blue-50 text-blue-800' : 'text-gray-700 hover:bg-gray-50')}>
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-blue-700 text-[11px] font-bold flex-shrink-0">
                  {u.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="truncate">{u.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
