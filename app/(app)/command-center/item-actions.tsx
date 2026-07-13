'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Check, Clock, RotateCcw, Loader2, ExternalLink, CornerUpLeft } from 'lucide-react'

// Per-row actions. RLS scopes updates to the user's own rows.
// - Open in Gmail: deep-link to the real thread (Phase 1, no API).
// - Reply: AI writes the reply (/api/ecc/draft-reply) then opens a Gmail
//   compose window pre-filled — review + send in one click. True in-app
//   send (never leaving CT Hub) is Phase 2 (needs Gmail send scope).
export function ItemActions({
  id, status, threadId, canReply,
}: {
  id: string
  status: 'open' | 'done' | 'snoozed'
  threadId: string | null
  canReply: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<null | 'done' | 'snooze' | 'reopen' | 'reply'>(null)
  const [err, setErr] = useState<string | null>(null)

  async function update(patch: Record<string, unknown>, kind: 'done' | 'snooze' | 'reopen') {
    setBusy(kind); setErr(null)
    const { error } = await createClient().from('ecc_items').update(patch).eq('id', id)
    setBusy(null)
    if (error) { setErr(error.message); return }
    router.refresh()
  }

  function chaseInDays(n: number): string {
    const d = new Date(); d.setDate(d.getDate() + n)
    return d.toISOString().slice(0, 10)
  }

  const gmailThreadUrl = threadId ? `https://mail.google.com/mail/u/0/#all/${threadId}` : null

  async function reply() {
    setBusy('reply'); setErr(null)
    try {
      const res = await fetch('/api/ecc/draft-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: id }),
      })
      const data = await res.json()
      if (!res.ok) { setErr(data?.error ?? 'Could not draft reply'); setBusy(null); return }
      const url =
        `https://mail.google.com/mail/?view=cm&fs=1` +
        `&to=${encodeURIComponent(data.to ?? '')}` +
        `&su=${encodeURIComponent(data.subject ?? '')}` +
        `&body=${encodeURIComponent(data.reply ?? '')}`
      window.open(url, '_blank', 'noopener')
    } catch {
      setErr('Could not draft reply')
    }
    setBusy(null)
  }

  return (
    <div className="flex flex-col items-end gap-1 flex-shrink-0">
      <div className="flex items-center gap-1">
        {canReply && (
          <button
            type="button"
            onClick={reply}
            disabled={busy !== null}
            title="AI reply — opens Gmail ready to send"
            aria-label="Draft AI reply"
            className="inline-flex items-center justify-center h-7 w-7 rounded-md text-teal-700 hover:bg-teal-50 border border-transparent hover:border-teal-200 disabled:opacity-50"
          >
            {busy === 'reply' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CornerUpLeft className="h-3.5 w-3.5" />}
          </button>
        )}
        {gmailThreadUrl && (
          <a
            href={gmailThreadUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Open in Gmail"
            aria-label="Open in Gmail"
            className="inline-flex items-center justify-center h-7 w-7 rounded-md text-gray-500 hover:bg-gray-100 border border-transparent hover:border-gray-200"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
        <button
          type="button"
          onClick={() => update({ status: 'done' }, 'done')}
          disabled={busy !== null}
          title="Mark done"
          aria-label="Mark done"
          className="inline-flex items-center justify-center h-7 w-7 rounded-md text-emerald-600 hover:bg-emerald-50 border border-transparent hover:border-emerald-200 disabled:opacity-50"
        >
          {busy === 'done' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
        </button>
        {status === 'snoozed' ? (
          <button
            type="button"
            onClick={() => update({ status: 'open', chase_on: null }, 'reopen')}
            disabled={busy !== null}
            title="Reopen"
            aria-label="Reopen"
            className="inline-flex items-center justify-center h-7 w-7 rounded-md text-gray-500 hover:bg-gray-100 border border-transparent hover:border-gray-200 disabled:opacity-50"
          >
            {busy === 'reopen' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => update({ status: 'snoozed', chase_on: chaseInDays(3) }, 'snooze')}
            disabled={busy !== null}
            title="Snooze 3 days (sets a chase date)"
            aria-label="Snooze 3 days"
            className="inline-flex items-center justify-center h-7 w-7 rounded-md text-blue-600 hover:bg-blue-50 border border-transparent hover:border-blue-200 disabled:opacity-50"
          >
            {busy === 'snooze' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Clock className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>
      {err && <p className="text-[10px] text-rose-700 max-w-[160px] truncate" title={err}>{err}</p>}
    </div>
  )
}
