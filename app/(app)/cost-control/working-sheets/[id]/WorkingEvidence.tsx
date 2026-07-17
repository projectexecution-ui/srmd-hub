'use client'
// Working & evidence panel (cc_cumulative_versions). Lists the working files
// behind a sheet's quantities and — for the owner while the sheet is still
// editable — lets them attach measurement sheets / backups. At least one is
// required before the sheet can be submitted (enforced server-side in
// cc_submit_working_sheet when the flag is on).

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Paperclip, Upload, X, Loader2, AlertTriangle, FileText } from 'lucide-react'
import { confirm } from '@/components/ui/confirm-dialog'

export interface EvidenceFile {
  id: string
  name: string
  signedUrl: string | null
}

interface Props {
  wsId: string
  projectId: string
  canUpload: boolean
  /** Show the "required before submitting" nudge (owner + editable). */
  showRequirement: boolean
  initial: EvidenceFile[]
}

export function WorkingEvidence({ wsId, projectId, canUpload, showRequirement, initial }: Props) {
  const router = useRouter()
  const [files] = React.useState<EvidenceFile[]>(initial)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (picked.length === 0) return
    setBusy(true); setError(null)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setError('Not signed in'); setBusy(false); return }
    try {
      for (const f of picked) {
        if (f.size > 25 * 1024 * 1024) { setError(`${f.name} is over 25 MB`); continue }
        const ts = Date.now()
        const safe = f.name.replace(/[^A-Za-z0-9._-]/g, '_')
        const path = `${projectId}/${ts}-working-${safe}`
        const { error: upErr } = await supabase.storage.from('cc-sheets').upload(path, f, {
          cacheControl: '3600', upsert: false, contentType: f.type || 'application/octet-stream',
        })
        if (upErr) { setError(`Upload failed: ${upErr.message}`); continue }
        const { error: insErr } = await supabase.from('cc_ws_attachments').insert({
          working_sheet_id: wsId, path, name: f.name, kind: 'working', uploaded_by: user.id,
        })
        if (insErr) { setError(`Save failed: ${insErr.message}`); continue }
      }
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  async function remove(file: EvidenceFile) {
    const ok = await confirm({
      title: 'Remove this working file?',
      message: `"${file.name}" will be removed from this sheet.`,
      danger: true, confirmLabel: 'Remove',
    })
    if (!ok) return
    setBusy(true); setError(null)
    const supabase = createClient()
    const { error: delErr } = await supabase.from('cc_ws_attachments').delete().eq('id', file.id)
    setBusy(false)
    if (delErr) { setError(delErr.message); return }
    router.refresh()
  }

  const needsOne = showRequirement && files.length === 0

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-2 bg-gray-50 border-b border-gray-100">
        <p className="text-xs font-bold uppercase tracking-wide text-gray-600 inline-flex items-center gap-1.5">
          <Paperclip className="h-3.5 w-3.5" /> Working &amp; evidence
        </p>
        <span className="text-[11px] text-gray-500">{files.length} file{files.length === 1 ? '' : 's'}</span>
      </div>

      <div className="p-3 space-y-2">
        {error && <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1">{error}</p>}

        {needsOne && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-amber-800">
              Attach at least one working file (the measurement sheet / takeoff behind these quantities)
              before submitting for approval.
            </p>
          </div>
        )}

        {files.length === 0 && !needsOne && (
          <p className="text-xs text-gray-500">No working files attached.</p>
        )}

        {files.length > 0 && (
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100">
            {files.map(f => (
              <li key={f.id} className="flex items-center gap-3 px-3 py-2">
                <FileText className="h-4 w-4 text-gray-400 flex-shrink-0" />
                <span className="text-sm text-gray-800 truncate flex-1">{f.name}</span>
                {f.signedUrl && (
                  <a href={f.signedUrl} target="_blank" rel="noreferrer"
                    className="text-[11px] font-semibold text-indigo-700 hover:underline flex-shrink-0">
                    Download ↗
                  </a>
                )}
                {canUpload && (
                  <button type="button" onClick={() => remove(f)} disabled={busy}
                    className="text-rose-600 hover:bg-rose-50 rounded p-1 flex-shrink-0" title="Remove">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {canUpload && (
          <label className="mt-1 flex items-center justify-center gap-2 border-2 border-dashed border-gray-300 rounded-lg py-3 text-sm text-gray-500 hover:bg-gray-50 cursor-pointer">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            <span>{busy ? 'Uploading…' : 'Attach working file(s) — Excel, PDF, image'}</span>
            <input type="file" multiple className="hidden" onChange={onPick} disabled={busy}
              accept=".xls,.xlsx,.pdf,.png,.jpg,.jpeg,.csv" />
          </label>
        )}
      </div>
    </div>
  )
}
