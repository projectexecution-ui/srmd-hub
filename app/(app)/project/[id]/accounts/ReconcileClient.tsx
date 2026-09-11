'use client'
// Reconcile with Trust: download the statement, upload the reply, and act on
// what the Trust could not match.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Download, Upload, Loader2, Check, AlertTriangle, RotateCcw } from 'lucide-react'
import { cn, formatINR, formatDate } from '@/lib/utils'
import { markExplained, reopen } from './actions'

export interface OpenItem {
  id: string; date: string | null; party: string; against: string | null; billNo: string | null
  paid: number; status: 'not_found' | 'differs' | 'explained'; amountInBooks: number | null; bankDate: string | null; bankRef: string | null; remark: string | null
}
export interface ReconcileProps {
  projectId: string
  fys: string[]
  lastStatement: { created_at: string; range_label: string; row_count: number; file_name: string } | null
  totals: { paid: number; confirmedPaid: number; awaitingPaid: number; count: number; confirmedCount: number; awaitingCount: number }
  open: OpenItem[]
}

export function ReconcileClient({ projectId, fys, lastStatement, totals, open }: ReconcileProps) {
  const router = useRouter()
  const [, start] = useTransition()
  const [range, setRange] = useState('unconfirmed')
  const [busy, setBusy] = useState<string | null>(null)
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})

  async function upload(file: File) {
    setBusy('upload'); setFlash(null)
    try {
      const fd = new FormData(); fd.append('file', file)
      const res = await fetch(`/api/accounts/${projectId}/reply`, { method: 'POST', body: fd })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || j.ok === false) { setFlash({ ok: false, text: String(j.reason ?? `Upload failed (${res.status})`) }); return }
      const extra = Array.isArray(j.notInIn4) && j.notInIn4.length ? ` The Trust also listed ${j.notInIn4.length} payment${j.notInIn4.length === 1 ? '' : 's'} not in IN4: ${j.notInIn4.slice(0, 3).map((x: { party: string; amount: number | null }) => `${x.party} ${x.amount != null ? formatINR(x.amount) : ''}`).join(', ')}${j.notInIn4.length > 3 ? '…' : ''}.` : ''
      setFlash({ ok: true, text: `Read ${j.read} rows: ${j.confirmed} confirmed, ${j.notFound} not found, ${j.differs} differ${j.unknown ? `, ${j.unknown} with an ID CT Hub does not know` : ''}.${extra}` })
      router.refresh()
    } catch (e) { setFlash({ ok: false, text: e instanceof Error ? e.message : 'Upload failed' }) }
    finally { setBusy(null) }
  }
  function act(key: string, fn: () => Promise<{ ok: boolean; message?: string }>) {
    setBusy(key); setFlash(null)
    start(async () => { const r = await fn(); setBusy(null); if (!r.ok) setFlash({ ok: false, text: r.message ?? 'Could not save.' }); else router.refresh() })
  }

  const pct = totals.paid > 0 ? Math.round((totals.confirmedPaid / totals.paid) * 100) : 0
  return (
    <div className="space-y-4">
      {flash && <p className={cn('rounded-lg border px-3 py-2 text-[13px] inline-flex items-start gap-2', flash.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-rose-200 bg-rose-50 text-rose-800')}>{flash.ok ? <Check className="h-4 w-4 mt-0.5" /> : <AlertTriangle className="h-4 w-4 mt-0.5" />}{flash.text}</p>}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-xl border border-gray-200 bg-white p-4 flex flex-col gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">1 · Statement for the Trust</p>
          <p className="text-[13px] text-gray-700">One Excel, one sheet per party, with the Trust’s columns blank. Every row carries a CT Hub ID so the reply reads back exactly.</p>
          <select value={range} onChange={e => setRange(e.target.value)} className="h-9 rounded-lg border border-gray-300 px-2 text-[13px]">
            <option value="unconfirmed">Everything not yet confirmed</option>
            <option value="all">Every payment</option>
            {fys.map(f => <option key={f} value={`fy:${f}`}>FY {f}</option>)}
          </select>
          <a href={`/api/accounts/${projectId}/statement?range=${encodeURIComponent(range)}`} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-[13px] font-semibold text-white hover:bg-indigo-700 min-h-[40px]"><Download className="h-4 w-4" /> Download statement</a>
          {lastStatement && <p className="text-[11px] text-gray-500">Last prepared {formatDate(lastStatement.created_at)} · {lastStatement.range_label} · {lastStatement.row_count} rows</p>}
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 flex flex-col gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">2 · Trust fills it in</p>
          <p className="text-[13px] text-gray-700">Bank date, bank reference, amount in their books, and a status: <b>Matches</b>, <b>Not found</b> or <b>Differs</b>. Payments they made that CT Hub did not list go on the last sheet.</p>
          <p className="text-[11px] text-gray-500 mt-auto">Rows may be sorted or filtered; only column A must stay.</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 flex flex-col gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">3 · Upload the reply</p>
          <p className="text-[13px] text-gray-700">Confirmed rows get their bank date; the rest are listed below.</p>
          <label className={cn('inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-[13px] font-semibold min-h-[40px] cursor-pointer hover:bg-gray-50', busy === 'upload' && 'opacity-60')}>
            {busy === 'upload' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Choose the returned file
            <input type="file" accept=".xlsx,.xls,.csv" className="sr-only" disabled={busy === 'upload'} onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f); e.currentTarget.value = '' }} />
          </label>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <Kpi label="Paid (IN4)" value={formatINR(totals.paid)} sub={`${totals.count} payments`} />
        <Kpi label="Confirmed by Trust" value={formatINR(totals.confirmedPaid)} sub={`${totals.confirmedCount} payments · ${pct}%`} tone="ok" />
        <Kpi label="Awaiting Trust" value={formatINR(totals.awaitingPaid)} sub={`${totals.awaitingCount} payments`} tone={totals.awaitingCount ? 'warn' : undefined} />
        <Kpi label="Needs a look" value={String(open.filter(o => o.status !== 'explained').length)} sub="not found or differs" tone={open.some(o => o.status !== 'explained') ? 'warn' : undefined} />
      </div>

      <section className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <div className="px-4 py-2.5 border-b border-gray-100"><h3 className="text-[13px] font-semibold text-gray-900">What the Trust could not match <span className="ml-1 text-[11px] font-normal text-gray-400">{open.length}</span></h3></div>
        {open.length === 0 && <p className="px-4 py-6 text-[13px] text-gray-400 text-center">Nothing open. Every reply so far matched.</p>}
        <ul className="divide-y divide-gray-100">
          {open.map(o => (
            <li key={o.id} className={cn('px-4 py-3 flex flex-wrap items-start gap-3', o.status === 'explained' && 'opacity-70')}>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] text-gray-900"><b>{o.party}</b>{o.against && <span className="text-gray-500"> · {o.against}</span>}{o.billNo && <span className="text-gray-500"> · {o.billNo}</span>}</p>
                <p className="text-[12px] text-gray-600 tabular-nums">{o.date ? formatDate(o.date) : 'no date'} · IN4 paid {formatINR(o.paid)}{o.amountInBooks != null && <> · Trust books {formatINR(o.amountInBooks)} <span className={o.amountInBooks !== o.paid ? 'text-rose-700 font-semibold' : ''}>({o.amountInBooks - o.paid >= 0 ? '+' : '−'}{formatINR(Math.abs(o.amountInBooks - o.paid))})</span></>}{o.bankRef && ` · ref ${o.bankRef}`}</p>
                {o.remark && <p className="text-[12px] text-gray-500 italic">“{o.remark}”</p>}
              </div>
              <span className={cn('text-[10.5px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5 self-center', o.status === 'not_found' ? 'bg-amber-100 text-amber-800' : o.status === 'differs' ? 'bg-rose-100 text-rose-800' : 'bg-gray-100 text-gray-600')}>{o.status === 'not_found' ? 'not found' : o.status === 'differs' ? 'differs' : 'explained'}</span>
              {o.status !== 'explained' ? (
                <span className="flex items-center gap-1.5">
                  <input value={notes[o.id] ?? ''} onChange={e => setNotes(n => ({ ...n, [o.id]: e.target.value }))} placeholder="Why it is fine (optional)" className="h-8 w-44 rounded-md border border-gray-200 px-2 text-[12px]" />
                  <button type="button" disabled={busy === o.id} onClick={() => act(o.id, () => markExplained(projectId, o.id, notes[o.id] ?? ''))} className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-[12px] font-semibold min-h-[32px] hover:bg-gray-50 disabled:opacity-60">{busy === o.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Mark explained</button>
                </span>
              ) : (
                <button type="button" disabled={busy === o.id} onClick={() => act(o.id, () => reopen(projectId, o.id))} className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-[12px] text-gray-500 hover:text-gray-800 min-h-[32px]"><RotateCcw className="h-3 w-3" /> Reopen</button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: 'ok' | 'warn' }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
      <p className="text-[11px] text-gray-500">{label}</p>
      <p className={cn('text-[15px] font-semibold tabular-nums', tone === 'ok' ? 'text-emerald-700' : tone === 'warn' ? 'text-amber-700' : 'text-gray-900')}>{value}</p>
      <p className="text-[11px] text-gray-400">{sub}</p>
    </div>
  )
}
