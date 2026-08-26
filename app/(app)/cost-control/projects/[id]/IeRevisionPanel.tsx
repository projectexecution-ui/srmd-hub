'use client'
// Internal Estimate lock + revision workflow, shown on the project page.
// States: locked → (Atm/PH) request reopen → (Trustee) approve/deny →
// (Atm/PH) upload revised Excel → (Trustee) approve (re-import) / reject.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Lock, LockOpen, Loader2, Upload, Check, X, RotateCcw } from 'lucide-react'
import { confirm } from '@/components/ui/confirm-dialog'
import {
  requestIeReopen, decideIeReopen, submitIeRevision, rejectIeRevision,
} from './ie-revision-actions'

export interface IeRevision {
  id: string
  status: string
  request_note: string | null
  requested_by_name: string | null
  reopen_note: string | null
  revised_excel_name: string | null
  decision_note: string | null
}

export function IeRevisionPanel({
  projectId, lockState, revision, canRequest, canDecide,
}: {
  projectId: string
  lockState: 'locked' | 'reopen_requested' | 'unlocked' | 'revision_submitted'
  revision: IeRevision | null
  canRequest: boolean   // Atm Head / Project Head / Admin
  canDecide: boolean    // Trustee / Admin
}) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [showLocked, setShowLocked] = useState(false)

  const wrap = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setErr(null)
    start(async () => {
      const r = await fn()
      if (!r.ok) { setErr(r.error || 'Failed'); return }
      router.refresh()
    })
  }

  async function onUpload(file: File) {
    if (!revision) return
    setErr(null); setUploading(true)
    try {
      const supabase = createClient()
      const safe = file.name.replace(/[^A-Za-z0-9._-]/g, '_')
      const path = `${projectId}/ie-rev-${Date.now()}-${safe}`
      const { error: upErr } = await supabase.storage.from('cc-sheets').upload(path, file, { upsert: false })
      if (upErr) { setErr(`Upload failed: ${upErr.message}`); setUploading(false); return }
      const r = await submitIeRevision(projectId, revision.id, path, file.name)
      if (!r.ok) { setErr(r.error || 'Failed'); setUploading(false); return }
      router.refresh()
    } finally { setUploading(false) }
  }

  async function onApprove() {
    if (!revision) return
    const ok = await confirm({
      title: 'Approve the revised Internal Budget?',
      message: 'The current Internal Estimate sheets will be archived and replaced with the numbers from the revised Excel. This is reversible (old sheets are archived, not deleted).',
      confirmLabel: 'Approve & re-import',
      danger: false,
    })
    if (!ok) return
    setErr(null); start(async () => {
      const res = await fetch(`/cost-control/projects/${projectId}/ie-revision/approve`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ revision_id: revision.id }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j.ok) { setErr(j.reason || 'Re-import failed'); return }
      router.refresh()
    })
  }

  // Visual state
  const locked = lockState === 'locked'
  const Chip = (
    <span className={`inline-flex items-center gap-1 rounded-full text-[10px] font-bold px-2 py-0.5 ${
      locked ? 'bg-gray-200 text-gray-700' : 'bg-amber-100 text-amber-800'
    }`}>
      {locked ? <Lock className="h-3 w-3" /> : <LockOpen className="h-3 w-3" />}
      {locked ? 'Internal Estimate — LOCKED' :
        lockState === 'reopen_requested' ? 'Reopen requested' :
        lockState === 'unlocked' ? 'Reopen approved — upload revised sheet' :
        'Revision under Trustee review'}
    </span>
  )

  // LOCKED is the resting state — nothing is happening and nobody is waiting.
  // It was taking a full-width card, an explanatory sentence and a large blue
  // button for an action taken maybe once a project, right at the top of the
  // screen. Collapsed to a lock chip; one tap gives back the sentence and the
  // action. Every other state IS in flight, so those stay open.
  if (locked) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setShowLocked(v => !v)}
          aria-expanded={showLocked}
          title="The Internal Estimate is a fixed baseline; changing it needs Trustee approval"
          className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-full border border-gray-200 bg-white text-[11px] font-bold text-gray-600 hover:bg-gray-50"
        >
          <Lock className="h-3 w-3" /> Estimate locked
          <span className="text-[10px] font-normal opacity-50">{showLocked ? '×' : '›'}</span>
        </button>
        {showLocked && (
          <div className="mt-2 rounded-lg border border-gray-200 bg-white px-3 py-2.5">
            <p className="text-xs text-gray-500">
              The estimate is a fixed baseline; changing it needs Trustee approval.
            </p>
            {canRequest && (
              <button
                onClick={() => wrap(() => requestIeReopen(projectId, null))}
                disabled={busy}
                className="mt-2 inline-flex items-center gap-1.5 min-h-[38px] px-3 rounded-md bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                Request to revise Internal Estimate
              </button>
            )}
            {err && <p className="mt-1.5 text-xs text-rose-700">{err}</p>}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 space-y-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="inline-flex items-center gap-2">
          {Chip}
          <span className="text-xs text-gray-500">The estimate is a fixed baseline; changing it needs Trustee approval.</span>
        </div>
        {busy && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
      </div>

      {/* REOPEN REQUESTED → Trustee approves / denies */}
      {lockState === 'reopen_requested' && (
        <div className="text-xs text-gray-600">
          {revision?.requested_by_name && <p>Requested by <b>{revision.requested_by_name}</b>{revision.request_note ? ` — “${revision.request_note}”` : ''}.</p>}
          {canDecide ? (
            <div className="mt-2 inline-flex gap-2">
              <button onClick={() => wrap(() => decideIeReopen(projectId, revision!.id, true, null))} disabled={busy}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-green-600 text-white text-xs font-semibold hover:bg-green-700">
                <Check className="h-3.5 w-3.5" /> Approve reopen
              </button>
              <button onClick={() => wrap(() => decideIeReopen(projectId, revision!.id, false, null))} disabled={busy}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-white border border-rose-300 text-rose-700 text-xs font-semibold hover:bg-rose-50">
                <X className="h-3.5 w-3.5" /> Deny
              </button>
            </div>
          ) : <p className="mt-1 text-gray-400">Waiting for the Trustee to approve the reopen.</p>}
        </div>
      )}

      {/* UNLOCKED → Atm/PH upload revised Excel */}
      {lockState === 'unlocked' && (
        canRequest ? (
          <label className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 cursor-pointer">
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            Upload revised Internal Budget (.xlsx)
            <input type="file" accept=".xlsx,.xls" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(f) }} disabled={uploading} />
          </label>
        ) : <p className="text-xs text-gray-400">Reopen approved — waiting for the Atm/Project Head to upload the revised sheet.</p>
      )}

      {/* SUBMITTED → Trustee reviews + approves (re-import) / rejects */}
      {lockState === 'revision_submitted' && (
        <div className="text-xs text-gray-600">
          <p>Revised sheet <b>{revision?.revised_excel_name ?? 'uploaded'}</b> awaiting the Trustee.</p>
          {canDecide ? (
            <div className="mt-2 inline-flex gap-2">
              <button onClick={onApprove} disabled={busy}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-green-600 text-white text-xs font-semibold hover:bg-green-700">
                <Check className="h-3.5 w-3.5" /> Approve & re-import
              </button>
              <button onClick={() => wrap(() => rejectIeRevision(projectId, revision!.id, null))} disabled={busy}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-white border border-rose-300 text-rose-700 text-xs font-semibold hover:bg-rose-50">
                <X className="h-3.5 w-3.5" /> Reject
              </button>
            </div>
          ) : <p className="mt-1 text-gray-400">Waiting for the Trustee to review the revised sheet.</p>}
        </div>
      )}

      {err && <p className="text-xs text-rose-700">{err}</p>}
    </div>
  )
}
