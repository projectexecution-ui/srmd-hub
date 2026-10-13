'use client'

import { Fragment, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, PenLine, Search, X } from 'lucide-react'
import { findParty, searchParties, type In4Party, type PartyKind } from '@/lib/bills-booking/party-search'

/** The party on a bill: IN4's when it was picked, or a name typed by hand. */
export interface PartyValue { name: string; party: In4Party | null }

const KIND: Record<PartyKind, string> = { contractor: 'Contractor', supplier: 'Supplier' }

/** The contractor or supplier, picked from IN4's party master.
 *
 *  Aksha, 13 Oct 2026: the party "should come from Live In4 data and if the
 *  Name is not shown then can add manually here which needs to be updated once
 *  its entered in iN4 - also the name picker should be advanced havin search
 *  features". So: type any part of the name, IN4 code, city or trade; arrow
 *  keys and Enter work; a name IN4 does not hold can still be entered, and says
 *  so in amber on the form and on the bill. */
export function PartyPicker({ parties, prefer, value, onChange }: {
  parties: In4Party[]
  /** Contractors first on a work-order bill, suppliers first on a PO bill. */
  prefer: PartyKind
  value: PartyValue
  onChange: (v: PartyValue) => void
}) {
  const [q, setQ] = useState('')
  const [hi, setHi] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  const matches = useMemo(() => searchParties(parties, q, prefer, 30), [parties, q, prefer])
  const total = useMemo(() => (q.trim() ? searchParties(parties, q, prefer, 10_000).length : 0), [parties, q, prefer])
  const typed = q.trim()
  const canAdd = typed.length >= 2 && !findParty(parties, typed)
  const options: Array<In4Party | 'manual'> = [...matches, ...(canAdd ? ['manual' as const] : [])]

  function pick(o: In4Party | 'manual') {
    onChange(o === 'manual' ? { name: typed, party: null } : { name: o.name, party: o })
    setQ(''); setHi(0)
  }

  // Chosen: one card, and a way to change it.
  if (value.name) {
    const p = value.party
    return (
      <div className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 ${p ? 'border-indigo-200 bg-indigo-50/50' : 'border-amber-300 bg-amber-50'}`}>
        <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${p ? 'bg-indigo-600 text-white' : 'bg-amber-200 text-amber-900'}`}>
          {p ? <Check className="h-4 w-4" /> : <PenLine className="h-4 w-4" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-gray-900">{value.name}</span>
          {p ? (
            <span className="block text-[11.5px] text-gray-600">
              From IN4 · {KIND[p.kind]}{p.code ? ` · ${p.code}` : ''}{p.city ? ` · ${p.city}` : ''}{p.trades.length ? ` · ${p.trades.slice(0, 2).join(', ')}` : ''}
            </span>
          ) : (
            <span className="block text-[11.5px] text-amber-900">
              <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
              Typed by hand — not in IN4 yet. The bill says so until Billing adds this party in IN4 under this name.
            </span>
          )}
        </span>
        <button type="button" onClick={() => { onChange({ name: '', party: null }); setTimeout(() => input.current?.focus(), 0) }}
                className="inline-flex min-h-[36px] shrink-0 items-center gap-1 rounded-lg px-2 text-[12px] font-semibold text-indigo-700 hover:bg-indigo-100">
          <X className="h-3.5 w-3.5" /> Change
        </button>
      </div>
    )
  }

  return (
    <div>
      <label className="flex h-11 items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-500/20">
        <Search className="h-4 w-4 shrink-0 text-gray-400" />
        <input ref={input} value={q} aria-label="Find the party in IN4" role="combobox" aria-expanded={options.length > 0}
               aria-controls="party-options" aria-activedescendant={options.length ? `party-${hi}` : undefined}
               placeholder={`Name, IN4 code, city or trade — ${parties.length} parties from IN4`}
               onChange={e => { setQ(e.target.value); setHi(0) }}
               onKeyDown={e => {
                 if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(h + 1, options.length - 1)) }
                 else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(h - 1, 0)) }
                 else if (e.key === 'Enter' && options[hi]) { e.preventDefault(); pick(options[hi]) }
                 else if (e.key === 'Escape') { setQ('') }
               }}
               className="w-full bg-transparent text-sm outline-none" />
        {q && (
          <button type="button" onClick={() => { setQ(''); input.current?.focus() }} aria-label="Clear the search"
                  className="flex h-8 w-8 items-center justify-center rounded text-gray-400 hover:text-gray-700">
            <X className="h-4 w-4" />
          </button>
        )}
      </label>

      {typed && (
        <div id="party-options" role="listbox" className="mt-1 max-h-80 overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-sm">
          {matches.map((p, i) => (
            <button key={`${p.kind}-${p.id}`} id={`party-${i}`} type="button" role="option" aria-selected={i === hi}
                    onMouseEnter={() => setHi(i)} onClick={() => pick(p)}
                    className={`block w-full border-b border-gray-100 px-3 py-2 text-left min-h-[44px] ${i === hi ? 'bg-indigo-50' : 'bg-white'}`}>
              <span className="block text-sm font-semibold text-gray-900"><Marked text={p.name} q={typed} /></span>
              <span className="block text-[11.5px] text-gray-500">
                {KIND[p.kind]}{p.code ? <> · <Marked text={p.code} q={typed} /></> : null}
                {p.city ? <> · <Marked text={p.city} q={typed} /></> : null}
                {p.trades.length ? <> · <Marked text={p.trades.slice(0, 2).join(', ')} q={typed} /></> : null}
              </span>
            </button>
          ))}
          {total > matches.length && (
            <p className="border-b border-gray-100 px-3 py-1.5 text-[11.5px] text-gray-500">
              Showing {matches.length} of {total} — type more to narrow.
            </p>
          )}
          {matches.length === 0 && (
            <p className="border-b border-gray-100 px-3 py-2 text-[12.5px] text-gray-600">No party in IN4 matches “{typed}”.</p>
          )}
          {canAdd && (
            <button id={`party-${matches.length}`} type="button" role="option" aria-selected={hi === matches.length}
                    onMouseEnter={() => setHi(matches.length)} onClick={() => pick('manual')}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left min-h-[44px] ${hi === matches.length ? 'bg-amber-50' : 'bg-white'}`}>
              <PenLine className="h-4 w-4 shrink-0 text-amber-700" />
              <span className="text-[13px] text-gray-800">
                Not in IN4 — enter <b>“{typed}”</b> by hand
                <span className="block text-[11px] text-amber-800">Billing adds the party in IN4 later; the bill shows it as not in IN4 until then.</span>
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** The typed words, bold where they appear. */
export function Marked({ text, q }: { text: string; q: string }) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return <>{text}</>
  const re = new RegExp(`(${words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'i')
  // split() with one capturing group puts the matches at the odd positions.
  return <>{text.split(re).map((part, i) => (i % 2 === 1
    ? <b key={i} className="font-bold text-indigo-800">{part}</b>
    : <Fragment key={i}>{part}</Fragment>))}</>
}
