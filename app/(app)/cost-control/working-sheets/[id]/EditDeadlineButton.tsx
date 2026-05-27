'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { setWorkingSheetDeadline } from '@/components/cost-control/ws-actions'
import { Button } from '@/components/ui/button'
import { CalendarClock, Loader2, X } from 'lucide-react'

export function EditDeadlineButton({
  wsId, initialDate, initialNotes,
}: {
  wsId: string
  initialDate: string | null
  initialNotes: string | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(initialDate ?? '')
  const [notes, setNotes] = useState(initialNotes ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    setBusy(true); setErr(null)
    const r = await setWorkingSheetDeadline(wsId, date || null, notes || null)
    setBusy(false)
    if (!r.ok) { setErr(r.error ?? 'Save failed'); return }
    setOpen(false)
    router.refresh()
  }

  async function clear() {
    setBusy(true); setErr(null)
    const r = await setWorkingSheetDeadline(wsId, null, null)
    setBusy(false)
    if (!r.ok) { setErr(r.error ?? 'Clear failed'); return }
    setDate(''); setNotes('')
    setOpen(false)
    router.refresh()
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <CalendarClock className="h-4 w-4" />
        {initialDate ? 'Edit deadline' : 'Set deadline'}
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-3">
              <h3 className="text-base font-bold text-gray-900 inline-flex items-center gap-2">
                <CalendarClock className="h-4 w-4 text-blue-600" />
                {initialDate ? 'Change deadline' : 'Set deadline'}
              </h3>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600">
                <X className="h-4 w-4" />
              </button>
            </div>

            {err && <p className="mb-3 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{err}</p>}

            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-gray-700">Deadline date</label>
                <input type="date" value={date} onChange={e => setDate(e.target.value)}
                  className="mt-1 flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700">Notes</label>
                <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
                  placeholder="optional — context for the deadline"
                  className="mt-1 flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm" />
              </div>
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              {initialDate && (
                <Button variant="ghost" size="sm" disabled={busy} onClick={clear} className="text-rose-700 hover:bg-rose-50">
                  Clear
                </Button>
              )}
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" disabled={busy || !date} onClick={save}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                Save
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
