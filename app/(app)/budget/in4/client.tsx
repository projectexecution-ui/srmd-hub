'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { QueryError } from '@/components/ui/query-error'
import { confirm } from '@/components/ui/confirm-dialog'
import { formatINR, formatDateTime } from '@/lib/utils'
import { Loader2, RefreshCw, Link2, Link2Off, CheckCircle2, AlertTriangle, Power } from 'lucide-react'
import type { ComparisonSummary } from '@/lib/in4/compare'
import type { LastSync } from '@/lib/in4/sync'
import { setIn4Live, linkSubproject } from './actions'

export interface LinkRow { subprojectId: number; name: string; exCode: string | null; bphProjectId: string | null; source: string | null }
export interface BphOption { id: string; name: string; fileName: string | null }

interface Props {
  configured: boolean
  live: boolean
  last: LastSync | null
  lastRun: { id: number; startedAt: string; trigger: string; mode: string; ok: boolean; error: string | null } | null
  comparison: ComparisonSummary | null
  rows: LinkRow[]
  bphOptions: BphOption[]
  unlinkedBph: BphOption[]
  mirrorCount: number
}

export function In4SyncClient({ configured, live, last, lastRun, comparison, rows, bphOptions, unlinkedBph, mirrorCount }: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState<'run' | 'switch' | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [openProject, setOpenProject] = useState<string | null>(null)

  async function runNow() {
    setBusy('run'); setErr(null)
    try {
      const res = await fetch('/api/cron/in4-sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const j = await res.json().catch(() => null)
      if (!res.ok) setErr(j?.reason ?? j?.error ?? `Sync failed (${res.status})`)
      router.refresh()
    } catch (e) { setErr(e instanceof Error ? e.message : 'Sync failed') }
    finally { setBusy(null) }
  }

  async function toggleLive() {
    if (!live) {
      const ok = await confirm({
        title: 'Make IN4 the source of the budget report?',
        message: 'From the next sync, the Budget pages and the Internal Estimate\'s ERP columns will read IN4 directly, twice a day. The Excel upload keeps working as a fallback. You can switch back here any time.',
        confirmLabel: 'Go live',
      })
      if (!ok) return
    }
    setBusy('switch'); setErr(null)
    const r = await setIn4Live(!live)
    setBusy(null)
    if (!r.ok) setErr(r.error ?? 'Could not change the switch'); else router.refresh()
  }

  const pct = comparison && comparison.totals.figures > 0 ? Math.round((comparison.totals.exact / comparison.totals.figures) * 100) : null

  return (
    <div className="space-y-4">
      {err && <QueryError message={err} what="the IN4 sync" />}

      {!configured && (
        <Card className="p-4 border-amber-300 bg-amber-50 text-sm text-amber-900">
          <p className="font-semibold">IN4 is not connected on this deployment.</p>
          <p className="mt-1">Add <code>IN4_DB_HOST</code>, <code>IN4_DB_PORT</code>, <code>IN4_DB_NAME</code>, <code>IN4_DB_USER</code> and <code>IN4_DB_PASSWORD</code> in Vercel → ct-hub → Settings → Environment Variables (Production), then redeploy. Locally they live in <code>.env.in4.local</code>.</p>
        </Card>
      )}

      {/* Status strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Mode" value={live ? 'Live' : 'Shadow'} hint={live ? 'IN4 writes the budget report' : 'Excel upload is still the source'} tone={live ? 'green' : 'amber'} />
        <Stat label="Last sync" value={last ? formatDateTime(last.at) : 'never'} hint={last ? (last.ok ? `${last.subprojects ?? 0} sub-projects · ${last.linked ?? 0} linked` : `failed: ${last.error ?? ''}`) : 'run it once to start'} tone={last && !last.ok ? 'red' : 'default'} />
        <Stat label="Matches last upload" value={pct == null ? '—' : `${pct}%`} hint={comparison ? `${comparison.totals.exact} exact · ${comparison.totals.near} near · ${comparison.totals.off} off` : 'no comparison yet'} tone={pct == null ? 'default' : pct >= 95 ? 'green' : pct >= 80 ? 'amber' : 'red'} />
        <Stat label="IN4 sub-projects" value={String(mirrorCount)} hint={`${rows.filter(r => r.bphProjectId).length} linked to a Budget-Hub project`} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={runNow} disabled={!configured || busy !== null} size="sm">
          {busy === 'run' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Run sync now
        </Button>
        <Button onClick={toggleLive} disabled={!configured || busy !== null} size="sm" variant={live ? 'outline' : 'default'}>
          {busy === 'switch' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />} {live ? 'Back to shadow mode' : 'Go live'}
        </Button>
        {lastRun && (
          <span className="text-xs text-gray-500">
            Last run #{lastRun.id} · {lastRun.trigger} · {lastRun.mode} · {lastRun.ok ? 'ok' : `failed — ${lastRun.error}`}
          </span>
        )}
      </div>

      {/* Comparison */}
      {comparison && (
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/60 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">IN4 today vs your last upload</h3>
            <span className="text-[11px] text-gray-500">compared {formatDateTime(comparison.comparedAt)} · exact = within ₹1 · near = within 0.5%</span>
          </div>
          <div className="divide-y divide-gray-100">
            {comparison.projects.map(p => {
              const total = p.exact + p.near + p.off
              const open = openProject === p.bphProjectId
              return (
                <div key={p.bphProjectId}>
                  <button type="button" onClick={() => setOpenProject(open ? null : p.bphProjectId)} className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-gray-50">
                    {p.off === 0 ? <CheckCircle2 className="h-4 w-4 text-emerald-600 flex-shrink-0" /> : <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0" />}
                    <span className="font-medium text-sm text-gray-900 flex-1 min-w-0 truncate">{p.bphName}</span>
                    <span className="text-xs tabular-nums text-gray-600">{p.exact}/{total} exact{p.near ? ` · ${p.near} near` : ''}{p.off ? ` · ${p.off} off` : ''}</span>
                  </button>
                  {open && p.diffs.length > 0 && (
                    <div className="overflow-x-auto border-t border-gray-100 bg-white">
                      <table className="w-full text-[12.5px]">
                        <thead className="bg-gray-50 text-left text-[10px] uppercase tracking-wide text-gray-500">
                          <tr><th className="px-4 py-1.5">Line</th><th className="px-3 py-1.5">Figure</th><th className="px-3 py-1.5 text-right">Last upload</th><th className="px-3 py-1.5 text-right">IN4 now</th><th className="px-3 py-1.5 text-right">Difference</th></tr>
                        </thead>
                        <tbody>
                          {p.diffs.slice(0, 40).map((d, i) => (
                            <tr key={i} className="border-t border-gray-50">
                              <td className="px-4 py-1.5"><span className="font-mono text-[11px] text-gray-500 mr-1.5">{d.level === 'sub' ? d.code : `cat ${d.code}`}</span>{d.head}</td>
                              <td className="px-3 py-1.5 text-gray-600">{d.field === 'woApproved' ? 'WO/PO approved' : d.field}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums">{d.hub == null ? <span className="text-gray-400">not in upload</span> : formatINR(d.hub)}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums">{d.in4 == null ? <span className="text-gray-400">not in IN4</span> : formatINR(d.in4)}</td>
                              <td className={`px-3 py-1.5 text-right tabular-nums font-medium ${d.verdict === 'near' ? 'text-amber-700' : 'text-rose-700'}`}>{formatINR((d.in4 ?? 0) - (d.hub ?? 0))}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {p.diffs.length > 40 && <p className="px-4 py-2 text-[11px] text-gray-500">{p.diffs.length - 40} more differences not shown.</p>}
                    </div>
                  )}
                  {open && p.diffs.length === 0 && <p className="px-4 py-2 text-xs text-emerald-700 bg-emerald-50/50">Every figure matches the upload.</p>}
                </div>
              )
            })}
            {comparison.projects.length === 0 && <p className="px-4 py-6 text-sm text-gray-500 text-center">No linked projects to compare yet.</p>}
          </div>
        </Card>
      )}

      {/* Links */}
      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/60">
          <h3 className="text-sm font-semibold text-gray-900">Which IN4 sub-project is which Budget-Hub project</h3>
          <p className="text-[11px] text-gray-500 mt-0.5">Seeded from the file names of your uploads. {unlinkedBph.length > 0 ? `${unlinkedBph.length} Budget-Hub project${unlinkedBph.length === 1 ? '' : 's'} still need a sub-project: ${unlinkedBph.map(p => p.name).join(', ')}.` : 'Every Budget-Hub project is linked.'}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead className="bg-gray-50 text-left text-[10px] uppercase tracking-wide text-gray-500">
              <tr><th className="px-4 py-2">IN4 sub-project</th><th className="px-3 py-2">Code</th><th className="px-3 py-2">Budget-Hub project</th><th className="px-3 py-2">How</th></tr>
            </thead>
            <tbody>
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
