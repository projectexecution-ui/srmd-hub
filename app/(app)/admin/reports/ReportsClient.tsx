'use client'
// Reports & digests: the scheduled-report table (channels · recipients · last
// sent · send now) and the people × messages mute matrix.

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Bell, Mail, Smartphone, Loader2, Send, Check, AlertTriangle, VolumeX, Volume2, Search, Settings2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatDateTime, cn } from '@/lib/utils'
import { saveChannel } from '../email/actions'

export interface ReportRow {
  key: string; label: string; moduleLabel: string; schedule: string; trigger: string
  channels: string[]; channelsOn: string[]; respectsRules: boolean; enabled: boolean
  recipients: string[]; who: string; warning?: string
  lastSent: string | null; job: string | null; settingsHref: string
  /** Has anything for this report ever gone out by Telegram? False = nobody on its list has linked Telegram, so "on" would be an empty promise. */
  telegramUsed: boolean
}
export interface MatrixUser { id: string; name: string; role: string }
export interface MuteRow { userId: string; event: string; channel: string }
interface EventCol { key: string; label: string; kind: 'instant' | 'scheduled' }

const CHANNEL_ICON: Record<string, React.ComponentType<{ className?: string }>> = { in_app: Bell, email: Mail, web_push: Smartphone, telegram: Send }
const CHANNEL_LABEL: Record<string, string> = { in_app: 'In-app', email: 'E-mail', web_push: 'Phone', telegram: 'Telegram' }
/** Every report shows the same four switches, in the same order, so the column reads as one control. */
const ALL_CHANNELS = ['in_app', 'email', 'web_push', 'telegram']
const MUTE_CHANNELS = ALL_CHANNELS

export function ReportsClient({ reports, events, users, initialMutes }: { reports: ReportRow[]; events: EventCol[]; users: MatrixUser[]; initialMutes: MuteRow[] }) {
  return (
    <div className="space-y-6">
      <ScheduledTable reports={reports} />
      <MuteMatrix events={events} users={users} initialMutes={initialMutes} />
    </div>
  )
}

/* ── the scheduled reports ─────────────────────────────────────────────────── */

function ScheduledTable({ reports }: { reports: ReportRow[] }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)

  function toggle(r: ReportRow, channel: string, on: boolean) {
    setBusyKey(`${r.key}:${channel}`); setNote(null)
    start(async () => {
      const res = await saveChannel(r.key, channel, on)
      setBusyKey(null)
      if (!res.ok) setNote({ ok: false, text: res.message })
      else router.refresh()
    })
  }

  async function sendNow(r: ReportRow) {
    if (!r.job) return
    setBusyKey(`${r.key}:send`); setNote(null)
    try {
      const res = await fetch('/api/cron/run-job', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: r.job }) })
      const j = await res.json().catch(() => ({}))
      setNote({ ok: res.ok, text: res.ok ? `${r.label} sent — to whoever is on its list right now.` : (j.error || `The job answered ${j.status ?? res.status}.`) })
      if (res.ok) router.refresh()
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : 'Could not run it.' })
    } finally {
      setBusyKey(null)
    }
  }

  const offCount = reports.filter(r => r.respectsRules && r.channelsOn.length === 0).length

  return (
    <section className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold text-gray-900">Scheduled reports &amp; digests <span className="ml-1 text-[11px] font-normal text-gray-400 tabular-nums">{reports.length}</span></h2>
          <p className="text-[12px] text-gray-500">Tap a channel to switch it on or off for everyone who gets that report. Green is on.{offCount > 0 && <span className="text-amber-700"> {offCount} report{offCount === 1 ? ' has' : 's have'} every channel off.</span>}</p>
        </div>
        <span className="hidden sm:inline-flex items-center gap-3 text-[11px] text-gray-500">
          {ALL_CHANNELS.map(c => { const Icon = CHANNEL_ICON[c]; return <span key={c} className="inline-flex items-center gap-1"><Icon className="h-3 w-3" />{CHANNEL_LABEL[c]}</span> })}
        </span>
      </div>
      {note && (
        <p className={cn('px-4 py-2 text-[12px] border-b inline-flex items-center gap-1.5 w-full', note.ok ? 'bg-emerald-50 border-emerald-100 text-emerald-800' : 'bg-rose-50 border-rose-100 text-rose-800')}>
          {note.ok ? <Check className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}{note.text}
        </p>
      )}

      {/* Desktop */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-2 font-semibold">Report</th>
              <th className="px-3 py-2 font-semibold w-[140px]">When</th>
              <th className="px-3 py-2 font-semibold w-[330px]">Channels</th>
              <th className="px-3 py-2 font-semibold">Goes to</th>
              <th className="px-3 py-2 font-semibold w-[150px]">Last sent</th>
              <th className="px-3 py-2 w-[56px]"><span className="sr-only">Send now</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {reports.map(r => (
              <tr key={r.key} className="align-middle hover:bg-gray-50/60">
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-900 leading-tight">{r.label}</div>
                  <div className="text-[11px] text-gray-500 mt-0.5 flex items-center gap-1.5">
                    <span>{r.moduleLabel}</span>
                    {r.settingsHref && r.settingsHref !== '/admin/notifications' && (
                      <Link href={r.settingsHref} className="inline-flex items-center gap-0.5 text-indigo-700 hover:underline"><Settings2 className="h-3 w-3" /> set up</Link>
                    )}
                  </div>
                </td>
                <td className="px-3 py-3 text-[12px] text-gray-600 leading-snug">{r.schedule}</td>
                <td className="px-3 py-3"><Channels r={r} busyKey={busyKey} pending={pending} onToggle={toggle} /></td>
                <td className="px-3 py-3 text-[12px] text-gray-700 leading-snug">
                  {r.recipients.length ? r.recipients.join(' · ') : <span className="text-gray-400">{r.who}</span>}
                  {r.warning && <p className="text-[11px] text-amber-700 mt-0.5 inline-flex items-center gap-1"><AlertTriangle className="h-3 w-3" />{r.warning}</p>}
                </td>
                <td className="px-3 py-3 text-[12px] text-gray-600 tabular-nums">{r.lastSent ? formatDateTime(r.lastSent) : <span className="text-gray-400">never</span>}</td>
                <td className="px-3 py-3 text-right"><SendNow r={r} busy={busyKey === `${r.key}:send`} onSend={sendNow} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Mobile */}
      <ul className="md:hidden divide-y divide-gray-100">
        {reports.map(r => (
          <li key={r.key} className="px-4 py-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div><div className="font-medium text-gray-900">{r.label}</div><div className="text-[11px] text-gray-500">{r.moduleLabel} · {r.schedule}</div></div>
              <SendNow r={r} busy={busyKey === `${r.key}:send`} onSend={sendNow} />
            </div>
            <Channels r={r} busyKey={busyKey} pending={pending} onToggle={toggle} />
            <div className="text-[12px] text-gray-700">{r.recipients.length ? r.recipients.join(' · ') : <span className="text-gray-400">{r.who}</span>}</div>
            {r.warning && <p className="text-[11px] text-amber-700 inline-flex items-center gap-1"><AlertTriangle className="h-3 w-3" />{r.warning}</p>}
            <div className="text-[11px] text-gray-500">Last sent {r.lastSent ? formatDateTime(r.lastSent) : 'never'}</div>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Three labelled switches, identical on every row. A report that sends to its own address list shows them greyed with the reason. */
function Channels({ r, busyKey, pending, onToggle }: { r: ReportRow; busyKey: string | null; pending: boolean; onToggle: (r: ReportRow, channel: string, on: boolean) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 gap-0.5" role="group" aria-label={`Channels for ${r.label}`}>
      {ALL_CHANNELS.map(c => {
        const Icon = CHANNEL_ICON[c] ?? Bell
        const applies = r.respectsRules
        const on = applies && r.channelsOn.includes(c)
        // Telegram only reaches people who linked it. Switched on but never used
        // by this report = nobody on its list has Telegram, so it stays grey.
        const idle = c === 'telegram' && on && !r.telegramUsed
        const busy = pending && busyKey === `${r.key}:${c}`
        const title = !applies ? 'Sends straight to its own address list — channels do not apply'
          : idle ? 'Telegram is allowed, but nothing has ever gone out by Telegram for this report — nobody who gets it has linked Telegram. Tap to switch off.'
          : `${CHANNEL_LABEL[c]}: ${on ? 'on — tap to switch off' : 'off — tap to switch on'}`
        return (
          <button key={c} type="button" disabled={busy || !applies} onClick={() => onToggle(r, c, !on)}
            aria-pressed={on}
            title={title}
            className={cn('inline-flex h-8 min-w-[74px] items-center justify-center gap-1.5 rounded-md px-2 text-[12px] font-medium',
              !applies ? 'text-gray-300 cursor-not-allowed'
              : idle ? 'text-gray-400 border border-dashed border-gray-300 hover:bg-gray-100'
              : on ? 'bg-emerald-600 text-white' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700')}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}{CHANNEL_LABEL[c]}
          </button>
        )
      })}
    </div>
  )
}

function SendNow({ r, busy, onSend }: { r: ReportRow; busy: boolean; onSend: (r: ReportRow) => void }) {
  if (!r.job) return <span className="text-[11px] text-gray-400 whitespace-nowrap">own trigger</span>
  return (
    <button type="button" disabled={busy} onClick={() => onSend(r)} title="Send now"
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-indigo-700 hover:bg-indigo-50 hover:border-indigo-200 disabled:opacity-60">
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
      <span className="sr-only">Send {r.label} now</span>
    </button>
  )
}

/* ── the people × messages matrix ─────────────────────────────────────────── */

function MuteMatrix({ events, users, initialMutes }: { events: EventCol[]; users: MatrixUser[]; initialMutes: MuteRow[] }) {
  const supabase = createClient()
  const [mutes, setMutes] = useState<Set<string>>(() => new Set(initialMutes.map(m => `${m.userId}|${m.event}`)))
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [hideAnonymous, setHideAnonymous] = useState(true)

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return users.filter(u => (!hideAnonymous || !/^anonymous$/i.test(u.name)) && (!s || u.name.toLowerCase().includes(s) || u.role.toLowerCase().includes(s)))
  }, [users, q, hideAnonymous])
  const byRole = useMemo(() => {
    const m = new Map<string, MatrixUser[]>()
    for (const u of shown) m.set(u.role, [...(m.get(u.role) ?? []), u])
    return [...m.entries()]
  }, [shown])

  async function flip(u: MatrixUser, e: EventCol) {
    const k = `${u.id}|${e.key}`
    const muted = mutes.has(k)
    setBusy(k); setError(null)
    if (muted) {
      const { error } = await supabase.from('notification_rules').delete().eq('scope', 'user').eq('scope_key', u.id).eq('event_type', e.key)
      setBusy(null)
      if (error) { setError(error.message); return }
      setMutes(p => { const n = new Set(p); n.delete(k); return n })
    } else {
      const rows = MUTE_CHANNELS.map(channel => ({ scope: 'user', scope_key: u.id, event_type: e.key, channel, enabled: false, updated_at: new Date().toISOString() }))
      const { error } = await supabase.from('notification_rules').upsert(rows, { onConflict: 'scope,scope_key,event_type,channel' })
      setBusy(null)
      if (error) { setError(error.message); return }
      setMutes(p => new Set(p).add(k))
    }
  }

  const mutedCount = mutes.size
  return (
    <section className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold text-gray-900">Who receives what <span className="ml-1 text-[11px] font-normal text-gray-400 tabular-nums">{shown.length} people · {events.length} messages · {mutedCount} muted</span></h2>
          <p className="text-[12px] text-gray-500">A tick means the person gets it whenever they are on that message&apos;s list. Tap to mute them from it on every channel; tap again to restore.</p>
        </div>
        <label className="relative">
          <Search className="h-3.5 w-3.5 text-gray-400 absolute left-2 top-1/2 -translate-y-1/2" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a person or role" className="h-9 rounded-lg border border-gray-200 pl-7 pr-2 text-[13px] w-56" />
        </label>
        <label className="inline-flex items-center gap-1.5 text-[12px] text-gray-600 select-none">
          <input type="checkbox" checked={hideAnonymous} onChange={e => setHideAnonymous(e.target.checked)} /> hide “Anonymous”
        </label>
      </div>
      {error && <p className="px-4 py-2 text-[12px] text-rose-700 border-b border-rose-100 bg-rose-50">{error}</p>}
      <div className="overflow-auto max-h-[70vh]">
        <table className="min-w-full border-separate border-spacing-0 text-sm table-fixed">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-30 bg-gray-50 border-b border-gray-200 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500 w-[220px] min-w-[220px] max-w-[220px]">Person</th>
              {events.map(e => (
                <th key={e.key} className="sticky top-0 z-20 bg-gray-50 border-b border-gray-200 px-1 py-2 text-center w-[92px] min-w-[92px] align-bottom" title={e.label}>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-600 leading-tight break-words">{e.label.replace(/^Cost Control — |^Bills — |^IN4 — /, '')}</div>
                  <div className="text-[9px] text-gray-400">{e.kind}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {byRole.map(([role, list]) => (
              <RoleBlock key={role} role={role} list={list} events={events} mutes={mutes} busy={busy} onFlip={flip} colCount={events.length + 1} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function RoleBlock({ role, list, events, mutes, busy, onFlip, colCount }: { role: string; list: MatrixUser[]; events: EventCol[]; mutes: Set<string>; busy: string | null; onFlip: (u: MatrixUser, e: EventCol) => void; colCount: number }) {
  return (
    <>
      <tr><td colSpan={colCount} className="sticky left-0 bg-white px-3 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">{role}</td></tr>
      {list.map(u => (
        <tr key={u.id} className="group">
          <td className="sticky left-0 z-10 bg-white border-b border-gray-100 px-3 py-1.5 w-[220px] min-w-[220px] max-w-[220px]">
            <div className="text-[13px] text-gray-900 truncate" title={u.name}>{u.name}</div>
          </td>
          {events.map(e => {
            const k = `${u.id}|${e.key}`
            const muted = mutes.has(k)
            const isBusy = busy === k
            return (
              <td key={e.key} className="border-b border-gray-100 px-1 py-1 text-center">
                <button type="button" disabled={isBusy} onClick={() => onFlip(u, e)} title={muted ? `${u.name} is muted from “${e.label}” — tap to restore` : `${u.name} gets “${e.label}” — tap to mute`}
                  className={cn('inline-flex h-7 w-7 items-center justify-center rounded-md border', muted ? 'border-rose-200 bg-rose-50 text-rose-600' : 'border-gray-200 bg-white text-emerald-600 hover:border-gray-300')}>
                  {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                </button>
              </td>
            )
          })}
        </tr>
      ))}
    </>
  )
}
