'use client'
// Shared per-row delete button for JMR admin master tables
// (contractors, items, rate cards). Postgres RLS + FK rules do the
// actual gating; on failure we surface the verbatim error so the
// admin sees why (e.g. "contractor still has bills" or "RLS violation").

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Trash2, Loader2 } from 'lucide-react'

interface Props {
  /** Table name to delete from — exactly one of the JMR master tables. */
  table: 'jmr_contractors' | 'jmr_items' | 'jmr_rate_cards'
  id: string
  /** Human-readable label, shown in the confirm prompt. */
  label: string
  /** What auto-deletes alongside this row (CASCADE FKs), in plain English.
   *  Surfaced in the confirm prompt so the admin doesn't get a surprise.
   *  Pass an empty string when nothing cascades. */
  cascadeNote?: string
}

export function AdminRowDeleteButton({ table, id, label, cascadeNote }: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function onClick() {
    setErr(null)
    const msg =
      `Delete "${label}"?\n\n`
      + (cascadeNote ? `${cascadeNote}\n\n` : '')
      + `If this row is referenced by live data (entries / bills), the delete will be refused.`
    if (!confirm(msg)) return
    setBusy(true)
    const { error } = await createClient().from(table).delete().eq('id', id)
    setBusy(false)
    if (error) {
      setErr(error.message)
      return
    }
    router.refresh()
  }

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="inline-flex items-center justify-center h-7 w-7 rounded-md text-rose-600 hover:text-rose-800 hover:bg-rose-50 border border-transparent hover:border-rose-200 disabled:opacity-50"
        title={`Delete "${label}"`}
        aria-label={`Delete ${label}`}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
      </button>
      {err && (
        <p className="text-[10px] text-rose-700 mt-1 max-w-[220px] truncate" title={err}>
          {err}
        </p>
      )}
    </>
  )
}
