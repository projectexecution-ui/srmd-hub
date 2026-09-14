'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { Input } from '@/components/ui/input'
import { Check, Loader2, Pencil, X } from 'lucide-react'
import type { BbStage } from '@/lib/bills-booking/stages'

/** The abstract number, recorded when it exists.
 *
 *  Aksha, 14 Sep 2026: "why Abstract Number - that will come ahead in process
 *  na ???" It does. The Site Head fills the abstract in IN4 AFTER the bill is
 *  entered, so the entry form was asking for it at the one moment it cannot
 *  exist — and nothing anywhere could set it afterwards, so every bill would
 *  have carried a blank there for good.
 *
 *  It lives on the bill instead, editable at any stage by anyone who can move
 *  bills, and nudged at the Site Head desk because that is where it is keyed.
 *  Every change writes an event, so the number tying this bill to its IN4
 *  document has a trail like everything else. */
export function AbstractNo({ billId, value, stage }: {
  billId: string
  value: string | null
  stage: BbStage
}) {
  const router = useRouter()
  const supabase = createClient()
  const [pending, start] = useTransition()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const [err, setErr] = useState<string | null>(null)

  // The abstract is filled at the Site Head's desk. Before that there is
  // nothing to key; after it, a blank is worth pointing at.
  const expected = stage !== 'submitted'

  function save() {
    setErr(null)
    start(async () => {
      const { error } = await supabase.rpc('bb_rpc_set_abstract', {
        p_bill: billId, p_abstract: draft.trim() || null,
      })
      if (error) { setErr(error.message); return }
      setEditing(false)
      toast.success(draft.trim() ? `Abstract ${draft.trim()} recorded.` : 'Abstract number cleared.')
      router.refresh()
    })
  }

  if (editing) {
    return (
      <div>
        <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Abstract no (IN4)</p>
        <div className="mt-1 flex items-center gap-1.5">
          <Input value={draft} onChange={e => setDraft(e.target.value)} autoFocus
                 placeholder="as it reads in IN4"
                 onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
                 className="h-9" />
          <button type="button" onClick={save} disabled={pending}
                  aria-label="Save the abstract number"
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          </button>
          <button type="button" onClick={() => { setDraft(value ?? ''); setEditing(false) }}
                  aria-label="Cancel"
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">
            <X className="h-4 w-4" />
          </button>
        </div>
        {err && <p role="alert" className="mt-1 text-[11px] text-rose-700">{err}</p>}
      </div>
    )
  }

  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Abstract no (IN4)</p>
      <button type="button" onClick={() => setEditing(true)}
              className="group mt-0.5 inline-flex items-center gap-1.5 text-left min-h-[24px]">
        <span className={value ? 'text-gray-800' : expected ? 'text-amber-700' : 'text-gray-400'}>
          {value || (expected ? 'not keyed yet' : 'comes later')}
        </span>
        <Pencil className="h-3 w-3 shrink-0 text-gray-300 group-hover:text-indigo-600" />
      </button>
    </div>
  )
}
