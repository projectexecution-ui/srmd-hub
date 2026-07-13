'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Check, Clock, RotateCcw, Loader2 } from 'lucide-react'

// Per-row actions on a command-centre item. RLS guarantees a user can only
// touch their own rows, so we just update by id. Phase 2 adds "draft reply"
// and "apply label" here (they'll call the Gmail API).
export function ItemActions({ id, status }: { id: string; status: 'open' | 'done' | 'snoozed' }) {
  const router = useRouter()
  const [busy, setBusy] = useState<null | 'done' | 'snooze' | 'reopen'>(null)
  const [err, setErr] = useState<string | null>(null)

  async function update(patch: Record<string, unknown>, kind: 'done' | 'snooze' | 'reopen') {
    setBusy(kind); setErr(null)
    const { error } = await createClient().from('ecc_items').update(patch).eq('id', id)
    setBusy(null)
    if (error) { setErr(error.message); return }
    router.refresh()
  }

  function chaseInDays(n: number): string {
    const d = new Date()
    d.setDate(d.getDate() + n)
    return d.toISOString().slice(0, 10)
  }

  return (
    <div className="flex flex-col items-end gap-1 flex-shrink-0">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => update({ status: 'done' }, 'done')}
          disabled={busy !== null}
          title="Mark done"
          aria-label="Mark done"
          className="inline-flex items-center justify-center h-7 w-7 rounded-md text-emerald-600 hover:bg-emerald-50 border border-transparent hover:border-emerald-200 disabled:opacity-50"
        >
          {busy === 'done' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
        </button>
        {status === 'snoozed' ? (
          <button
            type="button"
            onClick={() => update({ status: 'open', chase_on: null }, 'reopen')}
            disabled={busy !== null}
            title="Reopen"
            aria-label="Reopen"
            className="inline-flex items-center justify-center h-7 w-7 rounded-md text-gray-500 hover:bg-gray-100 border border-transparent hover:border-gray-200 disabled:opacity-50"
          >
            {busy === 'reopen' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => update({ status: 'snoozed', chase_on: chaseInDays(3) }, 'snooze')}
            disabled={busy !== null}
            title="Snooze 3 days (sets a chase date)"
            aria-label="Snooze 3 days"
            className="inline-flex items-center justify-center h-7 w-7 rounded-md text-blue-600 hover:bg-blue-50 border border-transparent hover:border-blue-200 disabled:opacity-50"
          >
            {busy === 'snooze' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Clock className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>
      {err && <p className="text-[10px] text-rose-700 max-w-[140px] truncate" title={err}>{err}</p>}
    </div>
  )
}
