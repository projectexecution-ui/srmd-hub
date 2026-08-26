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

  const reset = () => { setOpen(false); setCreating(false); setPick(''); setCode(''); setName(''); setErr(null) }

  const submit = () => {
    setErr(null)
    if (!creating && !pick) { setErr(`Choose a ${what}, or create a new one`); return }
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
        onClick={() => setOpen(true)}
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
    <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-3 space-y-2 max-w-md">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] font-bold text-blue-900">Add a {what}</p>
        <button type="button" onClick={reset} className="text-blue-700/60 hover:text-blue-900" aria-label="Cancel">
          <X className="h-4 w-4" />
        </button>
      </div>

      {!creating ? (
        <>
          {available.length > 0 ? (
            <select
              value={pick}
              onChange={e => setPick(e.target.value)}
              className="w-full min-h-[44px] rounded-md border border-gray-300 bg-white px-2 text-[13px]"
            >
              <option value="">Choose from the existing list…</option>
              {available.map(o => (
                <option key={o.id} value={o.id}>{o.code} {o.name}</option>
              ))}
            </select>
          ) : (
            <p className="text-[12px] text-blue-900">
              Every {what} in the list is already on this project. Create a new one below.
            </p>
          )}
          <button
            type="button"
            onClick={() => { setCreating(true); setPick(''); setErr(null) }}
            className="text-[12px] font-semibold text-blue-700 hover:underline"
          >
            + Create a new {what} instead
          </button>
        </>
      ) : (
        <>
          <div className="flex gap-2">
            <input
              value={code} onChange={e => setCode(e.target.value)}
              placeholder="Code" inputMode="numeric"
              className="w-24 min-h-[44px] rounded-md border border-gray-300 px-2 text-[13px]"
            />
            <input
              value={name} onChange={e => setName(e.target.value)}
              placeholder={kind === 'discipline' ? 'e.g. Solar Works' : 'e.g. Panel Mounting'}
              className="flex-1 min-w-0 min-h-[44px] rounded-md border border-gray-300 px-2 text-[13px]"
            />
          </div>
          {/* Said out loud because it is the surprising part: the code is not
              private to this project. */}
          <p className="text-[11px] text-blue-800/80">
            This code is added to the shared list, so every project can use it. Keep the numbering consistent
            with the master budget.
          </p>
          {available.length > 0 && (
            <button
              type="button"
              onClick={() => { setCreating(false); setCode(''); setName(''); setErr(null) }}
              className="text-[12px] font-semibold text-blue-700 hover:underline"
            >
              ← Pick from the existing list instead
            </button>
          )}
        </>
      )}

      {err && <p className="text-[12px] font-semibold text-rose-700">{err}</p>}

      <button
        type="button" onClick={submit} disabled={busy}
        className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-4 rounded-lg bg-blue-600 text-white text-[13px] font-semibold disabled:opacity-50 w-full sm:w-auto"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        Add to this project
      </button>
    </div>
  )
}
