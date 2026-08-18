'use client'
// Approval records panel — lets an approver (Atm Head / management) attach any
// file "for record" while reviewing or approving a sheet, even after it's
// submitted. Separate from the owner's WorkingEvidence (measurement backups):
// these are the approver's own supporting documents. Upload/delete go through
// /api/cost-control/working-sheets/[id]/approval-attachment (service role behind
// a reviewer gate), since an Atm Head isn't a cc-edit member.

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { FileCheck2, Upload, X, Loader2, FileText } from 'lucide-react'
import { confirm } from '@/components/ui/confirm-dialog'
import { toast } from 'sonner'

export interface RecordFile {
  id: string
  name: string
  signedUrl: string | null
}

export function ApprovalRecords({
  wsId, canManage, initial,
}: {
  wsId: string
  canManage: boolean
  initial: RecordFile[]
}) {
  const router = useRouter()
  const [busy, setBusy] = React.useState(false)

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (picked.length === 0) return
    setBusy(true)
    try {
      const form = new FormData()
      for (const f of picked) form.append('files', f)
      const res = await fetch(`/api/cost-control/working-sheets/${wsId}/approval-attachment`, {
        method: 'POST', body: form,
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || j.ok === false) { toast.error(j.error || 'Upload failed'); return }
      toast.success(`Attached ${picked.length} file${picked.length === 1 ? '' : 's'} for record`)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed')
    } finally { setBusy(false) }
  }

  async function remove(att: RecordFile) {
    const ok = await confirm({
      title: 'Remove this record?',
      message: `Remove "${att.name}" from this sheet's approval records?`,
      confirmLabel: 'Remove', danger: true,
    })
    if (!ok) return
    setBusy(true)
    try {
      const res = await fetch(`/api/cost-control/working-sheets/${wsId}/approval-attachment?attId=${att.id}`, {
        method: 'DELETE',
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || j.ok === false) { toast.error(j.error || 'Could not remove'); return }
      router.refresh()
    } finally { setBusy(false) }
  }

  // Nothing to attach and nothing attached, and not a manager → render nothing.
  if (!canManage && initial.length === 0) return null

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="text-sm font-semibold text-gray-900 inline-flex items-center gap-2">
          <FileCheck2 className="h-4 w-4 text-emerald-600" /> Approval records
        </h3>
        {canManage && (
          <label className="inline-flex">
            <input type="file" multiple className="hidden" onChange={onPick} disabled={busy} />
            <span className={`inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold cursor-pointer ${busy ? 'text-gray-400' : 'text-emerald-700 hover:bg-emerald-50'}`}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Attach file
            </span>
          </label>
        )}
      </div>
      <p className="text-[11px] text-gray-500 mb-2">
        Attach any supporting file for record (approval note, sanction letter, email, sketch). Up to 25 MB each.
      </p>
      {initial.length === 0 ? (
        <p className="text-xs text-gray-400 italic">No records attached yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {initial.map(a => (
            <li key={a.id} className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2">
              {a.signedUrl
                ? <a href={a.signedUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm text-blue-700 hover:underline min-w-0">
                    <FileText className="h-4 w-4 flex-shrink-0" /> <span className="truncate">{a.name}</span>
                  </a>
                : <span className="inline-flex items-center gap-2 text-sm text-gray-600 min-w-0">
                    <FileText className="h-4 w-4 flex-shrink-0" /> <span className="truncate">{a.name}</span>
                  </span>}
              {canManage && (
                <button onClick={() => remove(a)} disabled={busy} title="Remove" className="text-gray-400 hover:text-rose-600 flex-shrink-0">
                  <X className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
