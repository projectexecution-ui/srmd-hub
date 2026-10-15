'use client'

import { useState, useTransition, type CSSProperties, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toPng } from 'html-to-image'
import { toast } from 'sonner'
import { Copy, FileDown, Loader2 } from 'lucide-react'
import { formatDate, formatINR } from '@/lib/utils'
import { REMARK_OPTIONS, TRUSTS, UNSET, type DailyReport, type ReportRow, type TrustGroup } from '@/lib/bills-booking/daily-report'
import { CardList, Card, CardTotal } from '../Cards'
import { saveReportMark } from './actions'

// The colours management already knows from the Zoho report, kept so the
// picture in WhatsApp looks the same whichever system made it.
const ACCT_HEX: Record<string, string> = { SRET: '#4f46e5', SRAH: '#0891b2', SRASSK: '#7c3aed', SRA: '#0284c7', [UNSET]: '#64748b' }
const ACCT_HEAD: Record<string, string> = { SRET: '#e0e7ff', SRAH: '#cffafe', SRASSK: '#ede9fe', SRA: '#e0f2fe', [UNSET]: '#e2e8f0' }
const ACCT_BODY: Record<string, string> = { SRET: '#f4f6ff', SRAH: '#ecfdff', SRASSK: '#f6f4ff', SRA: '#f0f9ff', [UNSET]: '#f6f8fb' }
const GRID = '1px solid #c7d0dc'
const LATE = 7

const trustTitle = (t: string) => (t === UNSET ? 'Trust not set' : `${t} A/c`)
const plural = (n: number) => `${n} bill${n === 1 ? '' : 's'}`

export function DailyBillsReport({ report, today, canEdit }: { report: DailyReport; today: string; canEdit: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const label = formatDate(report.date)

  async function copyImage(nodeId: string, name: string) {
    const node = document.getElementById(nodeId)
    if (!node) return
    setBusy(nodeId)
    try {
      const dataUrl = await toPng(node, { backgroundColor: '#ffffff', pixelRatio: 2, cacheBust: true })
      const blob = await (await fetch(dataUrl)).blob()
      const CI = (window as unknown as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem
      if (navigator.clipboard && CI) {
        await navigator.clipboard.write([new CI({ 'image/png': blob })])
        toast.success(`${name} copied — paste it into WhatsApp`)
      } else {
        const a = document.createElement('a'); a.href = dataUrl; a.download = `${name} ${label}.png`; a.click()
        toast.message(`${name} saved as an image — attach it in WhatsApp`)
      }
    } catch {
      try {
        const dataUrl = await toPng(node, { backgroundColor: '#ffffff', pixelRatio: 2 })
        const a = document.createElement('a'); a.href = dataUrl; a.download = `${name} ${label}.png`; a.click()
        toast.message(`${name} saved as an image — attach it in WhatsApp`)
      } catch { toast.error('The image could not be made. Try again, or use the PDF.') }
    } finally { setBusy(null) }
  }

  async function downloadPdf() {
    const node = document.getElementById('dbr-full')
    if (!node) return
    setBusy('pdf')
    try {
      const dataUrl = await toPng(node, { backgroundColor: '#ffffff', pixelRatio: 2, cacheBust: true })
      const dims = await new Promise<{ w: number; h: number }>((res, rej) => {
        const im = new window.Image()
        im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight })
        im.onerror = rej
        im.src = dataUrl
      })
      const { default: JsPDF } = await import('jspdf')
      const w = 595.28                       // A4 width in points
      const h = (w * dims.h) / dims.w        // one tall page, so no table breaks across pages
      const doc = new JsPDF({ unit: 'pt', format: [w, h] })
      doc.addImage(dataUrl, 'PNG', 0, 0, w, h)
      doc.save(`Daily Bills Report ${label}.pdf`)
      toast.success('PDF saved')
    } catch {
      toast.error('The PDF could not be made. Try again.')
    } finally { setBusy(null) }
  }

  const nothing = report.paid.length === 0 && report.groups.length === 0

  return (
    <>
      {/* Day, totals, and the one button for the whole report. */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-gray-500">
          Report for
          <input type="date" value={report.date} max={today}
                 onChange={e => e.target.value && router.push(`/bills-booking/daily-report?date=${e.target.value}`)}
                 className="mt-1 block h-11 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 md:h-9" />
        </label>
        {report.date !== today && (
          <Link href="/bills-booking/daily-report"
                className="inline-flex h-11 items-center rounded-lg border border-gray-300 px-3 text-sm text-gray-700 hover:bg-gray-50 md:h-9">
            Today
          </Link>
        )}
        <button type="button" onClick={downloadPdf} disabled={busy === 'pdf'}
                className="ml-auto inline-flex h-11 items-center gap-1.5 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 md:h-9">
          {busy === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
          PDF of the whole report
        </button>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm space-y-1">
        <div className="flex justify-between gap-3"><span className="text-gray-600">Paid on {label}</span>
          <span className="tabular-nums font-semibold">{plural(report.paid.length)} · {formatINR(report.paidTotal)}</span></div>
        <div className="flex justify-between gap-3"><span className="text-gray-600">At the trusts that evening</span>
          <span className="tabular-nums font-semibold">{plural(report.atTrustCount)} · {formatINR(report.atTrustTotal)}</span></div>
      </div>

      {nothing && (
        <p className="rounded-xl border border-gray-200 bg-white px-4 py-6 text-center text-sm text-gray-500">
          No bill in Bills Approval was paid on {label} or was waiting at a trust that evening. A bill arrives here once
          IN4 shows the Atm Head&apos;s approval, and leaves when IN4 shows it paid.
        </p>
      )}

      <Section id="sec-paid" title={`Paid on ${label}`} n={report.paid.length} total={report.paidTotal} hex="#475569"
               onCopy={() => copyImage('dbr-paid', 'Paid')} copying={busy === 'dbr-paid'}>
        {report.paid.length === 0
          ? <Empty>Nothing paid on this day.</Empty>
          : <Rows rows={report.paid} kind="paid" canEdit={canEdit} today={today} />}
      </Section>

      {report.groups.map(g => (
        <Section key={g.trust} id={`sec-${g.trust}`} title={`Waiting at ${trustTitle(g.trust)}`} n={g.rows.length} total={g.total}
                 hex={ACCT_HEX[g.trust] ?? ACCT_HEX[UNSET]}
                 onCopy={() => copyImage(`dbr-${g.trust}`, trustTitle(g.trust))} copying={busy === `dbr-${g.trust}`}>
          {g.trust === UNSET && (
            <p className="text-xs text-amber-700">The order number does not name a trust. {canEdit ? 'Pick one on each bill.' : 'CT Billing picks one.'}</p>
          )}
          <Rows rows={g.rows} kind="trust" dateLabel={g.dateLabel} canEdit={canEdit} today={today} />
        </Section>
      ))}

      <p className="text-xs text-gray-500">
        Built from each bill&apos;s own steps in Bills Approval, so an earlier date shows what was really at each trust
        that evening. The {report.groups.some(g => g.dateLabel === 'Courier') ? 'courier / ' : ''}submission date starts
        as the day the bill reached the trust; CT Billing can change it, and add a remark. Days in red: {LATE} or more.
        The older Zoho report stays on <Link href="/bills-pipeline/daily-report" className="text-blue-600 hover:underline">Bills Pipeline</Link> for now.
      </p>

      {/* What the images and the PDF are made from. Off screen, plain inline
          styles, so the picture is the same on every phone. */}
      <div aria-hidden style={{ position: 'fixed', left: -10000, top: 0 }}>
        <Sheet id="dbr-paid" label={label}><CleanTable title={`Paid on ${label}`} trust="" rows={report.paid} kind="paid" /></Sheet>
        {report.groups.map(g => (
          <Sheet key={g.trust} id={`dbr-${g.trust}`} label={label}><CleanTable title={`Waiting at ${trustTitle(g.trust)}`} trust={g.trust} rows={g.rows} kind="trust" dateLabel={g.dateLabel} /></Sheet>
        ))}
        <FullDoc report={report} label={label} />
      </div>
    </>
  )
}

function Section({ id, title, n, total, hex, onCopy, copying, children }: {
  id: string; title: string; n: number; total: number; hex: string
  onCopy: () => void; copying: boolean; children: ReactNode
}) {
  return (
    <section id={id} className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          <span className="inline-block h-3 w-3 rounded-sm" style={{ background: hex }} />
          {title}
          <span className="font-normal text-gray-500 tabular-nums">· {plural(n)} · {formatINR(total)}</span>
        </h2>
        <button type="button" onClick={onCopy} disabled={copying}
                className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60 md:h-8">
          {copying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />}
          Copy image
        </button>
      </div>
      {children}
    </section>
  )
}

const Empty = ({ children }: { children: ReactNode }) => (
  <p className="rounded-xl border border-gray-200 bg-white px-4 py-4 text-center text-sm text-gray-500">{children}</p>
)

function Rows({ rows, kind, dateLabel, canEdit, today }: {
  rows: ReportRow[]; kind: 'paid' | 'trust'; dateLabel?: string; canEdit: boolean; today: string
}) {
  const total = rows.reduce((s, r) => s + r.amount, 0)
  const editing = canEdit && kind === 'trust'
  return (
    <>
      <CardList>
        {rows.map(r => (
          <Card key={r.id}
                title={<Link href={`/bills-booking/${r.id}`} className="hover:underline">{r.vendor}</Link>}
                sub={<>{r.serial ? <span className="font-mono">{r.serial} · </span> : null}{r.project}{r.billNo ? ` · ${r.billNo}` : ''}</>}
                amount={formatINR(r.amount)}
                flagged={kind === 'trust' && (r.days ?? 0) >= LATE}
                facts={kind === 'trust' ? [
                  { k: dateLabel ?? 'Submission', v: r.date ? `${formatDate(r.date)}${r.dateIsDefault ? ' (reached trust)' : ''}` : '—' },
                  { k: 'Days', v: r.days == null ? '—' : String(r.days), tone: (r.days ?? 0) >= LATE ? 'bad' as const : undefined },
                  ...(!editing ? [{ k: 'Remark', v: r.remark || '—' }] : []),
                ] : [{ k: 'Remark', v: r.remark || '—' }]}
                note={r.note}
                action={editing ? <MarkEditor row={r} dateLabel={dateLabel ?? 'Submission'} today={today} /> : undefined} />
        ))}
        <CardTotal n={rows.length} label={rows.length === 1 ? 'bill' : 'bills'} amount={formatINR(total)} />
      </CardList>

      <div className="hidden overflow-x-auto rounded-xl border border-gray-200 bg-white md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
              <th className="px-3 py-2 text-left font-semibold">Hub no</th>
              <th className="px-3 py-2 text-left font-semibold">Party</th>
              <th className="px-3 py-2 text-left font-semibold">Project</th>
              <th className="px-3 py-2 text-left font-semibold">Bill no</th>
              <th className="px-3 py-2 text-right font-semibold">Amount</th>
              {kind === 'trust' && <th className="px-3 py-2 text-left font-semibold">{dateLabel}</th>}
              {kind === 'trust' && <th className="px-3 py-2 text-right font-semibold">Days</th>}
              <th className="px-3 py-2 text-left font-semibold">{editing ? 'Date · remark · trust' : 'Remark'}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map(r => (
              <tr key={r.id} className="align-top">
                <td className="px-3 py-2 font-mono text-xs text-gray-600">{r.serial ?? '—'}</td>
                <td className="px-3 py-2">
                  <Link href={`/bills-booking/${r.id}`} className="font-medium text-gray-900 hover:underline">{r.vendor}</Link>
                  {r.note && <div className="text-[11px] text-amber-700">{r.note}</div>}
                </td>
                <td className="px-3 py-2 text-gray-600">{r.project}</td>
                <td className="px-3 py-2 text-gray-600">{r.billNo ?? '—'}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatINR(r.amount)}</td>
                {kind === 'trust' && (
                  <td className="px-3 py-2 whitespace-nowrap text-gray-700">
                    {r.date ? formatDate(r.date) : '—'}
                    {r.dateIsDefault && r.date && <div className="text-[11px] text-gray-400">reached trust</div>}
                  </td>
                )}
                {kind === 'trust' && (
                  <td className={`px-3 py-2 text-right tabular-nums ${(r.days ?? 0) >= LATE ? 'font-semibold text-red-600' : 'text-gray-600'}`}>
                    {r.days ?? '—'}
                  </td>
                )}
                <td className="px-3 py-2 text-gray-600">
                  {editing ? <MarkEditor row={r} dateLabel={dateLabel ?? 'Submission'} today={today} /> : (r.remark || '—')}
                </td>
              </tr>
            ))}
            <tr className="bg-gray-50 font-semibold">
              <td className="px-3 py-2" colSpan={4}>Total · {plural(rows.length)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatINR(total)}</td>
              <td colSpan={kind === 'trust' ? 3 : 1} />
            </tr>
          </tbody>
        </table>
      </div>
    </>
  )
}

/** What CT Billing types for one bill. Each change saves at once; if the
 *  database refuses, the field goes back and the reason shows under it. */
function MarkEditor({ row, dateLabel, today }: { row: ReportRow; dateLabel: string; today: string }) {
  const router = useRouter()
  const saved = {
    sentDate: row.dateIsDefault ? '' : (row.date ?? ''),
    remark: row.remark ?? '',
    trust: row.trustFromOrder || row.trust === UNSET ? '' : row.trust,
  }
  const [v, setV] = useState(saved)
  const [err, setErr] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const listId = `remarks-${row.id}`

  function save(next: typeof saved) {
    if (next.sentDate === saved.sentDate && next.remark.trim() === saved.remark && next.trust === saved.trust) return
    setV(next); setErr(null)
    start(async () => {
      const res = await saveReportMark(row.id, { sentDate: next.sentDate || null, remark: next.remark.trim() || null, trust: next.trust || null })
      if (!res.ok) { setV(saved); setErr(res.error ?? 'Not saved.'); return }
      toast.success('Saved')
      router.refresh()
    })
  }

  const field = 'h-11 rounded-lg border border-gray-300 bg-white px-2 text-sm text-gray-900 md:h-8 md:text-xs'
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        <label className="sr-only" htmlFor={`d-${row.id}`}>{dateLabel} date</label>
        <input id={`d-${row.id}`} type="date" value={v.sentDate} max={today} disabled={pending}
               title={`${dateLabel} date — leave empty to use the day it reached the trust`}
               onChange={e => save({ ...v, sentDate: e.target.value })} className={`${field} w-[9.5rem]`} />
        <label className="sr-only" htmlFor={`r-${row.id}`}>Remark</label>
        <input id={`r-${row.id}`} list={listId} value={v.remark} maxLength={200} placeholder="Remark" disabled={pending}
               onChange={e => setV({ ...v, remark: e.target.value })}
               onBlur={e => save({ ...v, remark: e.target.value })}
               onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
               className={`${field} min-w-0 flex-1 basis-40`} />
        <datalist id={listId}>{REMARK_OPTIONS.map(o => <option key={o} value={o} />)}</datalist>
        {!row.trustFromOrder && (
          <>
            <label className="sr-only" htmlFor={`t-${row.id}`}>Trust</label>
            <select id={`t-${row.id}`} value={v.trust} disabled={pending}
                    onChange={e => save({ ...v, trust: e.target.value })} className={`${field} w-28`}>
              <option value="">Trust…</option>
              {TRUSTS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </>
        )}
        {pending && <Loader2 className="h-4 w-4 animate-spin self-center text-gray-400" />}
      </div>
      {err && <p className="text-xs text-red-600">Not saved — {err}</p>}
    </div>
  )
}

// ── The picture management gets ────────────────────────────────────────────

function Sheet({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div id={id} style={{ width: 820, background: '#fff', padding: '18px 22px', fontFamily: 'Arial, sans-serif', color: '#0f172a' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderBottom: '2px solid #0f172a', paddingBottom: 8 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800 }}>Daily Bills Report</div>
          <div style={{ fontSize: 10, color: '#64748b' }}>SRMD Construction · Trust Accounts</div>
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#334155' }}>{label}</div>
      </div>
      {children}
      <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 12 }}>From Bills Approval · CT Hub</div>
    </div>
  )
}

function CleanTable({ title, trust, rows, kind, dateLabel }: {
  title: string; trust: string; rows: ReportRow[]; kind: 'paid' | 'trust'; dateLabel?: TrustGroup['dateLabel']
}) {
  const hex = kind === 'paid' ? '#475569' : (ACCT_HEX[trust] ?? ACCT_HEX[UNSET])
  const headBg = kind === 'paid' ? '#e8edf3' : (ACCT_HEAD[trust] ?? ACCT_HEAD[UNSET])
  const bodyBg = kind === 'paid' ? '#f7f9fc' : (ACCT_BODY[trust] ?? ACCT_BODY[UNSET])
  const total = rows.reduce((s, r) => s + r.amount, 0)
  const th: CSSProperties = { padding: '6px 8px', textAlign: 'left', border: GRID, background: headBg, fontWeight: 700, color: '#1e293b' }
  const thR: CSSProperties = { ...th, textAlign: 'right' }
  const td: CSSProperties = { padding: '5px 8px', border: GRID }
  const tdR: CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, whiteSpace: 'nowrap' }
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: hex, display: 'inline-block' }} />
          <span style={{ fontSize: 14, fontWeight: 800 }}>{title}</span>
        </div>
        <span style={{ fontSize: 11.5, color: '#64748b', fontWeight: 600 }}>{plural(rows.length)} · {formatINR(total)}</span>
      </div>
      {rows.length === 0 ? (
        <div style={{ padding: '10px 8px', fontSize: 12, color: '#94a3b8', fontStyle: 'italic', background: bodyBg, border: GRID, borderRadius: 4 }}>
          {kind === 'paid' ? 'Nothing paid on this day' : 'No bills'}
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr>
            <th style={{ ...th, width: 26 }}>#</th>
            <th style={th}>Hub no</th>
            <th style={th}>Party</th>
            <th style={th}>Project</th>
            <th style={th}>Bill no</th>
            <th style={thR}>Amount (₹)</th>
            {kind === 'trust' && <th style={th}>{dateLabel}</th>}
            {kind === 'trust' && <th style={{ ...thR, width: 46 }}>Days</th>}
            <th style={th}>Remark</th>
          </tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} style={{ background: bodyBg }}>
                <td style={{ ...td, color: '#94a3b8' }}>{i + 1}</td>
                <td style={{ ...td, color: '#475569', fontFamily: 'ui-monospace, Menlo, monospace', whiteSpace: 'nowrap' }}>{r.serial ?? ''}</td>
                <td style={td}>{r.vendor}</td>
                <td style={{ ...td, color: '#475569' }}>{r.project}</td>
                <td style={{ ...td, color: '#475569' }}>{r.billNo ?? ''}</td>
                <td style={tdR}>{formatINR(r.amount)}</td>
                {kind === 'trust' && <td style={{ ...td, whiteSpace: 'nowrap' }}>{r.date ? formatDate(r.date) : ''}</td>}
                {kind === 'trust' && (
                  <td style={{ ...tdR, fontWeight: 400, color: (r.days ?? 0) >= LATE ? '#b91c1c' : '#475569' }}>{r.days == null ? '' : `${r.days}d`}</td>
                )}
                <td style={{ ...td, color: '#475569' }}>{r.remark ?? ''}</td>
              </tr>
            ))}
            <tr style={{ background: headBg, fontWeight: 800 }}>
              <td style={td} colSpan={5}>Total · {plural(rows.length)}</td>
              <td style={tdR}>{formatINR(total)}</td>
              <td style={td} colSpan={kind === 'trust' ? 3 : 1} />
            </tr>
          </tbody>
        </table>
      )}
    </div>
  )
}

function Pill({ label, n, amt, hex }: { label: string; n: number; amt: number; hex: string }) {
  return (
    <div style={{ flex: '1 1 150px', border: '1px solid #e2e8f0', borderLeft: `3px solid ${hex}`, borderRadius: 8, padding: '8px 12px', background: '#fff' }}>
      <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 800, marginTop: 2 }}>{formatINR(amt)}</div>
      <div style={{ fontSize: 10, color: '#94a3b8' }}>{plural(n)}</div>
    </div>
  )
}

function FullDoc({ report, label }: { report: DailyReport; label: string }) {
  return (
    <div id="dbr-full" style={{ width: 820, background: '#fff', fontFamily: 'Arial, sans-serif', color: '#0f172a' }}>
      <div style={{ background: '#0f172a', color: '#fff', padding: '18px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: 0.3 }}>Daily Bills Report</div>
          <div style={{ fontSize: 11.5, color: '#cbd5e1', marginTop: 3 }}>SRMD Construction · Trust Accounts</div>
        </div>
        <div style={{ fontSize: 17, fontWeight: 700 }}>{label}</div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, padding: '12px 24px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
        <Pill label="Paid" n={report.paid.length} amt={report.paidTotal} hex="#475569" />
        {report.groups.map(g => <Pill key={g.trust} label={trustTitle(g.trust)} n={g.rows.length} amt={g.total} hex={ACCT_HEX[g.trust] ?? ACCT_HEX[UNSET]} />)}
      </div>
      <div style={{ padding: '2px 24px 8px' }}>
        <CleanTable title={`Paid on ${label}`} trust="" rows={report.paid} kind="paid" />
        {report.groups.map(g => (
          <CleanTable key={g.trust} title={`Waiting at ${trustTitle(g.trust)}`} trust={g.trust} rows={g.rows} kind="trust" dateLabel={g.dateLabel} />
        ))}
      </div>
      <div style={{ padding: '12px 24px', borderTop: '1px solid #e2e8f0', fontSize: 10, color: '#94a3b8' }}>From Bills Approval · CT Hub · {label}</div>
    </div>
  )
}
