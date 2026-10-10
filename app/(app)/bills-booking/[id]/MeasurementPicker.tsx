'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { Check, Loader2 } from 'lucide-react'
import { formatDate, formatINR } from '@/lib/utils'

/** One approved measurement in IN4 on this order — an abstract (work order)
 *  or a goods receipt (purchase order). */
export interface MeasurementOption {
  /** The abstract's display number, or the GRN id as text. */
  key: string
  /** "Abs/SRASSK/P2ST/2026-27/133" or "GRN/SRASSK/NGH/2026-27/1". */
  label: string
  on: string | null
  /** The bill number IN4 holds on it (abstracts), or the challan (receipts). */
  ref: string | null
  /** Measured basic value. */
  amount: number
  /** Already covered by a certificate — offered, but marked. */
  billed: boolean
}

/** The Site Head picks the approved abstract or goods receipt from IN4.
 *
 *  Aksha, 10 Oct 2026: "they will enter the Abstract number (after Approval in
 *  IN4) (select from IN4 data live) or GRN ID (after approval in IN4)". Nothing
 *  is typed: the list is what IN4 holds approved on this order, newest first,
 *  the one whose bill number matches pre-selected. Saving records it on the
 *  bill with a line in the history, and the Forward button opens. */
export function MeasurementPicker({ billId, kind, options, current, canPick, billNo }: {
  billId: string
  kind: 'WO' | 'PO'
  options: MeasurementOption[]
  current: string | null
  canPick: boolean
  billNo: string | null
}) {
  const router = useRouter()
  const supabase = createClient()
  const [pending, start] = useTransition()
  const suggested = current ?? options.find(o => billNo && o.ref && o.ref.trim().toLowerCase() === billNo.trim().toLowerCase())?.key ?? ''
  const [pick, setPick] = useState(suggested)
  const [err, setErr] = useState<string | null>(null)
  const thing = kind === 'PO' ? 'goods receipt' : 'abstract'

  function save() {
    setErr(null)
    if (!pick) { setErr(`Pick the approved ${thing}`); return }
    start(async () => {
      const { error } = await supabase.rpc('bb_rpc_pick_measurement', {
        p_bill: billId,
        p_abstract: kind === 'WO' ? pick : null,
        p_grn_id: kind === 'PO' ? Number(pick) : null,
      })
      if (error) { setErr(error.message); return }
      const o = options.find(x => x.key === pick)
      toast.success(`${o?.label ?? 'Measurement'} recorded from IN4 — now send it to the CT Disc Head`)
      router.refresh()
    })
  }

  const chosen = options.find(o => o.key === current) ?? null

  return (
    <div className="sm:col-span-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
        {kind === 'PO' ? 'Goods receipt (IN4)' : 'Abstract (IN4)'}
      </p>
      {!canPick ? (
        <p className="mt-0.5 text-gray-800">{chosen ? `${chosen.label}${chosen.on ? ` · ${formatDate(chosen.on)}` : ''} · ${formatINR(chosen.amount)}` : (current || '—')}</p>
      ) : options.length === 0 ? (
        <p className="mt-0.5 text-amber-700">
          IN4 has no approved {thing} on this order yet. Make it in IN4, get it approved, then pick it here — the list reads IN4 live.
        </p>
      ) : (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <select value={pick} onChange={e => setPick(e.target.value)} aria-label={`Approved ${thing} in IN4`}
                  className="h-10 min-w-[260px] flex-1 rounded-lg border border-gray-300 bg-white px-3 text-sm">
            <option value="">— pick the approved {thing} —</option>
            {options.map(o => (
              <option key={o.key} value={o.key}>
                {o.label}{o.on ? ` · ${formatDate(o.on)}` : ''}{o.ref ? ` · ${o.ref}` : ''} · {formatINR(o.amount)}{o.billed ? ' · already certified' : ''}
              </option>
            ))}
          </select>
          <button type="button" onClick={save} disabled={pending || !pick || pick === current}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-indigo-600 px-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {current ? 'Change' : 'Record from IN4'}
          </button>
          {current && chosen && (
            <span className="text-[12px] text-emerald-700">Recorded: {chosen.label} · {formatINR(chosen.amount)}</span>
          )}
        </div>
      )}
      {err && <p role="alert" className="mt-1 text-[11px] text-rose-700">{err}</p>}
    </div>
  )
}
