'use client'
// "Is this adhoc, or as per the BOQ estimate?" — the HOD's point 7.
//
// Two buttons, not a dropdown: there are exactly two answers and the whole
// point is that it gets answered in one tap while the approver is already
// looking at the sheet. `prompt` renders the undeclared state as a question
// the Project Head is meant to notice at sign-off; without it the control sits
// quietly as a chip he can change.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, FileCheck2, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { adhocStateOf, ADHOC_HINT, ADHOC_LABEL } from '@/lib/cost-control/adhoc'
import { setWorkingSheetAdhoc } from '@/app/(app)/cost-control/working-sheets/[id]/adhoc-actions'

export function AdhocChoice({
  wsId, isAdhoc, setByName, canSet, prompt = false,
}: {
  wsId: string
  isAdhoc: boolean | null
  setByName: string | null
  /** Project Head / Atm Head / Trustee / admin. */
  canSet: boolean
  /** Show it as an unanswered question rather than a settled chip. */
  prompt?: boolean
}) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)
  const state = adhocStateOf(isAdhoc)

  const choose = (next: boolean) => {
    start(async () => {
      setErr(null)
      const r = await setWorkingSheetAdhoc(wsId, next)
      if (!r.ok) { setErr(r.error); return }
      toast.success(next ? 'Marked as adhoc — extra work' : 'Marked as per the BOQ estimate')
      router.refresh()
    })
  }

  // Read-only for anyone who cannot set it.
  if (!canSet) {
    if (state === 'undeclared') return null
    return (
      <span
        title={ADHOC_HINT[state]}
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-extrabold ${
          state === 'adhoc'
            ? 'bg-orange-100 text-orange-800 border border-orange-200'
            : 'bg-slate-100 text-slate-700 border border-slate-200'}`}
      >
        {state === 'adhoc' ? <Sparkles className="h-3 w-3" /> : <FileCheck2 className="h-3 w-3" />}
        {ADHOC_LABEL[state]}
      </span>
    )
  }

  const Btn = ({ mine, label, icon }: { mine: boolean; label: string; icon: React.ReactNode }) => {
    const active = isAdhoc === mine
    return (
      <button
        type="button"
        onClick={() => choose(mine)}
        disabled={busy}
        className={`inline-flex items-center justify-center gap-1.5 min-h-[40px] px-3 rounded-lg text-[12.5px] font-semibold border disabled:opacity-50 ${
          active
            ? (mine ? 'bg-orange-600 text-white border-orange-600' : 'bg-slate-700 text-white border-slate-700')
            : 'bg-white text-gray-700 border-gray-300 hover:border-gray-400'}`}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
        {label}
      </button>
    )
  }

  return (
    <div className={prompt && state === 'undeclared'
      ? 'rounded-lg border border-amber-300 bg-amber-50 p-3'
      : 'rounded-lg border border-gray-200 bg-white p-3'}>
      <p className="text-[12.5px] font-semibold text-gray-900">
        {state === 'undeclared'
          ? 'Is this budget adhoc, or as per the BOQ estimate?'
          : <>This budget is <b>{ADHOC_LABEL[state]}</b></>}
      </p>
      <p className="text-[11px] text-gray-500 mt-0.5">
        {state === 'undeclared'
          ? 'Adhoc means extra work outside the original BOQ. You can change this later.'
          : setByName ? `Set by ${setByName}. Tap the other option to change it.` : 'Tap the other option to change it.'}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Btn mine={false} label="As per BOQ" icon={<FileCheck2 className="h-3.5 w-3.5" />} />
        <Btn mine label="Adhoc — extra work" icon={<Sparkles className="h-3.5 w-3.5" />} />
      </div>
      {err && <p className="mt-1.5 text-[11px] font-semibold text-rose-700">{err}</p>}
    </div>
  )
}
