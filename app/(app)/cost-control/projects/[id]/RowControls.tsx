'use client'
// Inline edit controls rendered into the project detail table — one per
// discipline row and one per sub-skill row. Lets the PM patch the plan
// deadline and (for sub-skills) the thumbrule mode without leaving the
// page or re-opening the wizard.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarClock, Pencil, Loader2, Check, X, Ruler, EyeOff, ArrowRight } from 'lucide-react'
import { confirm } from '@/components/ui/confirm-dialog'
import {
  setDisciplineDeadline,
  setSubSkillDeadline,
  setSubSkillEstimationMode,
  setDisciplineEnabled,
  setSubSkillEnabled,
} from './actions'
import { setInternalEstimateDecision } from '@/components/cost-control/ws-actions'

// ──────────────────────────────────────────────────────────────────────
// DeadlineCell — used on both discipline + sub-skill rows. The currently-
// saved plan deadline appears next to a tiny pencil; click it to open
// an inline date picker. Empty state shows a "Set deadline" link.
// ──────────────────────────────────────────────────────────────────────
export function DeadlineCell({
  projectId,
  disciplineId,
  subSkillId,
  initialDeadline,
  canWrite,
  inheritedFromDiscipline,
  inheritedFromWS,
}: {
  projectId: string
  /** Pass exactly one of disciplineId / subSkillId */
  disciplineId?: string
  subSkillId?: string
  initialDeadline: string | null
  canWrite: boolean
  /** When the sub-skill has no own deadline but its discipline has one, show that as a hint. */
  inheritedFromDiscipline?: string | null
  /** When the sub-skill has no own deadline but at least one WS under it
   *  has a deadline_date, show that as an inherited hint instead of
   *  asking the PM to type the same date again. */
  inheritedFromWS?: string | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(initialDeadline ?? '')
  const [err, setErr] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function save() {
    setErr(null)
    const payload = value === '' ? null : value
    startTransition(async () => {
      const res = disciplineId
        ? await setDisciplineDeadline(projectId, disciplineId, payload)
        : await setSubSkillDeadline(projectId, subSkillId!, payload)
      if (!res.ok) { setErr(res.error); return }
      setOpen(false)
      router.refresh()
    })
  }

  // Inheritance order when sub-skill has no own deadline:
  //   1. earliest WS deadline (engineer commitments)   → "from WS"
  //   2. discipline plan deadline (PM target)          → "from disc"
  // Showing inherited stops the "Set deadline" prompt from nagging when
  // the deadline is already implied elsewhere.
  const inheritedDate = inheritedFromWS ?? inheritedFromDiscipline ?? null
  const inheritedSource: 'ws' | 'disc' | null = inheritedFromWS ? 'ws' : (inheritedFromDiscipline ? 'disc' : null)

  if (!canWrite) {
    // Read-only view — just show what's saved.
    if (initialDeadline) return <DeadlineChip date={initialDeadline} />
    if (inheritedDate) return <DeadlineChip date={inheritedDate} inherited source={inheritedSource ?? undefined} />
    return <span className="text-[11px] text-gray-400">—</span>
  }

  if (!open) {
    if (initialDeadline) {
      return (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1 group"
          title="Click to edit deadline"
        >
          <DeadlineChip date={initialDeadline} />
          <Pencil className="h-3 w-3 text-gray-400 group-hover:text-blue-600" />
        </button>
      )
    }
    // Inherited from WS or discipline — show that instead of nagging.
    // Tiny pencil still lets the PM override with an explicit sub-skill
    // target if they want.
    if (inheritedDate) {
      return (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1 group"
          title={inheritedSource === 'ws' ? 'Auto-derived from the earliest Working Sheet deadline. Click to set an explicit sub-skill target.' : 'Inheriting the discipline-level plan deadline. Click to override.'}
        >
          <DeadlineChip date={inheritedDate} inherited source={inheritedSource ?? undefined} />
          <Pencil className="h-3 w-3 text-gray-400 group-hover:text-blue-600" />
        </button>
      )
    }
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-[11px] text-blue-700 hover:text-blue-900 hover:underline"
        title="Set a plan deadline"
      >
        <CalendarClock className="h-3.5 w-3.5" />
        Set deadline
      </button>
    )
  }

  return (
    <div className="flex items-center gap-1">
      <input
        type="date"
        value={value}
        onChange={e => setValue(e.target.value)}
        className="h-7 rounded border border-gray-300 px-1.5 text-[11px]"
        autoFocus
        disabled={pending}
      />
      <button
        type="button"
        onClick={save}
        disabled={pending}
        className="h-7 w-7 inline-flex items-center justify-center rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
        title="Save"
      >
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
      </button>
      <button
        type="button"
        onClick={() => { setOpen(false); setValue(initialDeadline ?? ''); setErr(null) }}
        disabled={pending}
        className="h-7 w-7 inline-flex items-center justify-center rounded text-gray-500 hover:bg-gray-100"
        title="Cancel"
      >
        <X className="h-3.5 w-3.5" />
      </button>
      {initialDeadline && (
        <button
          type="button"
          onClick={() => { setValue(''); /* user can then save to clear */ }}
          disabled={pending}
          className="text-[10px] text-gray-400 hover:text-rose-600 underline ml-1"
          title="Clear and save to remove deadline"
        >
          clear
        </button>
      )}
      {err && <span className="text-[10px] text-rose-700 ml-1">{err}</span>}
    </div>
  )
}

function DeadlineChip({ date, inherited, source }: { date: string; inherited?: boolean; source?: 'ws' | 'disc' }) {
  const d = new Date(date + 'T00:00:00')
  const formatted = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })
  // Days remaining for at-a-glance urgency colouring.
  const today = new Date()
  const ms = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  const days = Math.round(ms / 86400000)
  // Tone driven by urgency, dimmed when inherited.
  let tone = 'bg-blue-50 text-blue-800 border-blue-200'
  if (days < 0)        tone = 'bg-rose-50 text-rose-700 border-rose-200'
  else if (days <= 7)  tone = 'bg-amber-50 text-amber-800 border-amber-200'
  if (inherited)       tone = 'bg-gray-50 text-gray-500 border-dashed border-gray-200'
  const suffix = inherited ? (source === 'ws' ? ' · WS' : ' · disc') : ''
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] whitespace-nowrap rounded px-1.5 py-0.5 border ${tone}`}
      title={inherited
        ? `Inherited from ${source === 'ws' ? 'Working Sheet deadline' : 'discipline plan'} · ${days >= 0 ? days + 'd left' : Math.abs(days) + 'd overdue'}`
        : `Plan deadline · ${days >= 0 ? days + 'd left' : Math.abs(days) + 'd overdue'}`}
    >
      <CalendarClock className="h-3 w-3" />
      {formatted}{suffix}
    </span>
  )
}

// ──────────────────────────────────────────────────────────────────────
// ModeCell — toggle a sub-skill between Detailed BOQ and Thumbrule.
// When NULL, inherit from the parent discipline (shown as a soft chip).
// When 'thumbrule', a rate input appears below.
// ──────────────────────────────────────────────────────────────────────
export function SubSkillModeCell({
  projectId,
  subSkillId,
  initialMode,
  initialRate,
  initialNotes,
  inheritedMode,
  canWrite,
}: {
  projectId: string
  subSkillId: string
  initialMode: 'detailed' | 'thumbrule' | null
  initialRate: number | null
  initialNotes: string | null
  /** Mode of the parent discipline — used when no override is set */
  inheritedMode: 'detailed' | 'thumbrule'
  canWrite: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'detailed' | 'thumbrule' | null>(initialMode)
  const [rate, setRate] = useState<string>(initialRate != null ? String(initialRate) : '')
  const [notes, setNotes] = useState<string>(initialNotes ?? '')
  const [pending, startTransition] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  const effective = mode ?? inheritedMode
  const isOverride = initialMode != null

  function save(nextMode: 'detailed' | 'thumbrule' | null) {
    setErr(null)
    startTransition(async () => {
      const rateNum = rate === '' ? null : Number(rate)
      const res = await setSubSkillEstimationMode(
        projectId,
        subSkillId,
        nextMode,
        nextMode === 'thumbrule' ? (Number.isFinite(rateNum as number) ? rateNum : null) : null,
        nextMode === 'thumbrule' ? (notes || null) : null,
      )
      if (!res.ok) { setErr(res.error); return }
      setMode(nextMode)
      setOpen(false)
      router.refresh()
    })
  }

  // One-click switch to detailed BOQ. Used as a prominent CTA when the
  // sub-skill is currently in thumbrule mode and BOQ has become available.
  // Confirms first so the PM understands what changes.
  async function switchToBOQ() {
    setErr(null)
    const ok = await confirm({
      title: 'Switch to detailed BOQ?',
      message:
        'New Working Sheets under this sub-skill will use the full BOQ flow (line items, rate × qty). ' +
        'The thumbrule estimates you already raised stay intact in their version chain — nothing is deleted. ' +
        'You can switch back to Thumbrule anytime.',
      confirmLabel: 'Switch to BOQ',
      danger: false,
    })
    if (!ok) return
    startTransition(async () => {
      const res = await setSubSkillEstimationMode(projectId, subSkillId, 'detailed', null, null)
      if (!res.ok) { setErr(res.error); return }
      setMode('detailed')
      setRate('')
      setNotes('')
      router.refresh()
    })
  }

  if (!canWrite) {
    return <ModeChip mode={effective} override={isOverride} />
  }

  if (!open) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1 group"
          title="Click to change estimation mode"
        >
          <ModeChip mode={effective} override={isOverride} />
          <Pencil className="h-3 w-3 text-gray-300 group-hover:text-blue-600" />
        </button>
        {/* Prominent "Switch to BOQ" appears next to the chip ONLY when
            mode is currently thumbrule. Most PM-friendly placement —
            they don't need to know the popover exists to find this. */}
        {effective === 'thumbrule' && (
          <button
            type="button"
            onClick={switchToBOQ}
            disabled={pending}
            className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-blue-700 hover:text-blue-900 hover:underline disabled:opacity-50"
            title="BOQ is now available — switch this sub-skill to detailed line-item entry"
          >
            {pending ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <ArrowRight className="h-2.5 w-2.5" />}
            Switch to BOQ
          </button>
        )}
      </span>
    )
  }

  return (
    <div className="inline-flex flex-col gap-1.5 bg-white border border-gray-300 rounded-md p-2 shadow-sm min-w-[200px]">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => save('detailed')}
          disabled={pending}
          className={`text-[11px] px-2 py-0.5 rounded border ${effective === 'detailed' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
        >
          Detailed BOQ
        </button>
        <button
          type="button"
          onClick={() => save('thumbrule')}
          disabled={pending}
          className={`text-[11px] px-2 py-0.5 rounded border ${effective === 'thumbrule' ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
        >
          <Ruler className="inline h-3 w-3 mr-0.5" /> Thumbrule
        </button>
      </div>
      {effective === 'thumbrule' && (
        <>
          <input
            type="number"
            inputMode="decimal"
            placeholder="₹/sft"
            value={rate}
            onChange={e => setRate(e.target.value)}
            disabled={pending}
            className="h-7 rounded border border-gray-300 px-1.5 text-[11px] w-full"
          />
          <input
            type="text"
            placeholder="notes (optional)"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            disabled={pending}
            className="h-7 rounded border border-gray-300 px-1.5 text-[11px] w-full"
          />
        </>
      )}
      <div className="flex items-center justify-between gap-1">
        {isOverride && (
          <button
            type="button"
            onClick={() => save(null)}
            disabled={pending}
            className="text-[10px] text-gray-500 hover:text-rose-600 underline"
            title="Clear override and inherit discipline mode"
          >
            clear override
          </button>
        )}
        <div className="flex items-center gap-1 ml-auto">
          {effective === 'thumbrule' && (
            <button
              type="button"
              onClick={() => save('thumbrule')}
              disabled={pending}
              className="h-7 px-2 inline-flex items-center justify-center gap-1 rounded bg-blue-600 text-white text-[11px] hover:bg-blue-700 disabled:opacity-60"
            >
              {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
              Save
            </button>
          )}
          <button
            type="button"
            onClick={() => { setOpen(false); setErr(null); setMode(initialMode); setRate(initialRate != null ? String(initialRate) : ''); setNotes(initialNotes ?? '') }}
            disabled={pending}
            className="h-7 w-7 inline-flex items-center justify-center rounded text-gray-500 hover:bg-gray-100"
            title="Cancel"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {err && <span className="text-[10px] text-rose-700">{err}</span>}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────
// DisableButton — soft-removes a discipline or sub-skill from the project
// view by flipping cc_project_*.is_enabled to false. Past working sheets
// and budget lines stay intact; the row just stops appearing. Re-enable
// from the resumable setup screen.
// ──────────────────────────────────────────────────────────────────────
export function DisableButton({
  projectId,
  disciplineId,
  subSkillId,
  label,
  attachedCount,
  canWrite,
}: {
  projectId: string
  disciplineId?: string
  subSkillId?: string
  /** What to call the thing in the confirm message ("01 Site Pre-lims") */
  label: string
  /** Working-sheet count under this row — surfaced in the warning */
  attachedCount: number
  canWrite: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  if (!canWrite) return null

  async function onClick() {
    setErr(null)
    const what = disciplineId ? 'discipline' : 'sub-skill'
    const lines = [
      `Hide "${label}" from this project's view.`,
      attachedCount > 0
        ? `${attachedCount} working sheet${attachedCount === 1 ? '' : 's'} attached — they stay intact in history, just disappear from this table.`
        : 'Nothing is attached yet.',
      'Re-enable later from the setup wizard.',
    ]
    const ok = await confirm({
      title: `Remove ${what}?`,
      message: lines.join('\n\n'),
      confirmLabel: 'Remove',
      danger: true,
    })
    if (!ok) return
    startTransition(async () => {
      const res = disciplineId
        ? await setDisciplineEnabled(projectId, disciplineId, false)
        : await setSubSkillEnabled(projectId, subSkillId!, false)
      if (!res.ok) { setErr(res.error); return }
      router.refresh()
    })
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="inline-flex items-center justify-center h-6 w-6 rounded text-gray-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-50"
        title={`Remove from this project${attachedCount > 0 ? ` (${attachedCount} WS attached — history kept)` : ''}`}
      >
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <EyeOff className="h-3.5 w-3.5" />}
      </button>
      {err && <span className="text-[10px] text-rose-700">{err}</span>}
    </span>
  )
}

function ModeChip({ mode, override }: { mode: 'detailed' | 'thumbrule'; override: boolean }) {
  if (mode === 'thumbrule') {
    return (
      <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold rounded px-1.5 py-0.5 ${override ? 'bg-amber-100 text-amber-900 border border-amber-300' : 'bg-amber-50 text-amber-800 border border-dashed border-amber-300'}`}
        title={override ? 'Thumbrule (sub-skill override)' : 'Thumbrule (inherited from discipline)'}
      >
        <Ruler className="h-2.5 w-2.5" />TR
      </span>
    )
  }
  return (
    <span className={`inline-flex items-center text-[10px] font-medium rounded px-1.5 py-0.5 ${override ? 'bg-blue-100 text-blue-900 border border-blue-300' : 'bg-gray-50 text-gray-500 border border-dashed border-gray-200'}`}
      title={override ? 'Detailed BOQ (sub-skill override)' : 'Detailed BOQ (inherited)'}
    >
      BOQ
    </span>
  )
}

// ──────────────────────────────────────────────────────────────────────
// InternalEstimateDecision — small ✓ / ✗ next to a sub-skill's Internal
// Estimate. Trustee / Admin only: Accept snapshots the current estimate as
// the approved baseline (used to flag engineer asks above it); Reject marks
// it for management to revise. Everyone else just sees the resulting badge.
// ──────────────────────────────────────────────────────────────────────
export function InternalEstimateDecision({
  projectId, disciplineId, subSkillId, liveAmount, decision, acceptedAmt, canDecide,
}: {
  projectId: string
  disciplineId: string
  subSkillId: string
  liveAmount: number
  decision: 'accepted' | 'rejected' | null
  acceptedAmt: number | null
  canDecide: boolean
}) {
  const router = useRouter()
  const [busy, startTransition] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  function run(d: 'accept' | 'reject' | 'clear') {
    setErr(null)
    startTransition(async () => {
      const res = await setInternalEstimateDecision({
        project_id: projectId, discipline_id: disciplineId, sub_skill_id: subSkillId,
        decision: d, amount: d === 'accept' ? liveAmount : null,
      })
      if (!res.ok) { setErr(res.error || 'Could not save'); return }
      router.refresh()
    })
  }

  const rupee = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

  if (decision === 'accepted') {
    return (
      <span className="inline-flex items-center gap-1" title={acceptedAmt != null ? `Accepted at ${rupee(acceptedAmt)}` : 'Accepted'}>
        <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-green-700 bg-green-100 rounded-full px-1.5 py-0.5">
          <Check className="h-3 w-3" /> Accepted
        </span>
        {canDecide && !busy && (
          <button onClick={() => run('clear')} className="text-[10px] text-gray-400 hover:text-gray-600 underline">undo</button>
        )}
      </span>
    )
  }
  if (decision === 'rejected') {
    return (
      <span className="inline-flex items-center gap-1">
        <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-rose-700 bg-rose-100 rounded-full px-1.5 py-0.5">
          <X className="h-3 w-3" /> Rejected
        </span>
        {canDecide && !busy && (
          <button onClick={() => run('accept')} className="text-[10px] text-green-700 hover:underline">accept</button>
        )}
      </span>
    )
  }
  if (!canDecide) return null
  return (
    <span className="inline-flex items-center gap-1">
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />
      ) : (
        <>
          <button onClick={() => run('accept')} title="Accept this Internal Estimate as the approved baseline"
            className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-green-300 text-green-600 hover:bg-green-50">
            <Check className="h-3 w-3" />
          </button>
          <button onClick={() => run('reject')} title="Reject this Internal Estimate"
            className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-rose-300 text-rose-600 hover:bg-rose-50">
            <X className="h-3 w-3" />
          </button>
        </>
      )}
      {err && <span className="text-[10px] text-rose-600" title={err}>!</span>}
    </span>
  )
}
