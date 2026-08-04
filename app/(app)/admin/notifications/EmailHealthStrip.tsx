'use client'
// At-a-glance email delivery health for admins. Shows last-7-day status counts,
// a stuck-pending count, and any recent failures — plus a "Run retry now" button
// that fires the same sweep the cron runs. Data comes from the
// email_delivery_health() RPC (admin/portal-owner gated).

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Mail, CheckCircle2, AlertTriangle, XCircle, Clock, RefreshCw, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface EmailHealth {
  counts: Record<string, number>
  stuck: number
  recent: Array<{ to: string; subject: string; status: string; attempts: number; error: string | null; at: string }>
}

export function EmailHealthStrip({ health }: { health: EmailHealth }) {
  const router = useRouter()
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const sent = health.counts.sent ?? 0
  const failed = health.counts.failed ?? 0
  const dead = health.counts.dead ?? 0
  const stuck = health.stuck ?? 0
  const problems = failed + dead + stuck
  const healthy = problems === 0

  async function runRetry() {
    setRunning(true); setResult(null)
    try {
      const res = await fetch('/api/cron/email-retry', { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (res.ok) {
        setResult(`Retried ${body.retried ?? 0}${body.dead ? ` · ${body.dead} gave up` : ''}.`)
        router.refresh()
      } else {
        setResult(body.reason || 'Could not run the sweep.')
      }
    } catch {
      setResult('Could not reach the retry endpoint.')
    } finally {
      setRunning(false)
    }
  }

  return (
    <Card className="max-w-4xl mx-auto p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-8 w-8 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center flex-shrink-0">
            <Mail className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-gray-900">Email health</h3>
            <p className="text-xs text-gray-500">Delivery over the last 7 days</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {result && <span className="text-xs text-gray-500 hidden sm:inline">{result}</span>}
          <Button variant="outline" onClick={runRetry} disabled={running} className="h-8">
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            <span className="ml-1.5">Run retry now</span>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Sent" value={sent} tone="green" icon={<CheckCircle2 className="h-4 w-4" />} />
        <Stat label="Failed" value={failed} tone={failed > 0 ? 'amber' : 'grey'} icon={<AlertTriangle className="h-4 w-4" />} />
        <Stat label="Gave up" value={dead} tone={dead > 0 ? 'red' : 'grey'} icon={<XCircle className="h-4 w-4" />} />
        <Stat label="Stuck" value={stuck} tone={stuck > 0 ? 'amber' : 'grey'} icon={<Clock className="h-4 w-4" />} />
      </div>

      {healthy ? (
        <p className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
          <CheckCircle2 className="h-3.5 w-3.5" /> All emails are delivering — nothing needs attention.
        </p>
      ) : (
        <div className="mt-3">
          <p className="text-xs font-semibold text-gray-700 mb-1.5">Recent problems</p>
          {health.recent.length === 0 ? (
            <p className="text-xs text-gray-500">No failures in the recent window (the counts above are older than the detail list).</p>
          ) : (
            <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 overflow-hidden">
              {health.recent.map((r, i) => (
                <div key={i} className="flex items-start gap-2 px-3 py-2 text-xs">
                  <span className={cn(
                    'mt-0.5 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase flex-shrink-0',
                    r.status === 'dead' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-800',
                  )}>{r.status === 'dead' ? 'gave up' : 'failed'}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-gray-900 truncate"><span className="font-medium">{r.to}</span> · {r.subject}</p>
                    {r.error && <p className="text-gray-500 truncate">{r.error}</p>}
                  </div>
                  <span className="text-gray-400 flex-shrink-0 whitespace-nowrap">{r.attempts}× · {r.at}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

function Stat({ label, value, tone, icon }: { label: string; value: number; tone: 'green' | 'amber' | 'red' | 'grey'; icon: React.ReactNode }) {
  const tones: Record<string, string> = {
    green: 'text-emerald-700 bg-emerald-50',
    amber: 'text-amber-700 bg-amber-50',
    red: 'text-rose-700 bg-rose-50',
    grey: 'text-gray-500 bg-gray-50',
  }
  return (
    <div className="rounded-lg border border-gray-200 p-2.5">
      <div className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide', tones[tone])}>
        {icon}{label}
      </div>
      <div className="text-2xl font-extrabold tabular-nums text-gray-900 mt-1">{value}</div>
    </div>
  )
}
