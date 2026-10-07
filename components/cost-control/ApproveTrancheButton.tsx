'use client'
// Trustee approval — the FINAL stage of the 3-step chain (Project Head →
// Atm Head → Trustee). One figure walks the whole chain: the Trustee
// approves the SAME amount the Atm Head checked. The panel shows the two
// checks side by side, pre-fills that figure, and refuses anything above it
// with the reason (a round-up belongs at the Atm Head's check). Approving
// less is allowed — the sheet stays "partly approved" until the rest goes.
//
// Aksha, 7 Oct 2026 (SRAH-1302-Q02): "the amount checked by Project head n
// Atm head is same and Chirag Shah amt is different … this cannot happen" and
// "Previous approved adjusted in this Approval - that is not right - as this
// will create confusion". Earlier versions of the budget are therefore NOT
// netted into this sheet's figure any more.
//
// Every approval is logged into approval_events via record_approval_event
// with a comment + optional attachments, using the sheet's REAL from-stage
// (atm_approved for the first approval, partially_approved after a partial).

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { approveWorkingSheet } from '@/components/cost-control/ws-actions'
import { trusteeApproval } from '@/lib/cost-control/chain'
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
// Approvals start AFTER both sign-offs — the sheet sits at atm_approved
// for the first approval, partially_approved after a partial one.
const FROM_STAGE = 'atm_approved'
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
  wsId, checkedAmount, approvedSoFar, phCheckedAmount = null, compact = false,
}: {
  wsId: string
  /** The figure the Atm Head signed (the sheet total when no check was
   *  recorded). The Trustee approves this same figure — cc_approve_release
   *  caps at it server-side; this panel mirrors the cap. */
  checkedAmount: number
  /** Approved on THIS sheet so far (a partial approval earlier). Never the
   *  chain's — earlier versions are not netted in. */
  approvedSoFar: number
  /** The Project Head's checked figure, shown beside the Atm Head's so the
   *  three figures read together. */
  phCheckedAmount?: number | null
  compact?: boolean
}) {
  const router = useRouter()
  const supabase = createClient()
  const [open, setOpen] = useState(false)
  const balance = Math.max(checkedAmount - approvedSoFar, 0)
  const [amount, setAmount] = useState<string>(String(Math.round(balance)))
  const [comment, setComment] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [uploading, setUploading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [requiresAttachment, setRequiresAttachment] = useState(false)

  // The sheet's REAL current stage: a sheet with a partial approval against
  // it sits at partially_approved. Rule lookups and the audit event must
  // use the true transition.
  const fromStage = approvedSoFar > 0 ? 'partially_approved' : FROM_STAGE

  // What the typed figure means, re-read on every keystroke: the balance,
  // whether it is partial, and why it cannot go (shown inline, never a
  // silent block).
  const typed = amount.trim() === '' ? null : Number(amount)
  const check = trusteeApproval(checkedAmount, approvedSoFar, typed)
  const phDiffers = phCheckedAmount != null && Math.round(phCheckedAmount) !== Math.round(checkedAmount)

  useEffect(() => {
    if (!open) return
    void (async () => {
      // An approval can land on either to-stage (partial or completing), so
      // honour the strictest requirements across both possible rules.
      const { data } = await supabase
        .from('approval_rules')
        .select('requires_attachment')
        .eq('module_slug', MODULE_SLUG)
        .eq('doc_type', DOC_TYPE)
        .eq('from_stage', fromStage)
        .in('to_stage', ['partially_approved', 'approved'])
        .eq('is_active', true)
      setRequiresAttachment((data ?? []).some(r => r.requires_attachment))
    })()
  }, [open, supabase, fromStage])

  // Opening and closing reset the panel in the handlers themselves (no
  // effect): a fresh amount, note and files every time it opens.
  function openPanel() {
    setAmount(String(Math.round(balance)))
    setComment(''); setAttachments([])
    setErr(null); setBusy(false); setUploading(false)
    setOpen(true)
  }
  function closePanel() {
    setErr(null); setBusy(false); setUploading(false)
    setOpen(false)
  }

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

  async function submit() {
    setErr(null)
    if (check.error) { setErr(check.error); return }
    const num = typed as number

    // Comment is mandatory at every approval stage (not just when the rule
    // flags it) — the Trustee's note is read by the whole team.
    if (!comment.trim()) { setErr('A comment is required for this approval.'); return }
    if (requiresAttachment && attachments.length === 0) { setErr('An attachment is required for this approval.'); return }

    setBusy(true)

    // Pass the typed figure; the RPC snaps a full approval to the checked
    // figure exactly, so paise never drift.
    const r = await approveWorkingSheet(wsId, num)
    if (!r.ok) { setErr(r.error ?? 'Approve failed'); setBusy(false); return }

    const released = r.released ?? num
    const fullyApproved = (r.new_status ?? TO_STAGE) === 'approved'
    toast.success(
      fullyApproved
        ? `Approved ${formatINR(released)} — the figure the Atm Head checked. Sheet fully approved.`
        : `Approved ${formatINR(released)} — sheet stays partly approved`,
    )

    // Log the ACTUAL transition, not a hardcoded one — an approval that
    // completes a partly-approved sheet is partially_approved → approved,
    // and the matrix rules for that exact pair are what
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
      p_amount:      released,
    })
    setBusy(false)
    if (recErr) {
      setErr(`Approved, but failed to log event: ${recErr.message}`)
      router.refresh()
      return
    }
    closePanel()
    router.refresh()
  }

  if (!open) {
    return (
      <Button
        variant="success"
        size={compact ? 'sm' : 'default'}
        onClick={openPanel}
      >
        <Check className="h-4 w-4" />
        {approvedSoFar > 0 ? `Approve the balance ${formatINR(balance)}` : `Approve ${formatINR(checkedAmount)}`}
      </Button>
    )
  }

  const typedIsFull = !check.error && !check.partial

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3 space-y-3">
      <div className="flex items-center gap-2 text-xs">
        <Wallet className="h-3.5 w-3.5 text-emerald-700" />
        <span className="text-emerald-900 font-semibold">Trustee approval</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
        {phCheckedAmount != null && <Stat label="Project Head checked" value={formatINR(phCheckedAmount)} />}
        <Stat label="Atm Head checked" value={formatINR(checkedAmount)} tone="green" />
        {approvedSoFar > 0
          ? <Stat label="Approved so far · balance" value={`${formatINR(approvedSoFar)} · ${formatINR(balance)}`} tone="amber" />
          : <Stat label="To approve" value={formatINR(balance)} tone="amber" />}
      </div>
      {phDiffers && (
        <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
          The Project Head and the Atm Head checked different figures. The Atm Head&apos;s {formatINR(checkedAmount)} is the one you approve — if that is wrong, return the sheet rather than approve a third figure.
        </p>
      )}
      <div>
        <label className="text-[11px] font-semibold text-gray-700">Amount to approve (₹)</label>
        <MoneyInput
          value={amount}
          onChange={setAmount}
          placeholder={String(Math.round(balance))}
          className="mt-1 font-mono"
        />
        {check.error && typed != null && (
          <p className="text-[11px] font-semibold text-rose-800 bg-rose-50 border border-rose-200 rounded px-2 py-1 mt-1">
            {check.error}
          </p>
        )}
        {check.partial && (
          <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-1">
            Less than the Atm Head&apos;s {formatINR(checkedAmount)} — the sheet stays &quot;partly approved&quot; until the remaining {formatINR(balance - (typed ?? 0))} is approved.
          </p>
        )}
        <p className="text-[11px] text-gray-500 mt-1">
          Pre-filled with the figure the Atm Head checked. Earlier versions of this budget are not netted in here.
        </p>
      </div>

      <div>
        <label className="text-[11px] font-semibold text-gray-700 flex items-center gap-1">
          <MessageSquare className="h-3 w-3" />
          Comment <span className="text-rose-600">*</span>
        </label>
        <Textarea
          value={comment}
          onChange={e => setComment(e.target.value)}
          rows={2}
          placeholder="Why this amount is being approved (visible to the team)."
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
        <Button variant="ghost" size="sm" disabled={busy} onClick={closePanel}>
          Cancel
        </Button>
        <Button variant="success" size="sm" disabled={busy || uploading} onClick={submit}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          {typedIsFull ? `Approve ${formatINR(balance)}` : check.partial ? `Approve ${formatINR(typed ?? 0)} (partial)` : 'Approve'}
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
