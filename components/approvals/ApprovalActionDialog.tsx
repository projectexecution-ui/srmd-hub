'use client'
// Universal "Approve / Reject" dialog used by every module.
// Reads the matching approval_rule to know if a comment / attachment is
// required, shows the right inputs, uploads any attachments to the
// approval-attachments storage bucket, then calls record_approval_event
// to persist the decision + (optional) calls a module-specific RPC the
// caller passes in via onConfirm.
//
// Usage:
//
//   <ApprovalActionDialog
//     open={open}
//     onClose={() => setOpen(false)}
//     decision="approved"
//     module="inventory"
//     docType="inv_request"
//     docTable="inv_requests"
//     docId={request.id}
//     docLabel={request.request_no}
//     fromStage="PENDING_BACKOFFICE"
//     toStage="PENDING_HOP"
//     onConfirm={async ({ comment, attachments }) => {
//       // Module-specific status change, e.g. inv_rpc_backoffice_approve
//       await supabase.rpc('inv_rpc_backoffice_approve', {
//         p_request_id: request.id,
//         p_approved_items: items,
//         p_remarks: comment ?? null,
//       })
//     }}
//   />

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Loader2, Check, X, Paperclip, ShieldCheck, MessageSquare, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ApprovalDecision = 'approved' | 'rejected' | 'returned'

export interface ApprovalAttachment {
  name: string
  url: string       // public/signed URL for display
  path: string      // storage path so we can revoke if needed
  size: number
  type: string
}

interface Props {
  open: boolean
  onClose: () => void
  decision: ApprovalDecision
  module: string         // module_slug, e.g. 'inventory'
  docType: string        // doc_type, e.g. 'inv_request'
  docTable: string       // physical table, e.g. 'inv_requests'
  docId: string
  docLabel?: string      // human label shown in the dialog
  fromStage: string
  toStage: string
  amount?: number | null // for amount_cap_max rules
  /** Caller does the module-specific state change here (RPC / UPDATE).
   *  The dialog records the approval_event before/after this — see logic below.
   *  Throw to abort. */
  onConfirm: (ctx: { comment: string | null; attachments: ApprovalAttachment[] }) => Promise<void>
}

interface RuleConfig {
  requires_remarks: boolean
  requires_attachment: boolean
}

export function ApprovalActionDialog({
  open, onClose, decision, module, docType, docTable, docId, docLabel,
  fromStage, toStage, amount, onConfirm,
}: Props) {
  const supabase = createClient()
  const [rule, setRule] = useState<RuleConfig | null>(null)
  const [loadingRule, setLoadingRule] = useState(true)
  const [comment, setComment] = useState('')
  const [attachments, setAttachments] = useState<ApprovalAttachment[]>([])
  const [uploading, setUploading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setLoadingRule(true)
    void (async () => {
      const { data } = await supabase
        .from('approval_rules')
        .select('requires_remarks, requires_attachment')
        .eq('module_slug', module)
        .eq('doc_type', docType)
        .eq('from_stage', fromStage)
        .eq('to_stage', toStage)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle()
      setRule({
        requires_remarks: !!data?.requires_remarks,
        requires_attachment: !!data?.requires_attachment,
      })
      setLoadingRule(false)
    })()
  }, [open, module, docType, fromStage, toStage, supabase])

  // Reset state when closed
  useEffect(() => {
    if (!open) {
      setComment(''); setAttachments([])
      setError(null); setBusy(false); setUploading(false)
    }
  }, [open])

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploading(true); setError(null)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setError('Not signed in'); setUploading(false); return }
    const newOnes: ApprovalAttachment[] = []
    for (const file of Array.from(files)) {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`
      const { error: upErr } = await supabase
        .storage
        .from('approval-attachments')
        .upload(path, file, { contentType: file.type || undefined })
      if (upErr) { setError(upErr.message); setUploading(false); return }
      // Signed URL valid for ~30 days for display in events
      const { data: signed } = await supabase
        .storage
        .from('approval-attachments')
        .createSignedUrl(path, 60 * 60 * 24 * 30)
      newOnes.push({
        name: file.name,
        url: signed?.signedUrl ?? '',
        path,
        size: file.size,
        type: file.type || 'application/octet-stream',
      })
    }
    setAttachments(prev => [...prev, ...newOnes])
    setUploading(false)
  }

  async function removeAttachment(idx: number) {
    const a = attachments[idx]
    if (!a) return
    // Best-effort delete from storage
    await supabase.storage.from('approval-attachments').remove([a.path]).catch(() => null)
    setAttachments(prev => prev.filter((_, i) => i !== idx))
  }

  function validateLocal(): string | null {
    if (!rule) return null
    if ((decision === 'approved' || decision === 'rejected')) {
      if (rule.requires_remarks && !comment.trim()) return 'A comment is required for this approval.'
      if (rule.requires_attachment && attachments.length === 0) return 'An attachment is required for this approval.'
    }
    return null
  }

  async function submit() {
    const v = validateLocal()
    if (v) { setError(v); return }
    setBusy(true); setError(null)
    try {
      // 1. Module-specific action (RPC / UPDATE) — the caller's job.
      await onConfirm({
        comment: comment.trim() || null,
        attachments,
      })

      // 2. Record the approval event. We do this AFTER the module change
      //    so we don't log fake events when the underlying action fails.
      const { error: recErr } = await supabase.rpc('record_approval_event', {
        p_module_slug: module,
        p_doc_type:    docType,
        p_doc_table:   docTable,
        p_doc_id:      docId,
        p_from_stage:  fromStage,
        p_to_stage:    toStage,
        p_decision:    decision,
        p_comment:     comment.trim() || null,
        p_attachments: attachments,
        p_amount:      amount ?? null,
      })
      if (recErr) throw recErr

      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  const isApprove = decision === 'approved'
  const isReject  = decision === 'rejected'
  const title =
    decision === 'approved' ? `Approve ${docLabel ?? 'document'}`
    : decision === 'rejected' ? `Reject ${docLabel ?? 'document'}`
    : `Return ${docLabel ?? 'document'} for changes`

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl max-w-md w-full p-5"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-3">
          <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
            {isApprove ? <ShieldCheck className="h-5 w-5 text-emerald-600" /> :
             isReject  ? <X className="h-5 w-5 text-rose-600" /> :
                         <AlertTriangle className="h-5 w-5 text-amber-600" />}
            {title}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" disabled={busy}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="text-xs text-gray-500 mb-3">
          Stage <code className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 text-xs">{fromStage}</code>
          {' → '}<code className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 text-xs">{toStage}</code>
        </p>

        {loadingRule ? (
          <div className="text-sm text-gray-500 inline-flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Checking requirements…
          </div>
        ) : (
          <>
            <label className="text-xs font-semibold text-gray-600 mb-1 flex items-center gap-1">
              <MessageSquare className="h-3 w-3" />
              Comment {rule?.requires_remarks && <span className="text-rose-600">*</span>}
            </label>
            <Textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              rows={3}
              placeholder={
                isApprove ? 'Why you are approving (visible to the team).' :
                isReject  ? 'Why you are rejecting — required if marked *.' :
                            'What needs to change before resubmission.'
              }
              disabled={busy}
              className="mb-3"
            />

            <label className="text-xs font-semibold text-gray-600 mb-1 flex items-center gap-1">
              <Paperclip className="h-3 w-3" />
              Attachments {rule?.requires_attachment && <span className="text-rose-600">*</span>}
            </label>
            <div className="mb-3">
              <label className={cn(
                'inline-flex items-center gap-1.5 text-sm border border-gray-300 hover:border-gray-400 rounded-lg px-3 h-9 cursor-pointer bg-white',
                uploading && 'opacity-50 cursor-wait',
              )}>
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
                {uploading ? 'Uploading…' : 'Add files'}
                <input
                  type="file"
                  multiple
                  className="hidden"
                  onChange={e => handleFiles(e.target.files)}
                  disabled={uploading || busy}
                />
              </label>
              {attachments.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {attachments.map((a, i) => (
                    <li key={a.path} className="flex items-center justify-between text-xs bg-gray-50 border border-gray-200 rounded-lg px-2 py-1">
                      <a href={a.url} target="_blank" rel="noreferrer" className="truncate text-blue-700 hover:underline">
                        {a.name}
                      </a>
                      <button
                        type="button"
                        onClick={() => removeAttachment(i)}
                        disabled={busy}
                        className="text-gray-400 hover:text-rose-600 ml-2"
                        aria-label="Remove attachment"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}

        {error && (
          <div className="mb-3 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-2 py-1.5">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            size="sm"
            onClick={submit}
            disabled={busy || loadingRule}
            className={cn(
              isApprove ? 'bg-emerald-600 hover:bg-emerald-700 text-white' :
              isReject  ? 'bg-rose-600 hover:bg-rose-700 text-white' :
                          'bg-amber-600 hover:bg-amber-700 text-white',
            )}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {isApprove ? 'Approve' : isReject ? 'Reject' : 'Return'}
          </Button>
        </div>
      </div>
    </div>
  )
}
