'use client'

import { useRef, useState } from 'react'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { formatINR } from '@/lib/utils'

/**
 * Which party's ledger to open.
 *
 * One option per party ever billed on the project, so it is short on a new
 * project and long on an old one, and only ever gets longer — the one list in
 * the app whose length is a function of how long the project has run.
 *
 * Stays inside its GET form: picking submits, the server re-renders from the
 * URL, and the ledger is still a linkable page. The hidden input is what the
 * form actually posts, because SearchableSelect has no name of its own.
 */
export function PartyPicker({
  name, value, parties,
}: {
  name: string
  value: string
  /** Biggest biller first — that order is the caller's, not ours. */
  parties: ReadonlyArray<{ name: string; gross: number }>
}) {
  const [picked, setPicked] = useState(value)
  const ref = useRef<HTMLInputElement>(null)

  return (
    <>
      <input ref={ref} type="hidden" name={name} value={picked} />
      <div className="min-w-[240px] max-w-[320px]">
        <SearchableSelect
          value={picked}
          onChange={id => {
            setPicked(id)
            // Submit after the hidden input has the new value.
            requestAnimationFrame(() => ref.current?.form?.requestSubmit())
          }}
          options={parties.map(p => ({
            id: p.name,
            label: p.name,
            hint: p.gross > 0 ? formatINR(p.gross) : undefined,
          }))}
          placeholder="Pick a party"
          emptyText="No party by that name on this project"
        />
      </div>
    </>
  )
}
