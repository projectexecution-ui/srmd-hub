'use client'
// Management-only "AI check" under the summary screenshot. The AI transcribes
// the numbers; the server recomputes the maths in code and returns what adds up
// and what doesn't. Advisory — the Excel is the source of truth.

import { useState } from 'react'
import { Sparkles, Loader2, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react'

type Result =
  | {
      ok: true
      verdict: 'looks_correct' | 'has_issues' | 'unreadable'
      rows?: number
      issues?: string[]
      checks?: string[]
      note?: string
    }
  | { ok: false; reason: string }

export function ScreenshotAiCheck({ wsId }: { wsId: string }) {
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<Result | null>(null)

  async function run() {
    setBusy(true); setRes(null)
    try {
      const r = await fetch(`/api/cost-control/working-sheets/${wsId}/check-screenshot`, { method: 'POST' })
      setRes(await r.json() as Result)
    } catch {
      setRes({ ok: false, reason: 'Could not run the check — please try again.' })
    } finally {
      setBusy(false)
    }
  }

  const good = res?.ok && res.verdict === 'looks_correct'
  const unreadable = res?.ok && res.verdict === 'unreadable'
  const tone = good ? 'emerald' : unreadable ? 'gray' : 'amber'
  const box = tone === 'emerald'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
    : tone === 'gray'
      ? 'border-gray-200 bg-gray-50 text-gray-700'
      : 'border-amber-200 bg-amber-50 text-amber-900'

  return (
    <div className="px-4 py-2.5 border-t border-gray-100 space-y-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={run}
          disabled={busy}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          AI check screenshot
        </button>
        <span className="text-[11px] text-gray-400">Reads the sheet &amp; re-does the maths — the Excel is the source of truth.</span>
      </div>

      {res && !res.ok && (
        <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">{res.reason}</p>
      )}

      {res && res.ok && (
        <div className={`rounded-md border px-3 py-2 text-xs ${box}`}>
          <p className="font-semibold inline-flex items-center gap-1.5">
            {good ? <CheckCircle2 className="h-4 w-4" /> : unreadable ? <XCircle className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
            {good ? 'The maths adds up' : unreadable ? 'Could not read it — open the Excel' : 'Some figures need a check'}
          </p>
          {res.note && <p className="mt-1">{res.note}</p>}

          {res.issues && res.issues.length > 0 && (
            <ul className="mt-2 space-y-1">
              {res.issues.map((i, ix) => (
                <li key={ix} className="flex gap-1.5"><AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5 text-amber-600" /><span>{i}</span></li>
              ))}
            </ul>
          )}

          {res.checks && res.checks.length > 0 && (
            <ul className="mt-2 space-y-1 opacity-80">
              {res.checks.map((c, ix) => (
                <li key={ix} className="flex gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0 mt-0.5 text-emerald-600" /><span>{c}</span></li>
              ))}
            </ul>
          )}

          <p className="mt-2 text-[10px] opacity-60">AI reads the numbers; the totals are recomputed exactly in code. Still double-check anything flagged against the Excel.</p>
        </div>
      )}
    </div>
  )
}
