'use client'
import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { QueryError } from '@/components/ui/query-error'
import { confirm } from '@/components/ui/confirm-dialog'
import { formatINR, formatDateTime } from '@/lib/utils'
import { Loader2, RefreshCw, Link2, Link2Off, CheckCircle2, AlertTriangle, Power, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react'
import type { ComparisonSummary } from '@/lib/in4/compare'
import type { Feed, FeedMode } from '@/lib/in4/feeds'
import type { TrackerComparison } from '@/lib/in4/tracker'
import type { ReportComparison } from '@/lib/in4/contractor'
import type { SupplierComparison } from '@/lib/in4/supplier'
import { setFeedLive, linkSubproject } from './actions'

export interface LinkRow { subprojectId: number; name: string; exCode: string | null; bphProjectId: string | null; source: string | null }
export interface BphOption { id: string; name: string; fileName: string | null }
export interface FeedRow {
  feed: Feed; label: string; replaces: string; page: string; source: string
  mode: FeedMode
  last: { at: string; ok: boolean; error: string | null; summary: string | null } | null
  lastRun: { id: number; startedAt: string; trigger: string; mode: string; ok: boolean; error: string | null; rows: number | null } | null
  comparison: unknown
}

interface Props {
  configured: boolean
  missingVars: string[]
  feeds: FeedRow[]
  budgetComparison: ComparisonSummary | null
  rows: LinkRow[]
  bphOptions: BphOption[]
  unlinkedBph: BphOption[]
}

export function In4SyncClient({ configured, missingVars, feeds, budgetComparison, rows, bphOptions, unlinkedBph }: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [openFeed, setOpenFeed] = useState<Feed | null>(null)
  const [openProject, setOpenProject] = useState<string | null>(null)

  async function runNow(feed: Feed) {
    setBusy(`run:${feed}`); setErr(null)
    try {
      const res = await fetch('/api/cron/in4-sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ feed }) })
      const j = await res.json().catch(() => null)
      if (!res.ok) setErr(j?.reason ?? j?.error ?? `Sync failed (${res.status})`)
      router.refresh()
    } catch (e) { setErr(e instanceof Error ? e.message : 'Sync failed') }
    finally { setBusy(null) }
  }

  async function runAll() {
    setBusy('run:all'); setErr(null)
    try {
      for (const f of feeds) {
        const res = await fetch('/api/cron/in4-sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ feed: f.feed }) })
        if (!res.ok) { const j = await res.json().catch(() => null); setErr(`${f.label}: ${j?.reason ?? j?.error ?? `failed (${res.status})`}`); break }
      }
      router.refresh()
    } catch (e) { setErr(e instanceof Error ? e.message : 'Sync failed') }
    finally { setBusy(null) }
  }

  async function toggleLive(f: FeedRow) {
    const live = f.mode === 'live'
    if (!live) {
      const ok = await confirm({
        title: `Make IN4 the source of the ${f.label}?`,
        message: `From the next sync, ${f.replaces} is no longer needed — the page reads IN4 directly, twice a day. The upload keeps working as a fallback. You can switch back here any time.`,
        confirmLabel: 'Go live',
      })
      if (!ok) return
    }
    setBusy(`switch:${f.feed}`); setErr(null)
    const r = await setFeedLive(f.feed, !live)
    setBusy(null)
    if (!r.ok) setErr(r.error ?? 'Could not change the switch'); else router.refresh()
  }

  const liveCount = feeds.filter(f => f.mode === 'live').length
  const switchable = feeds.filter(f => f.mode !== 'mirror').length

  return (
    <div className="space-y-4">
      {err && <QueryError message={err} what="the IN4 sync" />}

      {!configured && (
        <Card className="p-4 border-amber-300 bg-amber-50 text-sm text-amber-900">
          <p className="font-semibold">IN4 is not connected on this deployment.</p>
          <p className="mt-1">This deployment cannot see {missingVars.map((v, i) => <span key={v}>{i > 0 ? ' and ' : ''}<code>{v}</code></span>)}. In Vercel → ct-hub → Settings → Environment Variables, the name must be spelt exactly like that, ticked for <b>Production</b>, and the site redeployed after saving (Deployments → ⋯ → Redeploy). Host, port and database need no variable — they default to the RDS endpoint and <code>In4re</code>.</p>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Connection" value={configured ? 'Connected' : 'Not set up'} hint={configured ? 'read-only login to In4re' : `${missingVars.join(', ')} missing`} tone={configured ? 'green' : 'red'} />
        <Stat label="Feeds live" value={`${liveCount} of ${switchable}`} hint={liveCount === switchable ? 'no Excel upload left' : `${switchable - liveCount} still on upload`} tone={liveCount === switchable ? 'green' : 'amber'} />
        <Stat label="Runs" value="Twice a day" hint="09:00 and 15:00 IST, one job per feed" />
        <div className="rounded-xl border border-gray-200 bg-white p-3 flex items-center">
          <Button onClick={runAll} disabled={!configured || busy !== null} size="sm" className="w-full">
            {busy === 'run:all' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Run every feed now
          </Button>
        </div>
      </div>

      {/* Feeds */}
      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/60">
          <h3 className="text-sm font-semibold text-gray-900">The five feeds</h3>
          <p className="text-[11px] text-gray-500 mt-0.5">Shadow = the sync runs and compares, the upload stays the source. Live = the sync is the upload. Open a row for the comparison with your last upload.</p>
        </div>
        <div className="divide-y divide-gray-100">
          {feeds.map(f => {
            const open = openFeed === f.feed
            const tone = f.mode === 'live' ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : f.mode === 'mirror' ? 'text-gray-600 bg-gray-50 border-gray-200' : 'text-amber-800 bg-amber-50 border-amber-200'
            return (
              <div key={f.feed}>
                <div className="px-4 py-3 flex flex-col md:flex-row md:items-center gap-2 md:gap-4">
                  <button type="button" onClick={() => setOpenFeed(open ? null : f.feed)} className="flex items-start gap-2 text-left flex-1 min-w-0 min-h-[44px] md:min-h-0">
                    {open ? <ChevronDown className="h-4 w-4 mt-0.5 text-gray-400 flex-shrink-0" /> : <ChevronRight className="h-4 w-4 mt-0.5 text-gray-400 flex-shrink-0" />}
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-gray-900">{f.label}</span>
                      <span className="block text-[11px] text-gray-500">Replaces {f.replaces}</span>
                      <span className="block text-[11px] text-gray-500 mt-0.5">
                        {f.last
                          ? f.last.ok
                            ? <>Last sync {formatDateTime(f.last.at)}{f.last.summary ? ` · ${f.last.summary}` : ''}</>
                            : <span className="text-rose-700">Failed {formatDateTime(f.last.at)} — {f.last.error}</span>
                          : 'Has not run yet'}
                      </span>
                    </span>
                  </button>
                  <div className="flex items-center gap-2 flex-wrap md:flex-nowrap md:justify-end">
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${tone}`}>{f.mode === 'live' ? 'Live' : f.mode === 'mirror' ? 'Mirror' : 'Shadow'}</span>
                    <Button onClick={() => runNow(f.feed)} disabled={!configured || busy !== null} size="sm" variant="outline">
                      {busy === `run:${f.feed}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Run now
                    </Button>
                    {f.mode !== 'mirror' && (
                      <Button onClick={() => toggleLive(f)} disabled={!configured || busy !== null} size="sm" variant={f.mode === 'live' ? 'outline' : 'default'}>
                        {busy === `switch:${f.feed}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />} {f.mode === 'live' ? 'Back to shadow' : 'Go live'}
                      </Button>
                    )}
                    <Link href={f.page} className="inline-flex items-center gap-1 text-[11px] text-blue-700 hover:underline whitespace-nowrap min-h-[44px] md:min-h-0"><ExternalLink className="h-3 w-3" /> open page</Link>
                  </div>
                </div>
                {open && (
                  <div className="px-4 pb-4 space-y-3 bg-gray-50/40 border-t border-gray-100">
                    <p className="text-[11px] text-gray-500 pt-3">Source: <span className="font-mono">{f.source}</span>{f.lastRun ? ` · last run #${f.lastRun.id} · ${f.lastRun.trigger} · ${f.lastRun.rows ?? 0} rows read` : ''}</p>
                    {f.feed === 'budget' && <BudgetComparison comparison={budgetComparison} openProject={openProject} setOpenProject={setOpenProject} />}
                    {f.feed === 'tracker' && <TrackerCmp c={f.comparison as TrackerComparison | null} />}
                    {f.feed === 'contractor' && <ReportCmp c={f.comparison as ReportComparison | null} />}
                    {f.feed === 'supplier' && <SupplierCmp c={f.comparison as SupplierComparison | null} />}
                    {f.feed === 'masters' && <p className="text-xs text-gray-600">The mirror feeds the <Link href="/admin/masters" className="text-blue-700 hover:underline">Masters</Link> screens — contractors, suppliers, materials, stores, trusts and units, each matched against the hub&apos;s own lists there.</p>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </Card>

      {/* Links (budget feed) */}
      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/60">
          <h3 className="text-sm font-semibold text-gray-900">Which IN4 sub-project is which Budget-Hub project</h3>
          <p className="text-[11px] text-gray-500 mt-0.5">Needed by the budget feed only. Seeded from the file names of your uploads on the first sync.{' '}
            {rows.length === 0
              ? 'IN4’s sub-projects appear here after the first run of the Budget or Masters feed.'
              : unlinkedBph.length > 0 ? `${unlinkedBph.length} Budget-Hub project${unlinkedBph.length === 1 ? '' : 's'} still need a sub-project: ${unlinkedBph.map(p => p.name).join(', ')}.` : 'Every Budget-Hub project is linked.'}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead className="bg-gray-50 text-left text-[10px] uppercase tracking-wide text-gray-500">
              <tr><th className="px-4 py-2">IN4 sub-project</th><th className="px-3 py-2">Code</th><th className="px-3 py-2">Budget-Hub project</th><th className="px-3 py-2">How</th></tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-sm text-gray-400">Nothing mirrored from IN4 yet.</td></tr>}
              {rows.map(r => (
                <tr key={r.subprojectId} className="border-t border-gray-100">
                  <td className="px-4 py-1.5 text-gray-900">{r.name}</td>
                  <td className="px-3 py-1.5 font-mono text-[11px] text-gray-500">{r.exCode ?? '—'}</td>
                  <td className="px-3 py-1.5">
                    <select
                      className="h-8 rounded-md border border-gray-300 bg-white px-2 text-[12.5px] max-w-[320px]"
                      value={r.bphProjectId ?? ''}
                      disabled={pending}
                      onChange={e => {
                        const v = e.target.value || null
                        startTransition(async () => {
                          const res = await linkSubproject(r.subprojectId, v)
                          if (!res.ok) setErr(res.error ?? 'Could not save the link'); else router.refresh()
                        })
                      }}
                    >
                      <option value="">— not linked —</option>
                      {bphOptions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-1.5 text-gray-500">
                    {r.bphProjectId
                      ? <span className="inline-flex items-center gap-1"><Link2 className="h-3.5 w-3.5" />{r.source === 'manual' ? 'confirmed by you' : 'from the file name'}</span>
                      : <span className="inline-flex items-center gap-1 text-gray-400"><Link2Off className="h-3.5 w-3.5" />no upload for it</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

function BudgetComparison({ comparison, openProject, setOpenProject }: { comparison: ComparisonSummary | null; openProject: string | null; setOpenProject: (v: string | null) => void }) {
  if (!comparison) return <p className="text-xs text-gray-500">No comparison yet — run the feed once.</p>
  return (
    <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
      <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-800">IN4 today vs your last upload</span>
        <span className="text-[11px] text-gray-500">{comparison.totals.exact} exact · {comparison.totals.near} near · {comparison.totals.off} off · exact = within ₹1 · near = within 0.5%</span>
      </div>
      <div className="divide-y divide-gray-100">
        {comparison.projects.map(p => {
          const total = p.exact + p.near + p.off
          const open = openProject === p.bphProjectId
          return (
            <div key={p.bphProjectId}>
              <button type="button" onClick={() => setOpenProject(open ? null : p.bphProjectId)} className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-gray-50 min-h-[44px]">
                {p.off === 0 ? <CheckCircle2 className="h-4 w-4 text-emerald-600 flex-shrink-0" /> : <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0" />}
                <span className="font-medium text-sm text-gray-900 flex-1 min-w-0 truncate">{p.bphName}</span>
                <span className="text-xs tabular-nums text-gray-600">{p.exact}/{total} exact{p.near ? ` · ${p.near} near` : ''}{p.off ? ` · ${p.off} off` : ''}</span>
              </button>
              {open && p.diffs.length > 0 && (
                <div className="overflow-x-auto border-t border-gray-100">
                  <table className="w-full text-[12.5px]">
                    <thead className="bg-gray-50 text-left text-[10px] uppercase tracking-wide text-gray-500">
                      <tr><th className="px-3 py-1.5">Line</th><th className="px-3 py-1.5">Figure</th><th className="px-3 py-1.5 text-right">Last upload</th><th className="px-3 py-1.5 text-right">IN4 now</th><th className="px-3 py-1.5 text-right">Difference</th></tr>
                    </thead>
                    <tbody>
                      {p.diffs.slice(0, 40).map((d, i) => (
                        <tr key={i} className="border-t border-gray-50">
                          <td className="px-3 py-1.5"><span className="font-mono text-[11px] text-gray-500 mr-1.5">{d.level === 'sub' ? d.code : `cat ${d.code}`}</span>{d.head}</td>
                          <td className="px-3 py-1.5 text-gray-600">{d.field === 'woApproved' ? 'WO/PO approved' : d.field}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{d.hub == null ? <span className="text-gray-400">not in upload</span> : formatINR(d.hub)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{d.in4 == null ? <span className="text-gray-400">not in IN4</span> : formatINR(d.in4)}</td>
                          <td className={`px-3 py-1.5 text-right tabular-nums font-medium ${d.verdict === 'near' ? 'text-amber-700' : 'text-rose-700'}`}>{formatINR((d.in4 ?? 0) - (d.hub ?? 0))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {p.diffs.length > 40 && <p className="px-3 py-2 text-[11px] text-gray-500">{p.diffs.length - 40} more differences not shown.</p>}
                </div>
              )}
              {open && p.diffs.length === 0 && <p className="px-3 py-2 text-xs text-emerald-700 bg-emerald-50/50">Every figure matches the upload.</p>}
            </div>
          )
        })}
        {comparison.projects.length === 0 && <p className="px-3 py-4 text-sm text-gray-500 text-center">No linked projects to compare yet.</p>}
      </div>
    </div>
  )
}

function Verdict({ v }: { v: string }) {
  const cls = v === 'exact' ? 'bg-emerald-50 text-emerald-700' : v === 'near' ? 'bg-amber-50 text-amber-800' : v === 'hub-only' ? 'bg-gray-100 text-gray-600' : v === 'in4-only' ? 'bg-blue-50 text-blue-700' : 'bg-rose-50 text-rose-700'
  const label = v === 'hub-only' ? 'only in upload' : v === 'in4-only' ? 'new in IN4' : v
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${cls}`}>{label}</span>
}

function TrackerCmp({ c }: { c: TrackerComparison | null }) {
  if (!c) return <p className="text-xs text-gray-500">No comparison yet — run the feed once.</p>
  const t = c.totals
  return (
    <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
      <div className="px-3 py-2 border-b border-gray-100 text-xs text-gray-700 flex flex-wrap gap-x-4 gap-y-1">
        <span><b>{t.in4Lines.toLocaleString('en-IN')}</b> lines from IN4 vs <b>{t.hubLines.toLocaleString('en-IN')}</b> in the upload{c.uploadSavedAt ? ` (${formatDateTime(c.uploadSavedAt)})` : ''}</span>
        <span>pending <b>{t.in4Pending}</b> vs {t.hubPending}</span>
        <span>pending ₹ <b>{formatINR(t.in4PendingValue)}</b> vs {formatINR(t.hubPendingValue)}</span>
        <span>GRN ₹ <b>{formatINR(t.in4GrnValue)}</b> vs {formatINR(t.hubGrnValue)}</span>
      </div>
      <div className="overflow-x-auto max-h-[50vh] overflow-y-auto">
        <table className="w-full text-[12.5px]">
          <thead className="bg-gray-50 text-left text-[10px] uppercase tracking-wide text-gray-500 sticky top-0">
            <tr><th className="px-3 py-1.5">Project</th><th className="px-3 py-1.5 text-right">Lines IN4</th><th className="px-3 py-1.5 text-right">Lines upload</th><th className="px-3 py-1.5 text-right">Pending IN4</th><th className="px-3 py-1.5 text-right">Pending upload</th><th className="px-3 py-1.5 text-right">Pending ₹ IN4</th><th className="px-3 py-1.5 text-right">Pending ₹ upload</th></tr>
          </thead>
          <tbody>
            {c.projects.map(p => (
              <tr key={p.project} className={`border-t border-gray-50 ${p.hubLines === 0 || p.in4Lines === 0 ? 'bg-blue-50/30' : ''}`}>
                <td className="px-3 py-1.5 text-gray-900">{p.project}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{p.in4Lines}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-gray-500">{p.hubLines}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{p.in4Pending}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-gray-500">{p.hubPending}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{formatINR(p.in4PendingValue)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-gray-500">{formatINR(p.hubPendingValue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-3 py-2 text-[11px] text-gray-500">Pending ₹ is higher from IN4 wherever the upload had unpriced POs — IN4 carries the order rate on every line.</p>
    </div>
  )
}

function ReportCmp({ c }: { c: ReportComparison | null }) {
  if (!c) return <p className="text-xs text-gray-500">No comparison yet — run the feed once.</p>
  return (
    <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
      <div className="px-3 py-2 border-b border-gray-100 text-xs text-gray-700">{c.totals.exact} projects exact · {c.totals.near} near · {c.totals.off} off{c.uploadAt ? ` · upload of ${formatDateTime(c.uploadAt)}` : ''}. Six figures per project: gross, recoveries, paid, deductions, retention, outstanding.</div>
      <div className="overflow-x-auto max-h-[50vh] overflow-y-auto">
        <table className="w-full text-[12.5px]">
          <thead className="bg-gray-50 text-left text-[10px] uppercase tracking-wide text-gray-500 sticky top-0">
            <tr><th className="px-3 py-1.5">Project</th><th className="px-3 py-1.5">Verdict</th><th className="px-3 py-1.5 text-right">Gross IN4</th><th className="px-3 py-1.5 text-right">Gross upload</th><th className="px-3 py-1.5 text-right">Paid IN4</th><th className="px-3 py-1.5 text-right">Paid upload</th><th className="px-3 py-1.5 text-right">Outstanding IN4</th><th className="px-3 py-1.5 text-right">Outstanding upload</th></tr>
          </thead>
          <tbody>
            {c.rows.map(r => (
              <tr key={r.project} className="border-t border-gray-50">
                <td className="px-3 py-1.5 text-gray-900">{r.project}</td>
                <td className="px-3 py-1.5"><Verdict v={r.verdict} /></td>
                <td className="px-3 py-1.5 text-right tabular-nums">{r.in4 ? formatINR(r.in4.grossBill) : '—'}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-gray-500">{r.hub ? formatINR(r.hub.grossBill) : '—'}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{r.in4 ? formatINR(r.in4.paid) : '—'}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-gray-500">{r.hub ? formatINR(r.hub.paid) : '—'}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{r.in4 ? formatINR(r.in4.outstanding) : '—'}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-gray-500">{r.hub ? formatINR(r.hub.outstanding) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SupplierCmp({ c }: { c: SupplierComparison | null }) {
  if (!c) return <p className="text-xs text-gray-500">No comparison yet — run the feed once.</p>
  return (
    <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
      <div className="px-3 py-2 border-b border-gray-100 text-xs text-gray-700">{c.totals.exact} projects exact · {c.totals.near} near · {c.totals.off} off{c.uploadAt ? ` · upload of ${formatDateTime(c.uploadAt)}` : ''}. Figure: the bill (landed cost + advances) per project.</div>
      <div className="overflow-x-auto max-h-[50vh] overflow-y-auto">
        <table className="w-full text-[12.5px]">
          <thead className="bg-gray-50 text-left text-[10px] uppercase tracking-wide text-gray-500 sticky top-0">
            <tr><th className="px-3 py-1.5">Project</th><th className="px-3 py-1.5">Verdict</th><th className="px-3 py-1.5 text-right">Bill IN4</th><th className="px-3 py-1.5 text-right">Bill upload</th><th className="px-3 py-1.5 text-right">Difference</th></tr>
          </thead>
          <tbody>
            {c.rows.map(r => (
              <tr key={r.project} className="border-t border-gray-50">
                <td className="px-3 py-1.5 text-gray-900">{r.project}</td>
                <td className="px-3 py-1.5"><Verdict v={r.verdict} /></td>
                <td className="px-3 py-1.5 text-right tabular-nums">{r.in4 == null ? '—' : formatINR(r.in4)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-gray-500">{r.hub == null ? '—' : formatINR(r.hub)}</td>
                <td className={`px-3 py-1.5 text-right tabular-nums ${r.verdict === 'exact' ? 'text-gray-400' : 'text-amber-700 font-medium'}`}>{r.in4 != null && r.hub != null ? formatINR(r.in4 - r.hub) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Stat({ label, value, hint, tone = 'default' }: { label: string; value: string; hint?: string; tone?: 'default' | 'green' | 'amber' | 'red' }) {
  const ring = tone === 'green' ? 'border-emerald-200 bg-emerald-50/60' : tone === 'amber' ? 'border-amber-200 bg-amber-50/60' : tone === 'red' ? 'border-rose-200 bg-rose-50/60' : 'border-gray-200 bg-white'
  return (
    <div className={`rounded-xl border p-3 ${ring}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      <p className="text-lg font-bold text-gray-900 leading-tight mt-0.5 truncate" title={value}>{value}</p>
      {hint && <p className="text-[11px] text-gray-500 mt-0.5 truncate" title={hint}>{hint}</p>}
    </div>
  )
}
