'use client'
// The Weekly report control screen: send buttons, channel switches, the list
// (edited locally, saved in one go), recipients, and a preview of this week's
// figures exactly as the card would group them.

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Check, Loader2, Send, FileText, Bell, Mail, Smartphone, Plus, Trash2 } from 'lucide-react'
import { cn, formatDateTime } from '@/lib/utils'
import { formatINRShort } from '@/lib/format-short'
import { confirm } from '@/components/ui/confirm-dialog'
import type { WeeklyConfig, WeeklyLine } from '@/lib/weekly-report/config'
import { UNPLACED_GROUP } from '@/lib/weekly-report/config'
import { saveWeeklyLines, setWeeklySwitch, setWeeklyRecipient, setWeeklyChannel, type Result } from './actions'

export interface WeeklyPageData {
  cfg: WeeklyConfig
  lines: Array<{ name: string; group: string; budget: number; approved: number; spent: number }>
  unplaced: string[]
  missing: string[]
  preview: Array<{ name: string; budget: number; approved: number; spent: number; lines: Array<{ name: string; budget: number; approved: number; spent: number; deltaPaid: number }> }>
  totals: { budget: number; approved: number; spent: number; area: number; deltaPaid: number }
  hasBaseline: boolean
  prevSnapshotWeek: string | null
  budgetAsOf: string | null
  thisMonday: string
  lastSent: string | null
  channels: { in_app: boolean; email: boolean; web_push: boolean }
  groupConnected: boolean
  people: Array<{ id: string; name: string; roleLabel: string; ccRole: string }>
  recipients: Array<{ id: string; card: boolean; email: boolean }>
  recipientsChosen: boolean
}

const cr = (v: number) => formatINRShort(v)
const pct = (spent: number, budget: number) => (budget > 0 ? Math.round((spent / budget) * 100) : null)

export function WeeklyClient({ data }: { data: WeeklyPageData }) {
  const router = useRouter()
  const [, start] = useTransition()
  const [busy, setBusy] = useState<string | null>(null)
  const [flash, setFlash] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)

  function run(key: string, fn: () => Promise<Result>, okText?: string) {
    setBusy(key); setFlash(null)
    start(async () => {
      const r = await fn()
      setBusy(null)
      if (!r.ok) { setFlash({ tone: 'bad', text: r.message ?? 'Could not save.' }); return }
      if (okText) setFlash({ tone: 'ok', text: okText })
      router.refresh()
    })
  }

  async function post(key: string, body: Record<string, boolean>, okText: (r: Record<string, unknown>) => string) {
    setBusy(key); setFlash(null)
    try {
      const res = await fetch('/api/cron/cc-budget-vs-actual', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const j = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (!res.ok || j.ok === false) setFlash({ tone: 'bad', text: String(j.reason ?? `Failed (${res.status})`) })
      else { setFlash({ tone: 'ok', text: okText(j) }); router.refresh() }
    } catch (e) { setFlash({ tone: 'bad', text: e instanceof Error ? e.message : 'Network error' }) }
    setBusy(null)
  }

  const sentThisWeek = data.cfg.lastSentWeek === data.thisMonday

  return (
    <div className="space-y-4">
      {flash && (
        <p className={cn('rounded-lg border px-4 py-2 text-[13px] inline-flex items-center gap-2', flash.tone === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-rose-200 bg-rose-50 text-rose-800')}>
          {flash.tone === 'ok' ? <Check className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}{flash.text}
        </p>
      )}

      {/* Status + send */}
      <section className="rounded-2xl border border-gray-200 bg-white p-4 flex flex-wrap items-center gap-4">
        <div className="min-w-0 flex-1 text-[13px] text-gray-700 space-y-0.5">
          <p><b>Next send</b> Monday {fmtDate(data.thisMonday, sentThisWeek)} at 09:00 IST{sentThisWeek ? ' — already sent this week' : ''}.</p>
          <p><b>Last went out</b> {data.lastSent ? formatDateTime(data.lastSent) : 'never'} · <b>IN4 figures as of</b> {data.budgetAsOf ? formatDateTime(data.budgetAsOf) : 'not synced'}.</p>
          <p><b>“This week” compares with</b> {data.hasBaseline ? `the Monday ${data.prevSnapshotWeek} send` : 'nothing yet — the first send saves the baseline, so Δ appears from the second Monday'}.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={!!busy} onClick={() => post('me', { onlyMe: true }, () => 'Preview sent to you — check the bell and your Telegram.')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-[13px] font-semibold min-h-[40px] hover:bg-gray-50 disabled:opacity-60">
            {busy === 'me' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send me a preview
          </button>
          <button type="button" disabled={!!busy || !data.groupConnected} title={data.groupConnected ? '' : 'No Telegram reports group is connected'} onClick={() => post('group', { group: true }, r => `${r.sent} of ${r.total} PDFs posted to the group.`)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-[13px] font-semibold min-h-[40px] hover:bg-gray-50 disabled:opacity-60">
            {busy === 'group' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} PDFs to group (test)
          </button>
          <button type="button" disabled={!!busy} onClick={async () => { if (await confirm(sentThisWeek ? 'This week already went out. Send it again to everyone?' : 'Send the real Monday report to everyone now? This marks the week as sent.')) post('now', { sendNow: true }, r => `Sent to ${r.sent} people${r.group ? ` · group ${r.group}` : ''}. Week ${r.week} marked as sent.`) }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-[13px] font-semibold text-white min-h-[40px] hover:bg-indigo-700 disabled:opacity-60">
            {busy === 'now' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send now
          </button>
        </div>
      </section>

      {/* Channels */}
      <section className="rounded-2xl border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-bold text-gray-900">Channels</h2>
        <p className="text-[12px] text-gray-500 mb-3">Switch a channel off for everyone at once — for example e-mail when inboxes fill up. Per-person choices are below.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          <ChannelRow icon={Bell} label="In-app card" hint="The bell in the hub, and the Telegram card for people who linked Telegram" on={data.channels.in_app} busy={busy === 'ch:in_app'} onClick={() => run('ch:in_app', () => setWeeklyChannel('in_app', !data.channels.in_app))} />
          <ChannelRow icon={Mail} label="E-mail" hint="One mail per recipient, Monday morning" on={data.channels.email} busy={busy === 'ch:email'} onClick={() => run('ch:email', () => setWeeklyChannel('email', !data.channels.email))} />
          <ChannelRow icon={Smartphone} label="Phone" hint="Browser notification, for people who turned it on" on={data.channels.web_push} busy={busy === 'ch:web_push'} onClick={() => run('ch:web_push', () => setWeeklyChannel('web_push', !data.channels.web_push))} />
          <ChannelRow icon={FileText} label="PDFs to the Telegram group" hint={data.groupConnected ? 'One-pager, by category, by sub-category, one file per main project' : 'No group connected — connect it from the Telegram card on Cost Control settings'} on={data.cfg.groupPdfs && data.groupConnected} busy={busy === 'ch:group'} onClick={() => run('ch:group', () => setWeeklySwitch('groupPdfs', !data.cfg.groupPdfs))} />
        </div>
      </section>

      <LinesEditor data={data} busy={busy} run={run} />

      <Recipients data={data} busy={busy} run={run} />

      <Preview data={data} />
    </div>
  )
}

function fmtDate(iso: string, past: boolean) {
  const d = new Date(iso + 'T00:00:00+05:30')
  const s = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })
  return past ? s : s
}

function ChannelRow({ icon: Icon, label, hint, on, busy, onClick }: { icon: React.ComponentType<{ className?: string }>; label: string; hint: string; on: boolean; busy: boolean; onClick: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 px-3 py-2.5 min-h-[56px]">
      <span className="flex items-start gap-2 min-w-0"><Icon className="h-4 w-4 text-gray-500 mt-0.5 flex-shrink-0" /><span className="min-w-0"><span className="block text-[13px] font-medium text-gray-900">{label}</span><span className="block text-[11px] text-gray-500">{hint}</span></span></span>
      <Switch on={on} busy={busy} label={label} onClick={onClick} />
    </div>
  )
}

function Switch({ on, busy, label, onClick, disabled }: { on: boolean; busy: boolean; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={busy || disabled} onClick={onClick}
      className={cn('relative h-6 w-11 flex-none rounded-full transition-colors disabled:opacity-50', on ? 'bg-emerald-600' : 'bg-gray-300')}>
      <span className={cn('absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform grid place-items-center', on && 'translate-x-5')}>
        {busy && <Loader2 className="h-3 w-3 animate-spin text-gray-500" />}
      </span>
    </button>
  )
}

/* ── The list ─────────────────────────────────────────────────────────────── */

function LinesEditor({ data, busy, run }: { data: WeeklyPageData; busy: string | null; run: (k: string, fn: () => Promise<Result>, ok?: string) => void }) {
  const [lines, setLines] = useState<WeeklyLine[]>(() => [
    ...data.cfg.lines,
    // Unplaced IN4 lines appear at the bottom, waiting for a main project.
    ...data.unplaced.map(n => ({ in4: n, project: '', label: undefined })),
  ])
  const [dirty, setDirty] = useState(false)
  const byName = useMemo(() => new Map(data.lines.map(l => [l.name, l])), [data.lines])
  const projects = useMemo(() => [...new Set(lines.map(l => l.project).filter(Boolean))], [lines])
  const missing = new Set(data.missing)

  function update(i: number, patch: Partial<WeeklyLine>) {
    setLines(prev => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)))
    setDirty(true)
  }
  function remove(i: number) { setLines(prev => prev.filter((_, j) => j !== i)); setDirty(true) }
  function save() {
    const clean = lines.filter(l => l.project.trim()).map(l => ({ ...l, project: l.project.trim(), label: l.label?.trim() || undefined }))
    run('lines', () => saveWeeklyLines(clean), 'List saved. The preview below shows the new grouping.')
    setDirty(false)
  }

  return (
    <section className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold text-gray-900">What goes in, and under which main project <span className="ml-1 text-[11px] font-normal text-gray-400 tabular-nums">{lines.length} IN4 lines · {projects.length} main projects</span></h2>
          <p className="text-[12px] text-gray-500">Each IN4 line sits under a main project. Give two lines the same “shown as” name inside one project and they merge into one row. Tick Design to hide a line until the Design switch is on.</p>
        </div>
        <label className="inline-flex items-center gap-2 text-[13px] text-gray-700"><Switch on={data.cfg.includeDesign} busy={busy === 'design'} label="Include Design lines" onClick={() => run('design', () => setWeeklySwitch('includeDesign', !data.cfg.includeDesign))} /> Include Design lines</label>
        <button type="button" disabled={!dirty || busy === 'lines'} onClick={save} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-[13px] font-semibold text-white min-h-[40px] hover:bg-indigo-700 disabled:opacity-50">
          {busy === 'lines' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save list
        </button>
      </div>
      {data.unplaced.length > 0 && (
        <p className="px-4 py-2 text-[12px] text-amber-900 bg-amber-50 border-b border-amber-100 inline-flex items-center gap-1.5 w-full"><AlertTriangle className="h-3.5 w-3.5" />{data.unplaced.length} IN4 line{data.unplaced.length === 1 ? '' : 's'} with money {data.unplaced.length === 1 ? 'has' : 'have'} no main project yet — {data.unplaced.join(', ')}. Until placed, they are reported under “{UNPLACED_GROUP}”.</p>
      )}
      <div className="overflow-auto max-h-[70vh]">
        <table className="min-w-full text-sm border-separate border-spacing-0">
          <thead>
            <tr className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 text-left">IN4 line</th>
              <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 text-left">Main project</th>
              <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 text-left">Shown as</th>
              <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-2 py-2 text-center">Design</th>
              <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-2 py-2 text-center">Show</th>
              <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 text-right">Budget</th>
              <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 text-right">Paid</th>
              <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const src = byName.get(l.in4)
              const gone = missing.has(l.in4)
              const unplaced = !l.project
              return (
                <tr key={l.in4} className={cn(unplaced && 'bg-amber-50/60', gone && 'opacity-60')}>
                  <td className="border-b border-gray-100 px-3 py-1.5 text-[13px] text-gray-900 whitespace-nowrap">{l.in4}{gone && <span className="ml-1.5 text-[10px] uppercase text-rose-600">not in IN4 now</span>}</td>
                  <td className="border-b border-gray-100 px-3 py-1">
                    <input list="wk-projects" value={l.project} placeholder="Pick or type a main project" onChange={e => update(i, { project: e.target.value })}
                      className={cn('h-8 w-full min-w-[180px] rounded-md border px-2 text-[13px]', unplaced ? 'border-amber-400' : 'border-gray-200')} />
                  </td>
                  <td className="border-b border-gray-100 px-3 py-1">
                    <input value={l.label ?? ''} placeholder={l.in4} onChange={e => update(i, { label: e.target.value || undefined })} className="h-8 w-full min-w-[180px] rounded-md border border-gray-200 px-2 text-[13px]" />
                  </td>
                  <td className="border-b border-gray-100 px-2 py-1 text-center"><input type="checkbox" checked={!!l.design} onChange={e => update(i, { design: e.target.checked || undefined })} aria-label={`${l.in4} is a Design line`} /></td>
                  <td className="border-b border-gray-100 px-2 py-1 text-center"><input type="checkbox" checked={l.show !== false} onChange={e => update(i, { show: e.target.checked ? undefined : false })} aria-label={`Show ${l.in4}`} /></td>
                  <td className="border-b border-gray-100 px-3 py-1 text-right tabular-nums text-[13px] text-gray-700">{src ? cr(src.budget) : '—'}</td>
                  <td className="border-b border-gray-100 px-3 py-1 text-right tabular-nums text-[13px] text-gray-700">{src ? cr(src.spent) : '—'}</td>
                  <td className="border-b border-gray-100 px-2 py-1 text-center">{gone && <button type="button" title="Remove this line from the list" onClick={() => remove(i)} className="text-gray-400 hover:text-rose-600"><Trash2 className="h-3.5 w-3.5" /></button>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <datalist id="wk-projects">{projects.map(p => <option key={p} value={p} />)}</datalist>
      </div>
      <p className="px-4 py-2 text-[11px] text-gray-400 inline-flex items-center gap-1"><Plus className="h-3 w-3" /> A new main project is made by typing its name in the Main project box. Amber rows are IN4 lines waiting for one.</p>
    </section>
  )
}

/* ── Recipients ───────────────────────────────────────────────────────────── */

function Recipients({ data, busy, run }: { data: WeeklyPageData; busy: string | null; run: (k: string, fn: () => Promise<Result>) => void }) {
  const [showAll, setShowAll] = useState(false)
  const rec = new Map(data.recipients.map(r => [r.id, r]))
  const shown = data.people.filter(p => showAll || rec.has(p.id))
  const byRole = new Map<string, typeof shown>()
  for (const p of shown) byRole.set(p.roleLabel, [...(byRole.get(p.roleLabel) ?? []), p])
  return (
    <section className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold text-gray-900">Who gets it <span className="ml-1 text-[11px] font-normal text-gray-400 tabular-nums">{data.recipients.length} people</span></h2>
          <p className="text-[12px] text-gray-500">{data.recipientsChosen ? 'Chosen by hand. ' : 'Not chosen yet, so everyone holding a management role gets it. The first tap keeps this list and makes it yours. '}“Gets it” = the bell, the Telegram card and the phone alert. E-mail is separate, so you can quieten inboxes without losing the card. Switching “Gets it” off stops everything for that person.</p>
        </div>
        <label className="inline-flex items-center gap-1.5 text-[12px] text-gray-600 select-none"><input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} /> show everyone</label>
      </div>
      <div className="overflow-auto">
        <table className="min-w-full text-sm">
          <thead><tr className="text-[11px] font-semibold uppercase tracking-wide text-gray-500"><th className="px-3 py-2 text-left border-b border-gray-200">Person</th><th className="px-3 py-2 text-center border-b border-gray-200 w-28">Gets it</th><th className="px-3 py-2 text-center border-b border-gray-200 w-28">E-mail</th></tr></thead>
          <tbody>
            {[...byRole.entries()].map(([role, list]) => (
              <RoleRows key={role} role={role}>
                {list.map(p => {
                  const r = rec.get(p.id) ?? { id: p.id, card: false, email: false }
                  return (
                    <tr key={p.id}>
                      <td className="border-b border-gray-100 px-3 py-1.5 text-[13px] text-gray-900">{p.name}</td>
                      <td className="border-b border-gray-100 px-3 py-1.5 text-center"><Switch on={r.card} busy={busy === `r:${p.id}:card`} label={`Card for ${p.name}`} onClick={() => run(`r:${p.id}:card`, () => setWeeklyRecipient(p.id, 'card', !r.card, data.recipients))} /></td>
                      <td className="border-b border-gray-100 px-3 py-1.5 text-center"><Switch on={r.card && r.email} disabled={!r.card} busy={busy === `r:${p.id}:email`} label={`E-mail for ${p.name}`} onClick={() => run(`r:${p.id}:email`, () => setWeeklyRecipient(p.id, 'email', !r.email, data.recipients))} /></td>
                    </tr>
                  )
                })}
              </RoleRows>
            ))}
            {shown.length === 0 && <tr><td colSpan={3} className="px-3 py-6 text-center text-[13px] text-gray-400">Nobody yet — tick “show everyone” and switch people on.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  )
}
function RoleRows({ role, children }: { role: string; children: React.ReactNode }) {
  return (<><tr><td colSpan={3} className="px-3 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">{role}</td></tr>{children}</>)
}

/* ── Preview ──────────────────────────────────────────────────────────────── */

function Preview({ data }: { data: WeeklyPageData }) {
  const t = data.totals
  return (
    <section className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100">
        <h2 className="text-sm font-bold text-gray-900">This week’s figures, grouped as the report will show them</h2>
        <p className="text-[12px] text-gray-500">{data.preview.reduce((s, g) => s + g.lines.length, 0)} lines under {data.preview.length} main projects · Budget {cr(t.budget)} · Paid {cr(t.spent)} ({pct(t.spent, t.budget) ?? 0}%) · Balance {cr(t.budget - t.spent)}{data.hasBaseline ? ` · this week ${t.deltaPaid >= 0 ? '+' : '−'}${cr(Math.abs(t.deltaPaid))}` : ''}</p>
      </div>
      <div className="overflow-auto max-h-[70vh]">
        <table className="min-w-full text-sm border-separate border-spacing-0">
          <thead>
            <tr className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 text-left">Main project · line</th>
              <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 text-right">Budget</th>
              <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 text-right">Approved</th>
              <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 text-right">Paid</th>
              <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 text-right">Balance</th>
              <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 text-right">Used</th>
              <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 text-right">Δ Paid (wk)</th>
            </tr>
          </thead>
          <tbody>
            {data.preview.map(g => (
              <GroupRows key={g.name} g={g} hasBaseline={data.hasBaseline} />
            ))}
            <tr className="font-bold">
              <td className="px-3 py-2 border-t-2 border-gray-300">TOTAL</td>
              <td className="px-3 py-2 border-t-2 border-gray-300 text-right tabular-nums">{cr(t.budget)}</td>
              <td className="px-3 py-2 border-t-2 border-gray-300 text-right tabular-nums text-sky-800">{cr(t.approved)}</td>
              <td className="px-3 py-2 border-t-2 border-gray-300 text-right tabular-nums">{cr(t.spent)}</td>
              <td className={cn('px-3 py-2 border-t-2 border-gray-300 text-right tabular-nums', t.budget - t.spent < 0 && 'text-rose-700')}>{cr(t.budget - t.spent)}</td>
              <td className="px-3 py-2 border-t-2 border-gray-300 text-right tabular-nums">{pct(t.spent, t.budget) ?? '—'}{pct(t.spent, t.budget) != null && '%'}</td>
              <td className="px-3 py-2 border-t-2 border-gray-300 text-right tabular-nums">{data.hasBaseline ? delta(t.deltaPaid) : '—'}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  )
}
function GroupRows({ g, hasBaseline }: { g: WeeklyPageData['preview'][number]; hasBaseline: boolean }) {
  const single = g.lines.length === 1 && g.lines[0].name === g.name
  const gp = pct(g.spent, g.budget)
  const dg = g.lines.reduce((s, l) => s + l.deltaPaid, 0)
  const isUnplaced = g.name === UNPLACED_GROUP
  return (
    <>
      <tr className={cn('font-semibold', isUnplaced ? 'bg-amber-50' : 'bg-gray-50')}>
        <td className="px-3 py-1.5 border-b border-gray-100 text-[13px]">{g.name}{isUnplaced && <span className="ml-1.5 text-[10px] uppercase text-amber-700">place these above</span>}</td>
        <td className="px-3 py-1.5 border-b border-gray-100 text-right tabular-nums">{cr(g.budget)}</td>
        <td className="px-3 py-1.5 border-b border-gray-100 text-right tabular-nums text-sky-800">{cr(g.approved)}</td>
        <td className="px-3 py-1.5 border-b border-gray-100 text-right tabular-nums">{cr(g.spent)}</td>
        <td className={cn('px-3 py-1.5 border-b border-gray-100 text-right tabular-nums', g.budget - g.spent < 0 && 'text-rose-700')}>{cr(g.budget - g.spent)}</td>
        <td className={cn('px-3 py-1.5 border-b border-gray-100 text-right tabular-nums', gp != null && gp >= 100 ? 'text-rose-700' : gp != null && gp >= 85 ? 'text-amber-700' : '')}>{gp != null ? `${gp}%` : '—'}</td>
        <td className="px-3 py-1.5 border-b border-gray-100 text-right tabular-nums">{hasBaseline ? delta(dg) : '—'}</td>
      </tr>
      {!single && g.lines.map(l => {
        const lp = pct(l.spent, l.budget)
        return (
          <tr key={l.name} className="text-[13px] text-gray-700">
            <td className="px-3 py-1 pl-7 border-b border-gray-100">{l.name}</td>
            <td className="px-3 py-1 border-b border-gray-100 text-right tabular-nums">{cr(l.budget)}</td>
            <td className="px-3 py-1 border-b border-gray-100 text-right tabular-nums text-sky-800">{cr(l.approved)}</td>
            <td className="px-3 py-1 border-b border-gray-100 text-right tabular-nums">{cr(l.spent)}</td>
            <td className={cn('px-3 py-1 border-b border-gray-100 text-right tabular-nums', l.budget - l.spent < 0 && 'text-rose-700')}>{cr(l.budget - l.spent)}</td>
            <td className={cn('px-3 py-1 border-b border-gray-100 text-right tabular-nums', lp != null && lp >= 100 ? 'text-rose-700' : lp != null && lp >= 85 ? 'text-amber-700' : '')}>{lp != null ? `${lp}%` : '—'}</td>
            <td className="px-3 py-1 border-b border-gray-100 text-right tabular-nums">{hasBaseline ? delta(l.deltaPaid) : '—'}</td>
          </tr>
        )
      })}
    </>
  )
}
const delta = (v: number) => (v === 0 ? '—' : `${v > 0 ? '+' : '−'}${cr(Math.abs(v))}`)
