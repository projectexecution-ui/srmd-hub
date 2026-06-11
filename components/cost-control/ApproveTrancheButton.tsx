'use client'
// Approve a working sheet in releases (Indian construction-finance term:
// HOD "releases" budget into ERP). Opens a small panel with the estimate
// / already-approved / remaining numbers and an amount input (pre-filled
// with the remaining). HOD can type a smaller number to release just
// part of the budget; clicking "Approve all remaining" finalises it.
//
// Every release is logged into approval_events via record_approval_event
// with an optional comment + attachments. The logged transition is fixed
// at submitted → partially_approved (canonical "WS release approval"
// event) regardless of the sheet's actual current state or whether this
// release closes the sheet.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { approveWorkingSheet } from '@/components/cost-control/ws-actions'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { MoneyInput } from '@/components/ui/money-input'
import { Textarea } from '@/components/ui/textarea'
import { Check, Loader2, Wallet, Paperclip, MessageSquare, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

const MODULE_SLUG = 'cost-control'
const DOC_TYPE = 'cc_working_sheet'
const DOC_TABLE = 'cc_working_sheets'
const FROM_STAGE = 'submitted'
const TO_STAGE = 'partially_approved'

function formatINR(n: number): string {
  return '₹' + (Number.isFinite(n) ? n.toLocaleString('en-IN', { maximumFractionDigits: 0 }) : '—')
}

interface Attachment {
  name: string
  url: string
  path: string
  size: number
  type: string
}

export function ApproveTrancheButton({
  wsId, totalAmount, approvedSoFar, compact = false,
}: {
  wsId: string
  totalAmount: number
  approvedSoFar: number
  compact?: boolean
}) {
  const router = useRouter()
  const supabase = createClient()
  const [open, setOpen] = useState(false)
  const remaining = Math.max(totalAmount - approvedSoFar, 0)
  const [amount, setAmount] = useState<string>(String(remaining))
  const [comment, setComment] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [uploading, setUploading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [requiresRemarks, setRequiresRemarks] = useState(false)
  const [requiresAttachment, setRequiresAttachment] = useState(false)

  // The sheet's REAL current stage: a sheet with releases already against
  // it sits at partially_approved, not submitted. Rule lookups and the
  // audit event must use the true transition.
  const fromStage = approvedSoFar > 0 ? 'partially_approved' : FROM_STAGE

  useEffect(() => {
    if (!open) return
    void (async () => {
      // A release can land on either to-stage (partial or completing), so
      // honour the strictest requirements across both possible rules.
      const { data } = await supabase
        .from('approval_rules')
        .select('requires_remarks, requires_attachment')
        .eq('module_slug', MODULE_SLUG)
        .eq('doc_type', DOC_TYPE)
        .eq('from_stage', fromStage)
        .in('to_stage', ['partially_approved', 'approved'])
        .eq('is_active', true)
      setRequiresRemarks((data ?? []).some(r => r.requires_remarks))
      setRequiresAttachment((data ?? []).some(r => r.requires_attachment))
    })()
  }, [open, supabase, fromStage])

  useEffect(() => {
    if (!open) {
      setComment(''); setAttachments([])
      setErr(null); setBusy(false); setUploading(false)
    }
  }, [open])

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploading(true); setErr(null)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setErr('Not signed in'); setUploading(false); return }
    const newOnes: Attachment[] = []
    for (const file of Array.from(files)) {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`
      const { error: upErr } = await supabase
        .storage
        .from('approval-attachments')
        .upload(path, file, { contentType: file.type || undefined })
      if (upErr) { setErr(upErr.message); setUploading(false); return }
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
    await supabase.storage.from('approval-attachments').remove([a.path]).catch(() => null)
    setAttachments(prev => prev.filter((_, i) => i !== idx))
  }

  async function submit(useAll: boolean) {
    setBusy(true); setErr(null)
    let trancheArg: number | null = null
    let trancheAmount: number = remaining
    if (!useAll) {
      const num = Number(amount)
      if (!Number.isFinite(num) || num <= 0) { setErr('Enter an amount greater than zero'); setBusy(false); return }
      if (num > remaining + 0.5) { setErr(`Release ${formatINR(num)} exceeds remaining ${formatINR(remaining)}`); setBusy(false); return }
      trancheArg = num
      trancheAmount = num
    }

    if (requiresRemarks && !comment.trim()) { setErr('A comment is required for this approval.'); setBusy(false); return }
    if (requiresAttachment && attachments.length === 0) { setErr('An attachment is required for this approval.'); setBusy(false); return }

    const r = await approveWorkingSheet(wsId, trancheArg)
    if (!r.ok) { setErr(r.error ?? 'Approve failed'); setBusy(false); return }

    const released = r.released ?? trancheAmount
    const fullyApproved = (r.new_status ?? TO_STAGE) === 'approved'
    toast.success(
      fullyApproved
        ? `Released ${formatINR(released)} — sheet is now fully approved`
        : `Released ${formatINR(released)} — sheet stays partially approved`,
    )

    // Log the ACTUAL transition, not a hardcoded one — a release that
    // completes a partially-approved sheet is partially_approved →
    // approved, and the matrix rules for that exact pair are what
    // record_approval_event re-checks.
    const actualToStage = r.new_status ?? TO_STAGE
    const { error: recErr } = await supabase.rpc('record_approval_event', {
      p_module_slug: MODULE_SLUG,
      p_doc_type:    DOC_TYPE,
      p_doc_table:   DOC_TABLE,
      p_doc_id:      wsId,
      p_from_stage:  r.prior_status ?? fromStage,
      p_to_stage:    actualToStage,
      p_decision:    'approved',
      p_comment:     comment.trim() || null,
      p_attachments: attachments,
      p_amount:      trancheAmount,
    })
    setBusy(false)
    if (recErr) {
      setErr(`Approved, but failed to log event: ${recErr.message}`)
      router.refresh()
      return
    }
    setOpen(false)
    router.refresh()
  }

  if (!open) {
    return (
      <Button
        variant="success"
        size={compact ? 'sm' : 'default'}
        onClick={() => { setOpen(true); setAmount(String(remaining)) }}
      >
        <Check className="h-4 w-4" />
        {approvedSoFar > 0 ? 'Approve more' : 'Approve'}
      </Button>
    )
  }

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3 space-y-3">
      <div className="flex items-center gap-2 text-xs">
        <Wallet className="h-3.5 w-3.5 text-emerald-700" />
        <span className="text-emerald-900 font-semibold">Approve a release into ERP</span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <Stat label="Estimate" value={formatINR(totalAmount)} />
        <Stat label="Already approved" value={formatINR(approvedSoFar)} tone="green" />
        <Stat label="Remaining" value={formatINR(remaining)} tone="amber" />
      </div>
      <div>
        <label className="text-[11px] font-semibold text-gray-700">Release amount (₹)</label>
        <MoneyInput
          value={amount}
          onChange={setAmount}
          placeholder={String(remaining)}
          className="mt-1 font-mono"
        />
        <p className="text-[11px] text-gray-500 mt-1">
          Enter the amount HOD is releasing now. Sheet stays open at &quot;partially approved&quot; until the full estimate is reached.
        </p>
      </div>

      <div>
        <label className="text-[11px] font-semibold text-gray-700 flex items-center gap-1">
          <MessageSquare className="h-3 w-3" />
          Comment {requiresRemarks && <span className="text-rose-600">*</span>}
        </label>
        <Textarea
          value={comment}
          onChange={e => setComment(e.target.value)}
          rows={2}
          placeholder="Why HOD is releasing this amount (visible to the team)."
          disabled={busy}
          className="mt-1"
        />
      </div>

      <div>
        <label className="text-[11px] font-semibold text-gray-700 flex items-center gap-1">
          <Paperclip className="h-3 w-3" />
          Attachments {requiresAttachment && <span className="text-rose-600">*</span>}
          <span className="text-gray-500 font-normal">— e.g. signed approval letter</span>
        </label>
        <div className="mt-1">
          <label className={cn(
            'inline-flex items-center gap-1.5 text-xs border border-gray-300 hover:border-gray-400 rounded-lg px-2.5 h-8 cursor-pointer bg-white',
            (uploading || busy) && 'opacity-50 cursor-wait',
          )}>
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
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
                <li key={a.path} className="flex items-center justify-between text-xs bg-white border border-gray-200 rounded-md px-2 py-1">
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
      </div>

      {err && <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1.5">{err}</p>}
      <div className="flex flex-wrap gap-2 justify-end">
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button variant="outline" size="sm" disabled={busy || uploading} onClick={() => submit(true)}>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Approve all remaining ({formatINR(remaining)})
        </Button>
        <Button variant="success" size="sm" disabled={busy || uploading || !amount} onClick={() => submit(false)}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Approve this release
        </Button>
      </div>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'green' | 'amber' }) {
  const cls = tone === 'green' ? 'text-emerald-800' : tone === 'amber' ? 'text-amber-800' : 'text-gray-800'
  return (
    <div className="bg-white rounded-md border border-gray-200 px-2 py-1.5">
      <p className="text-[10px] uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`font-mono font-semibold ${cls}`}>{value}</p>
    </div>
  )
}
