'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Check, Loader2, MapPin, Pencil } from 'lucide-react'
import { saveProjectDesk } from '@/app/actions/bills-desk'
import type { Booking, DeskRow, Person } from '@/lib/bills-booking/booking'

/** Where this bill books — shown as facts, and fixable on the spot.
 *
 *  IN4 answers this for 24 of the 54 sub-projects that have work orders. The
 *  other 30 — Staff Facilities Block, Raj Uphaar, the Warehouse, Raj Saurabh —
 *  have no CT Hub project at all, and they carry most of the money. Aksha, 14
 *  Sep 2026: "if any missing project in CT then u can make an individual in
 *  Bills Approval for approving and assigning the Atm head."
 *
 *  So the gap is shown right here rather than hidden behind a disabled button
 *  or a dropdown that cannot hold the right answer. An admin sets the desk once
 *  — from this panel, without leaving the half-typed bill — and every bill on
 *  that sub-project afterwards resolves silently. */
export function DeskPanel({ booking, gaps, projects, people, canAdmin, onSaved }: {
  booking: Booking
  gaps: string[]
  projects: Array<{ id: string; code?: string; name: string }>
  people: Person[]
  canAdmin: boolean
  onSaved: (desk: DeskRow) => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [pid, setPid] = useState(booking.projectId ?? '')
  const [hid, setHid] = useState('')

  if (booking.subprojectId == null) return null

  async function save() {
    setBusy(true); setErr(null)
    const r = await saveProjectDesk({
      subprojectId: booking.subprojectId!,
      ccProjectId: pid || null,
      atmHeadId: hid || null,
    })
    setBusy(false)
    if (!r.ok) { setErr(r.error ?? 'Could not save.'); return }
    onSaved({
      subproject_id: booking.subprojectId!,
      in4_name: booking.subprojectName,
      cc_project_id: pid || null,
      atm_head_id: hid || null,
      note: null,
    })
    setOpen(false)
  }

  const settled = gaps.length === 0
  const sel = 'h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm mt-1'

  return (
    <div className={`mt-3 rounded-lg border p-3 ${settled ? 'border-gray-200 bg-gray-50' : 'border-amber-300 bg-amber-50'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-700">
            <MapPin className="h-3.5 w-3.5" /> Where this books
          </div>
          <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-2 text-xs sm:grid-cols-2">
            <Fact k="IN4 sub-project" v={booking.subprojectName ?? '—'} />
            <Fact
              k="CT Hub project"
              v={booking.projectName ?? 'none — CT Hub has no project for this'}
              note={booking.projectSource === 'in4' ? 'mapped in IN4' : booking.projectSource === 'desk' ? 'set here' : undefined}
              missing={!booking.projectId}
            />
            <Fact
              k="Atm Head"
              v={booking.atmHeads.length ? booking.atmHeads.map(p => p.name).join(', ') : 'nobody assigned yet'}
              note={booking.atmSource === 'project' ? 'from Cost Control' : booking.atmSource === 'desk' ? 'set here' : undefined}
              missing={!booking.atmHeads.length}
            />
            <Fact
              k="Category"
              v={booking.disciplineName ?? booking.categoryIn4 ?? '—'}
              note={booking.disciplineName ? undefined : booking.categoryIn4 ? 'IN4 category, no CT Hub match' : undefined}
            />
          </dl>
          {booking.scope && (
            <p className="mt-2 text-xs text-gray-600">
              <span className="text-gray-500">Scope: </span>{booking.scope}
            </p>
          )}
        </div>

        {canAdmin && !open && (
          <button type="button" onClick={() => setOpen(true)}
                  className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-indigo-700 hover:text-indigo-900 min-h-[32px]">
            <Pencil className="h-3.5 w-3.5" /> {booking.hasDesk ? 'Change' : 'Set'}
          </button>
        )}
      </div>

      {!settled && !open && (
        <p className="mt-2 text-[11px] text-amber-900">
          {gaps.join(' and ')}. The bill can still be entered — it is recorded against{' '}
          <b>{booking.subprojectName}</b> and shows up on{' '}
          <Link href="/bills-booking/mapping" className="underline">Where bills book</Link> until this is set.
        </p>
      )}

      {open && (
        <div className="mt-3 border-t border-gray-200 pt-3">
          {err && <p role="alert" className="mb-2 text-xs text-rose-700">{err}</p>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="dp">CT Hub project</Label>
              <select id="dp" value={pid} onChange={e => setPid(e.target.value)} className={sel}
                      disabled={booking.projectSource === 'in4'}>
                <option value="">— none, this building is not in CT Hub —</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.code ? `${p.code} — ` : ''}{p.name}</option>)}
              </select>
              {booking.projectSource === 'in4' && (
                <p className="mt-1 text-[11px] text-gray-500">IN4 maps this one already, so it is not changed here.</p>
              )}
            </div>
            <div>
              <Label htmlFor="dh">Atm Head</Label>
              <select id="dh" value={hid} onChange={e => setHid(e.target.value)} className={sel}>
                <option value="">
                  {booking.atmSource === 'project'
                    ? `— keep ${booking.atmHeads.map(p => p.name).join(', ')} from Cost Control —`
                    : '— nobody yet —'}
                </option>
                {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Button onClick={save} disabled={busy} className="bg-indigo-600 hover:bg-indigo-700">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Save for every bill on this sub-project
            </Button>
            <button type="button" onClick={() => setOpen(false)}
                    className="text-xs font-semibold text-gray-600 hover:text-gray-900 min-h-[32px]">Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}

function Fact({ k, v, note, missing }: { k: string; v: string; note?: string; missing?: boolean }) {
  return (
    <div>
      <dt className="text-gray-500">{k}</dt>
      <dd className={missing ? 'font-medium text-amber-900' : 'font-medium text-gray-900'}>
        {v}
        {note && <span className="ml-1 font-normal text-[10.5px] text-gray-500">({note})</span>}
      </dd>
    </div>
  )
}
