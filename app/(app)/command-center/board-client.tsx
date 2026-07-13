'use client'
// GOD Mode board — client-interactive: summaries, 1-tap smart replies,
// group-by-sender, and bulk done/snooze. Kept free of server-only imports
// (no lib/ai / lib/ecc/triage) so nothing server-side leaks into the bundle.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { formatINRShort, formatDateShort } from '@/lib/jmr/format'
import {
  Star, CornerUpLeft, ExternalLink, Check, Clock, RotateCcw, Loader2,
  Users, CheckCheck, X,
} from 'lucide-react'

export type EccCategory =
  | 'do_today' | 'this_week' | 'monitor' | 'draft_pending' | 'just_know' | 'delete'

export interface BoardItem {
  id: string
  category: EccCategory
  subject: string
  sender: string
  summary: string | null
  amount_inr: number | null
  age_days: number | null
  chase_on: string | null
  status: 'open' | 'done' | 'snoozed'
  is_vip: boolean
  reason: string | null
  tags: string[]
  smart_replies: string[]
  gmailUrl: string
  overdue: boolean
  canReply: boolean
}

const CATS: EccCategory[] = ['do_today', 'this_week', 'monitor', 'draft_pending', 'just_know', 'delete']
const LABELS: Record<EccCategory, string> = {
  do_today: 'Do today', this_week: 'This week', monitor: 'Monitor',
  draft_pending: 'Draft pending', just_know: 'Just know', delete: 'Delete',
}
const COL: Record<EccCategory, { text: string; head: string; dot: string }> = {
  do_today:      { text: 'text-rose-700',   head: 'bg-rose-50 border-rose-200',     dot: 'bg-rose-500' },
  this_week:     { text: 'text-amber-700',  head: 'bg-amber-50 border-amber-200',   dot: 'bg-amber-500' },
  monitor:       { text: 'text-blue-700',   head: 'bg-blue-50 border-blue-200',     dot: 'bg-blue-500' },
  draft_pending: { text: 'text-purple-700', head: 'bg-purple-50 border-purple-200', dot: 'bg-purple-500' },
  just_know:     { text: 'text-gray-600',   head: 'bg-gray-50 border-gray-200',     dot: 'bg-gray-400' },
  delete:        { text: 'text-gray-400',   head: 'bg-gray-50 border-gray-200',     dot: 'bg-gray-300' },
}

function gmailCompose(to: string, subject: string, replyBody: string) {
  const url =
    `https://mail.google.com/mail/?view=cm&fs=1` +
    `&to=${encodeURIComponent(to)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(replyBody)}`
  window.open(url, '_blank', 'noopener')
}

export function BoardClient({ items }: { items: BoardItem[] }) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [groupBySender, setGroupBySender] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [replyBusy, setReplyBusy] = useState<string | null>(null)
  const [snoozeMenu, setSnoozeMenu] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const shownCats = CATS.filter(c => items.some(i => i.category === c))

  function toggleSel(id: string) {
    setSelected(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }

  function dateInDays(n: number): string {
    const d = new Date(); d.setDate(d.getDate() + n)
    return d.toISOString().slice(0, 10)
  }

  async function updateIds(ids: string[], patch: Record<string, unknown>) {
    setErr(null)
    const { error } = await createClient().from('ecc_items').update(patch).in('id', ids)
    if (error) { setErr(error.message); return false }
    return true
  }

  async function markDone(id: string) {
    setBusyId(id)
    const ok = await updateIds([id], { status: 'done' })
    setBusyId(null)
    if (ok) router.refresh()
  }

  async function snooze(id: string, days: number) {
    setBusyId(id); setSnoozeMenu(null)
    const ok = await updateIds([id], { status: 'snoozed', chase_on: dateInDays(days) })
    setBusyId(null)
    if (ok) router.refresh()
  }

  async function reopen(id: string) {
    setBusyId(id)
    const ok = await updateIds([id], { status: 'open', chase_on: null })
    setBusyId(null)
    if (ok) router.refresh()
  }

  async function bulk(patch: Record<string, unknown>) {
    if (selected.size === 0) return
    const ids = [...selected]
    setBusyId('bulk')
    const ok = await updateIds(ids, patch)
    setBusyId(null)
    if (ok) { setSelected(new Set()); setSnoozeMenu(null); router.refresh() }
  }

  async function reply(item: BoardItem, intent?: string) {
    setReplyBusy(item.id + (intent ?? '')); setErr(null)
    try {
      const res = await fetch('/api/ecc/draft-reply', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: item.id, intent }),
      })
      const data = await res.json()
      if (!res.ok) { setErr(data?.error ?? 'Could not draft reply'); setReplyBusy(null); return }
      gmailCompose(data.to ?? '', data.subject ?? '', data.reply ?? '')
    } catch { setErr('Could not draft reply') }
    setReplyBusy(null)
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <button
          type="button"
          onClick={() => setGroupBySender(g => !g)}
          className={`inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border ${groupBySender ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
        >
          <Users className="h-3.5 w-3.5" /> Group by sender
        </button>
        {err && <span className="text-xs text-rose-700">{err}</span>}

        {selected.size > 0 && (
          <div className="ml-auto flex items-center gap-1.5 bg-gray-900 text-white rounded-lg px-2 py-1.5 text-xs">
            <span className="font-semibold">{selected.size} selected</span>
            <button type="button" onClick={() => bulk({ status: 'done' })} disabled={busyId === 'bulk'} className="inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-white/15">
              {busyId === 'bulk' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />} Done
            </button>
            <div className="relative">
              <button type="button" onClick={() => setSnoozeMenu(snoozeMenu === 'bulk' ? null : 'bulk')} className="inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-white/15">
                <Clock className="h-3.5 w-3.5" /> Snooze
              </button>
              {snoozeMenu === 'bulk' && (
                <div className="absolute right-0 mt-1 z-20 bg-white text-gray-800 rounded-lg shadow-lg border border-gray-200 py-1 w-32">
                  <SnoozeItem label="Later today" onClick={() => bulk({ status: 'snoozed', chase_on: dateInDays(0) })} />
                  <SnoozeItem label="Tomorrow" onClick={() => bulk({ status: 'snoozed', chase_on: dateInDays(1) })} />
                  <SnoozeItem label="Next week" onClick={() => bulk({ status: 'snoozed', chase_on: dateInDays(7) })} />
                </div>
              )}
            </div>
            <button type="button" onClick={() => setSelected(new Set())} className="inline-flex items-center px-1.5 py-1 rounded hover:bg-white/15"><X className="h-3.5 w-3.5" /></button>
          </div>
        )}
      </div>

      {/* Board */}
      <div className="flex gap-3 overflow-x-auto pb-3 -mx-1 px-1">
        {shownCats.map(cat => {
          const rows = items.filter(i => i.category === cat)
          const meta = COL[cat]
          const groups = groupBySender ? groupBySenderFn(rows) : [{ sender: null, rows }]
          return (
            <section key={cat} id={`col-${cat}`} className="flex-shrink-0 w-[310px] scroll-mt-4">
              <div className={`rounded-t-xl border px-3 py-2 flex items-center justify-between ${meta.head}`}>
                <div className={`flex items-center gap-1.5 text-xs font-bold ${meta.text}`}>
                  <span className={`h-2 w-2 rounded-full ${meta.dot}`} /> {LABELS[cat]}
                </div>
                <span className={`text-xs font-semibold ${meta.text}`}>{rows.length}</span>
              </div>
              <div className="border border-t-0 rounded-b-xl border-gray-200 bg-gray-50/40 p-1.5 space-y-1.5 max-h-[70vh] overflow-y-auto">
                {groups.map((g, gi) => (
                  <div key={g.sender ?? gi} className="space-y-1.5">
                    {g.sender && (
                      <div className="text-[10px] font-semibold text-gray-500 px-1 pt-1 flex items-center gap-1">
                        {g.sender} <span className="text-gray-400">· {g.rows.length}</span>
                      </div>
                    )}
                    {g.rows.map(item => (
                      <Card
                        key={item.id}
                        item={item}
                        selected={selected.has(item.id)}
                        onToggle={() => toggleSel(item.id)}
                        busy={busyId === item.id}
                        replyBusyKey={replyBusy}
                        snoozeOpen={snoozeMenu === item.id}
                        onSnoozeToggle={() => setSnoozeMenu(snoozeMenu === item.id ? null : item.id)}
                        onSnooze={(d) => snooze(item.id, d)}
                        onDone={() => markDone(item.id)}
                        onReopen={() => reopen(item.id)}
                        onReply={(intent) => reply(item, intent)}
                      />
                    ))}
                  </div>
                ))}
                {rows.length === 0 && <p className="text-[11px] text-gray-400 text-center py-4">Nothing here</p>}
              </div>
            </section>
          )
        })}
      </div>
      <p className="text-[11px] text-gray-400 mt-2">Tip: tap the ⚡ chips to send a reply in one tap · select cards for bulk done/snooze · scroll sideways for every bucket.</p>
    </div>
  )
}

function groupBySenderFn(rows: BoardItem[]): { sender: string | null; rows: BoardItem[] }[] {
  const map = new Map<string, BoardItem[]>()
  for (const r of rows) {
    const k = r.sender || '—'
    if (!map.has(k)) map.set(k, [])
    map.get(k)!.push(r)
  }
  // Senders with the most items first.
  return [...map.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([sender, rs]) => ({ sender, rows: rs }))
}

function SnoozeItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100">{label}</button>
  )
}

function Card({
  item, selected, onToggle, busy, replyBusyKey, snoozeOpen, onSnoozeToggle, onSnooze, onDone, onReopen, onReply,
}: {
  item: BoardItem
  selected: boolean
  onToggle: () => void
  busy: boolean
  replyBusyKey: string | null
  snoozeOpen: boolean
  onSnoozeToggle: () => void
  onSnooze: (days: number) => void
  onDone: () => void
  onReopen: () => void
  onReply: (intent?: string) => void
}) {
  return (
    <div className={`rounded-lg bg-white border p-2 ${selected ? 'border-gray-900 ring-1 ring-gray-900' : item.overdue ? 'border-rose-300' : 'border-gray-200'}`}>
      <div className="flex items-start gap-1.5">
        <input type="checkbox" checked={selected} onChange={onToggle} className="mt-0.5 h-3.5 w-3.5 cursor-pointer flex-shrink-0" aria-label="Select" />
        {item.is_vip && <Star className="h-3.5 w-3.5 text-amber-500 flex-shrink-0 mt-0.5" fill="currentColor" />}
        <p className="text-[13px] font-medium text-gray-900 leading-snug line-clamp-2 flex-1">{item.subject || '(no subject)'}</p>
        {item.amount_inr ? (
          <span className="text-[10px] font-semibold bg-rose-50 text-rose-700 px-1 py-0.5 rounded flex-shrink-0">{formatINRShort(item.amount_inr)}</span>
        ) : null}
      </div>

      {/* AI one-line summary (Auto-Summarize) */}
      {item.summary && <p className="text-[11px] text-gray-600 mt-1 line-clamp-2">{item.summary}</p>}
      <p className="text-[10px] text-gray-400 truncate mt-0.5">{item.sender || '—'}</p>

      {/* Smart-reply chips (Instant Reply) */}
      {item.smart_replies.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {item.smart_replies.map(chip => {
            const k = item.id + chip
            return (
              <button
                key={chip}
                type="button"
                onClick={() => onReply(chip)}
                disabled={replyBusyKey !== null}
                title={`Reply: ${chip}`}
                className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-teal-50 text-teal-700 border border-teal-200 hover:bg-teal-100 disabled:opacity-50"
              >
                {replyBusyKey === k ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <span>⚡</span>} {chip}
              </button>
            )
          })}
        </div>
      )}

      {/* Footer: meta + actions */}
      <div className="flex items-center justify-between mt-1.5">
        <div className="flex items-center gap-1.5 text-[10px] text-gray-400 min-w-0">
          <span className="flex-shrink-0">{item.age_days === 0 ? 'today' : `${item.age_days}d`}</span>
          {item.chase_on && (
            <span className={`flex-shrink-0 ${item.overdue ? 'text-rose-700 font-semibold' : 'text-blue-600'}`}>
              {item.overdue ? '⚠ ' : ''}{formatDateShort(item.chase_on)}
            </span>
          )}
          {item.status === 'snoozed' && <span className="flex-shrink-0">· snoozed</span>}
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {item.canReply && (
            <button type="button" onClick={() => onReply()} disabled={replyBusyKey !== null} title="AI reply" className="h-6 w-6 inline-flex items-center justify-center rounded text-teal-700 hover:bg-teal-50 disabled:opacity-50">
              {replyBusyKey === item.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CornerUpLeft className="h-3 w-3" />}
            </button>
          )}
          <a href={item.gmailUrl} target="_blank" rel="noopener noreferrer" title="Open in Gmail" className="h-6 w-6 inline-flex items-center justify-center rounded text-gray-500 hover:bg-gray-100">
            <ExternalLink className="h-3 w-3" />
          </a>
          <button type="button" onClick={onDone} disabled={busy} title="Mark done" className="h-6 w-6 inline-flex items-center justify-center rounded text-emerald-600 hover:bg-emerald-50 disabled:opacity-50">
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          </button>
          {item.status === 'snoozed' ? (
            <button type="button" onClick={onReopen} disabled={busy} title="Reopen" className="h-6 w-6 inline-flex items-center justify-center rounded text-gray-500 hover:bg-gray-100 disabled:opacity-50">
              <RotateCcw className="h-3 w-3" />
            </button>
          ) : (
            <div className="relative">
              <button type="button" onClick={onSnoozeToggle} disabled={busy} title="Snooze" className="h-6 w-6 inline-flex items-center justify-center rounded text-blue-600 hover:bg-blue-50 disabled:opacity-50">
                <Clock className="h-3 w-3" />
              </button>
              {snoozeOpen && (
                <div className="absolute right-0 mt-1 z-20 bg-white text-gray-800 rounded-lg shadow-lg border border-gray-200 py-1 w-32">
                  <SnoozeItem label="Later today" onClick={() => onSnooze(0)} />
                  <SnoozeItem label="Tomorrow" onClick={() => onSnooze(1)} />
                  <SnoozeItem label="Next week" onClick={() => onSnooze(7)} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
