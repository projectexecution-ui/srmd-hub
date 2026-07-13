'use client'
// Follow-up radar — surfaces threads where the ball is with someone else
// (Monitor bucket) or a chase date has passed, and lets you fire a polite
// chase in one tap. Superhuman's "Auto Follow-up", adapted.

import { useState } from 'react'
import { formatDateShort } from '@/lib/jmr/format'
import type { BoardItem } from './board-client'
import { Radar, Loader2, Send, ChevronDown, X } from 'lucide-react'

function gmailCompose(to: string, subject: string, body: string) {
  window.open(
    `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
    '_blank', 'noopener',
  )
}

export function FollowupRadar({ items }: { items: BoardItem[] }) {
  const awaiting = items
    .filter(i => i.category === 'monitor' || i.overdue)
    .sort((a, b) => (b.age_days ?? 0) - (a.age_days ?? 0))
  const [busy, setBusy] = useState<string | null>(null)
  const [open, setOpen] = useState(true)
  const [dismissed, setDismissed] = useState(false)

  if (awaiting.length === 0 || dismissed) return null

  async function chase(item: BoardItem) {
    setBusy(item.id)
    try {
      const res = await fetch('/api/ecc/draft-reply', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: item.id, intent: 'Write a short, polite follow-up / chase asking for a status update or the pending item.' }),
      })
      const data = await res.json()
      if (res.ok) gmailCompose(data.to ?? '', data.subject ?? '', data.reply ?? '')
    } catch { /* ignore */ }
    setBusy(null)
  }

  const overdue = awaiting.filter(i => i.overdue).length

  return (
    <div className="mb-3 rounded-xl bg-white ring-1 ring-gray-200/70 shadow-sm overflow-hidden">
      <div className="px-3 py-1.5 flex items-center gap-2">
        <span className="h-6 w-6 rounded-md bg-blue-100 text-blue-600 grid place-items-center"><Radar className="h-3.5 w-3.5" /></span>
        <button type="button" onClick={() => setOpen(o => !o)} className="flex items-center gap-1.5 min-w-0">
          <span className="text-[13px] font-semibold text-gray-800">Follow-up radar</span>
          <span className="text-[11px] text-gray-400">{awaiting.length} waiting{overdue ? ` · ${overdue} overdue` : ''}</span>
          <ChevronDown className={`h-3.5 w-3.5 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        <button type="button" onClick={() => setDismissed(true)} title="Dismiss" className="ml-auto text-gray-300 hover:text-gray-500"><X className="h-3.5 w-3.5" /></button>
      </div>
      {open && (
        <div className="divide-y divide-gray-50 border-t border-gray-100">
          {awaiting.slice(0, 5).map(item => (
            <div key={item.id} className="px-3 py-1.5 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-gray-900 truncate">{item.subject}</p>
                <p className="text-[11px] text-gray-500 truncate">
                  waiting on <span className="text-gray-700">{item.sender}</span>
                  <span className="text-gray-400"> · {item.age_days}d</span>
                  {item.chase_on && (
                    <span className={item.overdue ? ' text-rose-600 font-semibold' : ' text-blue-600'}>
                      {' '}· {item.overdue ? 'chase overdue' : 'chase'} {formatDateShort(item.chase_on)}
                    </span>
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => chase(item)}
                disabled={busy !== null}
                className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 flex-shrink-0"
              >
                {busy === item.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />} Chase
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
