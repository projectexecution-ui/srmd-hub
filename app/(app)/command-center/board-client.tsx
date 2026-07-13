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
  Users, CheckCheck, X, Zap,
} from 'lucide-react'
import { TriageMode } from './triage-mode'

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
// Per-category chrome: header text, count pill, dot, and the card's left accent.
const COL: Record<EccCategory, { text: string; pill: string; dot: string; accent: string }> = {
  do_today:      { text: 'text-rose-600',   pill: 'bg-rose-50 text-rose-600',     dot: 'bg-rose-500',   accent: 'border-l-rose-400' },
  this_week:     { text: 'text-amber-600',  pill: 'bg-amber-50 text-amber-600',   dot: 'bg-amber-500',  accent: 'border-l-amber-400' },
  monitor:       { text: 'text-blue-600',   pill: 'bg-blue-50 text-blue-600',     dot: 'bg-blue-500',   accent: 'border-l-blue-400' },
  draft_pending: { text: 'text-purple-600', pill: 'bg-purple-50 text-purple-600', dot: 'bg-purple-500', accent: 'border-l-purple-400' },
  just_know:     { text: 'text-slate-500',  pill: 'bg-slate-100 text-slate-500',  dot: 'bg-slate-400',  accent: 'border-l-slate-300' },
  delete:        { text: 'text-slate-400',  pill: 'bg-slate-100 text-slate-400',  dot: 'bg-slate-300',  accent: 'border-l-slate-200' },
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
  const [triageOpen, setTriageOpen] = useState(false)

  const shownCats = CATS.filter(c => items.some(i => i.category === c))
  const triageCount = items.filter(i => (['do_today', 'this_week', 'monitor', 'draft_pending'] as EccCategory[]).includes(i.category)).length

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
      {triageOpen && <TriageMode items={items} onClose={() => { setTriageOpen(false); router.refresh() }} />}

      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {triageCount > 0 && (
          <button
            type="button"
            onClick={() => setTriageOpen(true)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3.5 py-1.5 rounded-lg bg-gray-900 text-white hover:bg-gray-800 transition shadow-sm"
          >
            <Zap className="h-3.5 w-3.5" fill="currentColor" /> Triage {triageCount}
          </button>
        )}
        <button
          type="button"
          onClick={() => setGroupBySender(g => !g)}
          className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg ring-1 transition ${groupBySender ? 'bg-gray-900 text-white ring-gray-900' : 'bg-white text-gray-600 ring-gray-200 hover:bg-gray-50'}`}
        >
          <Users className="h-3.5 w-3.5" /> Group by sender
        </button>
        {err && <span className="text-xs text-rose-700">{err}</span>}

        {selected.size > 0 && (
          <div className="ml-auto flex items-center gap-1 bg-gray-900 text-white rounded-xl px-2 py-1.5 text-xs shadow-lg">
            <span className="font-semibold px-1">{selected.size} selected</span>
            <button type="button" onClick={() => bulk({ status: 'done' })} disabled={busyId === 'bulk'} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-white/15">
              {busyId === 'bulk' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />} Done
            </button>
            <div className="relative">
              <button type="button" onClick={() => setSnoozeMenu(snoozeMenu === 'bulk' ? null : 'bulk')} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-white/15">
                <Clock className="h-3.5 w-3.5" /> Snooze
              </button>
              {snoozeMenu === 'bulk' && (
                <div className="absolute right-0 mt-1.5 z-20 bg-white text-gray-800 rounded-xl shadow-xl ring-1 ring-gray-200 py-1 w-36">
                  <SnoozeItem label="Later today" onClick={() => bulk({ status: 'snoozed', chase_on: dateInDays(0) })} />
                  <SnoozeItem label="Tomorrow" onClick={() => bulk({ status: 'snoozed', chase_on: dateInDays(1) })} />
                  <SnoozeItem label="Next week" onClick={() => bulk({ status: 'snoozed', chase_on: dateInDays(7) })} />
                </div>
              )}
            </div>
            <button type="button" onClick={() => setSelected(new Set())} className="inline-flex items-center px-1.5 py-1 rounded-lg hover:bg-white/15"><X className="h-3.5 w-3.5" /></button>
          </div>
        )}
      </div>

      {/* Board */}
      <div className="flex gap-4 overflow-x-auto pb-3 -mx-1 px-1">
        {shownCats.map(cat => {
          const rows = items.filter(i => i.category === cat)
          const meta = COL[cat]
          const groups = groupBySender ? groupBySenderFn(rows) : [{ sender: null, rows }]
          return (
            <section key={cat} id={`col-${cat}`} className="flex-shrink-0 w-[320px] scroll-mt-4">
              <div className="flex items-center justify-between px-1 mb-2.5">
                <div className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
                  <span className={`text-[11px] font-bold uppercase tracking-wide ${meta.text}`}>{LABELS[cat]}</span>
                </div>
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${meta.pill}`}>{rows.length}</span>
              </div>
              <div className="space-y-2 max-h-[72vh] overflow-y-auto pr-1 pb-1">
                {groups.map((g, gi) => (
                  <div key={g.sender ?? gi} className="space-y-2">
                    {g.sender && (
                      <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide px-1 pt-1 flex items-center gap-1">
                        {g.sender} <span className="text-gray-300">· {g.rows.length}</span>
                      </div>
                    )}
                    {g.rows.map(item => (
                      <Card
                        key={item.id}
                        item={item}
                        accent={meta.accent}
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
                {rows.length === 0 && <p className="text-[11px] text-gray-300 text-center py-6">Nothing here</p>}
              </div>
            </section>
          )
        })}
      </div>
      <p className="text-[11px] text-gray-400 mt-3">Tip: tap the ⚡ chips to reply in one tap · select cards for bulk done/snooze · scroll sideways for every bucket.</p>
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
  item, accent, selected, onToggle, busy, replyBusyKey, snoozeOpen, onSnoozeToggle, onSnooze, onDone, onReopen, onReply,
}: {
  item: BoardItem
  accent: string
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
  const ringCls = selected
    ? 'ring-2 ring-gray-900'
    : item.overdue
      ? 'ring-1 ring-rose-200'
      : 'ring-1 ring-gray-200/70'
  return (
    <div className={`group rounded-xl bg-white p-2.5 shadow-sm border-l-[3px] ${accent} ${ringCls} transition-all hover:shadow-md hover:-translate-y-0.5`}>
      <div className="flex items-start gap-1.5">
        <input type="checkbox" checked={selected} onChange={onToggle} className="mt-0.5 h-3.5 w-3.5 cursor-pointer flex-shrink-0 accent-gray-900" aria-label="Select" />
        {item.is_vip && <Star className="h-3.5 w-3.5 text-amber-400 flex-shrink-0 mt-0.5" fill="currentColor" />}
        <p className="text-[13px] font-semibold text-gray-900 leading-snug line-clamp-2 flex-1">{item.subject || '(no subject)'}</p>
        {item.amount_inr ? (
          <span className="text-[10px] font-bold bg-rose-50 text-rose-700 ring-1 ring-rose-200/70 px-1.5 py-0.5 rounded-md flex-shrink-0">{formatINRShort(item.amount_inr)}</span>
        ) : null}
      </div>

      {/* AI one-line summary */}
      {item.summary && <p className="text-[11.5px] text-gray-600 mt-1 leading-snug line-clamp-2">{item.summary}</p>}
      <p className="text-[10px] text-gray-400 truncate mt-1">{item.sender || '—'}</p>

      {/* Smart-reply chips */}
      {item.smart_replies.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {item.smart_replies.map(chip => {
            const k = item.id + chip
            return (
              <button
                key={chip}
                type="button"
                onClick={() => onReply(chip)}
                disabled={replyBusyKey !== null}
                title={`Reply: ${chip}`}
                className="inline-flex items-center gap-0.5 text-[10.5px] px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 ring-1 ring-teal-200/70 hover:bg-teal-100 disabled:opacity-50 transition"
              >
                {replyBusyKey === k ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <span>⚡</span>} {chip}
              </button>
            )
          })}
        </div>
      )}

      {/* Footer: meta + actions */}
      <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-gray-100">
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
            <button type="button" onClick={() => onReply()} disabled={replyBusyKey !== null} title="AI reply" className="h-6 w-6 inline-flex items-center justify-center rounded-md text-teal-600 hover:bg-teal-50 disabled:opacity-50">
              {replyBusyKey === item.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CornerUpLeft className="h-3 w-3" />}
            </button>
          )}
          <a href={item.gmailUrl} target="_blank" rel="noopener noreferrer" title="Open in Gmail" className="h-6 w-6 inline-flex items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-600">
            <ExternalLink className="h-3 w-3" />
          </a>
          <button type="button" onClick={onDone} disabled={busy} title="Mark done" className="h-6 w-6 inline-flex items-center justify-center rounded-md text-emerald-600 hover:bg-emerald-50 disabled:opacity-50">
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          </button>
          {item.status === 'snoozed' ? (
            <button type="button" onClick={onReopen} disabled={busy} title="Reopen" className="h-6 w-6 inline-flex items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50">
              <RotateCcw className="h-3 w-3" />
            </button>
          ) : (
            <div className="relative">
              <button type="button" onClick={onSnoozeToggle} disabled={busy} title="Snooze" className="h-6 w-6 inline-flex items-center justify-center rounded-md text-blue-600 hover:bg-blue-50 disabled:opacity-50">
                <Clock className="h-3 w-3" />
              </button>
              {snoozeOpen && (
                <div className="absolute right-0 mt-1.5 z-20 bg-white text-gray-800 rounded-xl shadow-xl ring-1 ring-gray-200 py-1 w-36">
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
