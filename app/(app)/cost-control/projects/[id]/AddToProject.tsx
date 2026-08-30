'use client'
// "Add work category" / "Add sub-category" on the project view — the HOD's
// point 6. Until now this meant leaving for the setup wizard (which can only
// PICK from the master list) or the disciplines admin (which is a
// portfolio-wide screen, and admin-only).
//
// One control, two jobs, because they are the same decision from the reader's
// side: most of the time the code already exists somewhere in the shared master
// list and just is not switched on for THIS project; occasionally it is
// genuinely new. Picking is the default and creating is one tap away, so the
// easy path does not encourage minting duplicate codes.
//
// Layout note, because it bit: the panel used `space-y-2` around children that
// are inline-level (<button> is inline-block). space-y only separates BLOCK
// siblings, so the "create a new one instead" link and the blue submit button
// flowed onto the same line and overlapped each other. Everything here is now
// an explicit flex column, and the two actions live in their own row where they
// cannot collide.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { addDisciplineToProject, addSubSkillToProject } from './add-to-project-actions'

export interface MasterOption { id: string; code: string; name: string }

export function AddToProject({
  projectId, disciplineId, available, kind, size = 'normal',
}: {
  projectId: string
  /** Required for kind="sub" — which category the sub-category hangs under. */
  disciplineId?: string
  /** Master items NOT yet on this project. May be empty — then only "create new". */
  available: MasterOption[]
  kind: 'discipline' | 'sub'
  size?: 'normal' | 'small'
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [pick, setPick] = useState('')
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, start] = useTransition()

  const what = kind === 'discipline' ? 'work category' : 'sub-category'
  const nothingLeft = available.length === 0

  const reset = () => { setOpen(false); setCreating(false); setPick(''); setCode(''); setName(''); setErr(null) }

  const submit = () => {
    setErr(null)
    if (!creating && !pick) { setErr(`Choose a ${what} from the list, or create a new one`); return }
    if (creating && !code.trim()) { setErr('Give it a code — the number from the master budget'); return }
    if (creating && !name.trim()) { setErr('Give it a name'); return }
    start(async () => {
      const r = kind === 'discipline'
        ? await addDisciplineToProject(projectId, creating ? null : pick, creating ? code : null, creating ? name : null)
        : await addSubSkillToProject(projectId, disciplineId!, creating ? null : pick, creating ? code : null, creating ? name : null)
      if (!r.ok) { setErr(r.error); return }
      toast.success(creating ? `${code} ${name} added` : `${what} added`)
      reset()
      router.refresh()
    })
  }

  if (!open) {
    return (
      <button
        type="button"
        // Nothing left to pick means the only useful path is creating, so open
        // straight into it rather than showing an empty dropdown.
        onClick={() => { setOpen(true); setCreating(nothingLeft) }}
        className={size === 'small'
          ? 'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold border border-dashed border-gray-300 text-gray-600 hover:border-blue-300 hover:text-blue-700 whitespace-nowrap'
          : 'inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3 rounded-lg text-[13px] font-semibold border border-dashed border-gray-300 text-gray-700 hover:border-blue-400 hover:text-blue-700 w-full sm:w-auto'}
      >
        <Plus className={size === 'small' ? 'h-3 w-3' : 'h-4 w-4'} />
        Add {what}
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-blue-200 bg-blue-50/60 p-3 w-full max-w-md">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] font-bold text-blue-900">
          {creating ? `Create a new ${what}` : `Add a ${what}`}
        </p>
        <button
          type="button" onClick={reset}
          className="inline-flex items-center justify-center h-7 w-7 -mr-1 rounded text-blue-700/60 hover:bg-blue-100 hover:text-blue-900"
          aria-label="Cancel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {!creating ? (
        nothingLeft ? (
          <p className="text-[12px] text-blue-900">
            Every {what} in the shared list is already on this project.
          </p>
        ) : (
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-blue-900/80">
              Pick from the shared list · {available.length} not yet on this project
            </span>
            <select
              value={pick}
              onChange={e => { setPick(e.target.value); setErr(null) }}
              className="w-full min-h-[44px] rounded-md border border-gray-300 bg-white px-2 text-[13px]"
            >
              <option value="">Choose one…</option>
              {available.map(o => (
                <option key={o.id} value={o.id}>{o.code} {o.name}</option>
              ))}
            </select>
          </label>
        )
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <label className="flex flex-col gap-1 w-24 flex-shrink-0">
              <span className="text-[11px] font-semibold text-blue-900/80">Code</span>
              <input
                value={code} onChange={e => { setCode(e.target.value); setErr(null) }}
                placeholder={kind === 'discipline' ? '21' : '2104'} inputMode="numeric"
                className="w-full min-h-[44px] rounded-md border border-gray-300 bg-white px-2 text-[13px]"
              />
            </label>
            <label className="flex flex-col gap-1 flex-1 min-w-0">
              <span className="text-[11px] font-semibold text-blue-900/80">Name</span>
              <input
                value={name} onChange={e => { setName(e.target.value); setErr(null) }}
                placeholder={kind === 'discipline' ? 'e.g. Solar Works' : 'e.g. Panel Mounting'}
                className="w-full min-h-[44px] rounded-md border border-gray-300 bg-white px-2 text-[13px]"
              />
            </label>
          </div>
          {/* Said out loud because it is the surprising part: the code is not
              private to this project. */}
          <p className="text-[11px] text-blue-800/80">
            This code joins the shared list, so every project can use it. Keep the numbering consistent
            with the master budget.
          </p>
        </div>
      )}

      {err && <p className="text-[12px] font-semibold text-rose-700">{err}</p>}

      {/* The two actions, in a row of their own. The primary is last on a phone
          (stacked, full width) and right on a wider screen. */}
      <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2 pt-1">
        {creating ? (
          nothingLeft ? <span className="hidden sm:block" /> : (
            <button
              type="button"
              onClick={() => { setCreating(false); setCode(''); setName(''); setErr(null) }}
              className="text-[12px] font-semibold text-blue-700 hover:underline text-left"
            >
              ← Pick from the list instead
            </button>
          )
        ) : (
          <button
            type="button"
            onClick={() => { setCreating(true); setPick(''); setErr(null) }}
            className="text-[12px] font-semibold text-blue-700 hover:underline text-left"
          >
            + Create a new {what} instead
          </button>
        )}

        <button
          type="button" onClick={submit} disabled={busy}
          className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-semibold disabled:opacity-50 w-full sm:w-auto flex-shrink-0"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          {creating ? 'Create and add' : 'Add to this project'}
        </button>
      </div>
    </div>
  )
}
