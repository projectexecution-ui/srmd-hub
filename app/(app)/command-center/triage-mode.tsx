'use client'
// Superhuman-style Triage: process one email at a time, decide "today /
// another day / done", clear to zero. Button-driven (no keyboard), with a
// smooth card-in transition and a progress-to-zero bar.

import { useState } from 'react'
import { todayIST } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { formatINRShort, formatDateShort } from '@/lib/jmr/format'
import type { BoardItem, EccCategory } from './board-client'
import { Check, Clock, CornerUpLeft, ExternalLink, ChevronRight, X, Star, Sparkles, Loader2 } from 'lucide-react'

const LABEL: Record<EccCategory, string> = {
  do_today: 'Do today', this_week: 'This week', monitor: 'Monitor',
  draft_pending: 'Draft pending', just_know: 'Just know', delete: 'Delete',
}
const TONE: Record<EccCategory, string> = {
  do_today: 'bg-rose-50 text-rose-600', this_week: 'bg-amber-50 text-amber-600',
  monitor: 'bg-blue-50 text-blue-600', draft_pending: 'bg-purple-50 text-purple-600',
  just_know: 'bg-slate-100 text-slate-500', delete: 'bg-slate-100 text-slate-400',
}
const ACTIONABLE: EccCategory[] = ['do_today', 'this_week', 'monitor', 'draft_pending']

function gmailCompose(to: string, subject: string, body: string) {
  window.open(
    `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
    '_blank', 'noopener',
  )
}

export function TriageMode({ items, onClose }: { items: BoardItem[]; onClose: () => void }) {
  const [queue] = useState<BoardItem[]>(() => items.filter(i => ACTIONABLE.includes(i.category)))
  const [idx, setIdx] = useState(0)
  const [cleared, setCleared] = useState(0)
  const [snoozeOpen, setSnoozeOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const total = queue.length
  const current: BoardItem | undefined = queue[idx]

  function dateInDays(n: number) { return todayIST(Date.now() + n * 86_400_000) }
  async function update(id: string, patch: Record<string, unknown>) {
    await createClient().from('ecc_items').update(patch).eq('id', id)
  }
  function advance() { setSnoozeOpen(false); setIdx(i => i + 1) }

  async function done() {
    if (!current) return
    setBusy('done'); await update(current.id, { status: 'done' }); setBusy(null)
    setCleared(c => c + 1); advance()
  }
  async function snooze(days: number) {
    if (!current) return
    setBusy('snooze'); await update(current.id, { status: 'snoozed', chase_on: dateInDays(days) }); setBusy(null)
    setCleared(c => c + 1); advance()
  }
  async function reply(intent?: string) {
    if (!current) return
    setBusy('reply' + (intent ?? ''))
    try {
      const res = await fetch('/api/ecc/draft-reply', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: current.id, intent }),
      })
      const data = await res.json()
      if (res.ok) gmailCompose(data.to ?? '', data.subject ?? '', data.reply ?? '')
    } catch { /* ignore */ }
    setBusy(null)
  }

  const pct = total > 0 ? Math.round((idx / total) * 100) : 100

  return (
    <div className="fixed inset-0 z-50 bg-gray-900/50 backdrop-blur-sm flex items-center justify-center p-4">
      <style>{`
        @keyframes ccIn { from { opacity: 0; transform: translateY(10px) scale(0.985); } to { opacity: 1; transform: none; } }
        .cc-in { animation: ccIn .22s cubic-bezier(.2,.7,.3,1) both; }
      `}</style>

      <div className="w-full max-w-xl">
        {/* Header: progress + close */}
        <div className="flex items-center justify-between mb-2 text-white">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Sparkles className="h-4 w-4" /> Triage
            <span className="text-white/70 text-xs">{Math.min(idx + (current ? 1 : 0), total)} of {total}</span>
          </div>
          <button type="button" onClick={onClose} className="inline-flex items-center gap-1 text-xs text-white/80 hover:text-white">
            <X className="h-4 w-4" /> Close
          </button>
        </div>
        <div className="h-1.5 rounded-full bg-white/20 overflow-hidden mb-3">
          <div className="h-full bg-white transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>

        {current ? (
          <div key={current.id} className="cc-in bg-white rounded-2xl shadow-2xl overflow-hidden">
            <div className="p-6">
              <div className="flex items-center gap-2 mb-3">
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${TONE[current.category]}`}>{LABEL[current.category]}</span>
                {current.is_vip && <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-600"><Star className="h-3 w-3" fill="currentColor" /> VIP</span>}
                {current.amount_inr ? <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-rose-50 text-rose-700">{formatINRShort(current.amount_inr)}</span> : null}
                <span className="ml-auto text-[11px] text-gray-400">
                  {current.age_days === 0 ? 'today' : `${current.age_days}d`}
                  {current.chase_on && <span className={current.overdue ? ' text-rose-600 font-semibold' : ' text-blue-600'}> · {current.overdue ? '⚠ ' : 'chase '}{formatDateShort(current.chase_on)}</span>}
                </span>
              </div>

              <h2 className="text-xl font-bold text-gray-900 leading-snug">{current.subject}</h2>
              <p className="text-sm text-gray-500 mt-1">{current.sender}</p>

              {current.summary && (
                <p className="text-[15px] text-gray-700 leading-relaxed mt-4">{current.summary}</p>
              )}
              {current.reason && (
                <p className="text-xs text-gray-400 italic mt-2">Why this matters: {current.reason}</p>
              )}

              {/* Smart replies */}
              {current.smart_replies.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-4">
                  {current.smart_replies.map(chip => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => reply(chip)}
                      disabled={busy !== null}
                      className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-teal-50 text-teal-700 ring-1 ring-teal-200/70 hover:bg-teal-100 disabled:opacity-50"
                    >
                      {busy === 'reply' + chip ? <Loader2 className="h-3 w-3 animate-spin" /> : <span>⚡</span>} {chip}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Action bar */}
            <div className="border-t border-gray-100 bg-gray-50/70 px-4 py-3 flex items-center gap-2">
              <button type="button" onClick={done} disabled={busy !== null}
                className="inline-flex items-center gap-1.5 text-sm font-semibold bg-emerald-600 text-white px-4 py-2 rounded-xl hover:bg-emerald-700 disabled:opacity-50">
                {busy === 'done' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Done
              </button>

              <div className="relative">
                <button type="button" onClick={() => setSnoozeOpen(o => !o)} disabled={busy !== null}
                  className="inline-flex items-center gap-1.5 text-sm font-medium bg-white text-gray-700 ring-1 ring-gray-200 px-3.5 py-2 rounded-xl hover:bg-gray-50 disabled:opacity-50">
                  {busy === 'snooze' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock className="h-4 w-4" />} Another day
                </button>
                {snoozeOpen && (
                  <div className="absolute bottom-full mb-1.5 left-0 z-10 bg-white rounded-xl shadow-xl ring-1 ring-gray-200 py-1 w-36">
                    <button type="button" onClick={() => snooze(0)} className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100">Later today</button>
                    <button type="button" onClick={() => snooze(1)} className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100">Tomorrow</button>
                    <button type="button" onClick={() => snooze(7)} className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100">Next week</button>
                  </div>
                )}
              </div>

              {current.canReply && (
                <button type="button" onClick={() => reply()} disabled={busy !== null}
                  className="inline-flex items-center gap-1.5 text-sm font-medium bg-white text-teal-700 ring-1 ring-teal-200 px-3.5 py-2 rounded-xl hover:bg-teal-50 disabled:opacity-50">
                  {busy === 'reply' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CornerUpLeft className="h-4 w-4" />} Reply
                </button>
              )}

              <a href={current.gmailUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center justify-center h-9 w-9 rounded-xl bg-white text-gray-500 ring-1 ring-gray-200 hover:bg-gray-50" title="Open in Gmail">
                <ExternalLink className="h-4 w-4" />
              </a>

              <button type="button" onClick={advance} disabled={busy !== null}
                className="ml-auto inline-flex items-center gap-1 text-sm text-gray-500 px-3 py-2 rounded-xl hover:bg-gray-100 disabled:opacity-50">
                Skip <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : (
          /* Inbox zero */
          <div className="cc-in bg-white rounded-2xl shadow-2xl p-10 text-center">
            <div className="mx-auto h-14 w-14 rounded-2xl bg-emerald-100 text-emerald-600 grid place-items-center mb-4">
              <Check className="h-7 w-7" />
            </div>
            <h2 className="text-xl font-bold text-gray-900">All clear 🎉</h2>
            <p className="text-sm text-gray-500 mt-1">
              You triaged {cleared} item{cleared === 1 ? '' : 's'}. Every actionable email now has a next step.
            </p>
            <button type="button" onClick={onClose}
              className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold bg-gray-900 text-white px-4 py-2 rounded-xl hover:bg-gray-800">
              Back to board
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
