'use client'
// Management-only "AI check" button under the summary screenshot. Asks the
// vision model whether the screenshot looks trustworthy at a glance or the
// Excel should be opened. Advisory only.

import { useState } from 'react'
import { Sparkles, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react'

type Result =
  | { ok: true; verdict: 'looks_good' | 'check_excel'; confidence?: string; total_seen?: number | null; issues?: string[]; note?: string }
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

  const good = res?.ok && res.verdict === 'looks_good'

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
        <span className="text-[11px] text-gray-400">Quick sanity check — the Excel is the source of truth.</span>
      </div>

      {res && !res.ok && (
        <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">{res.reason}</p>
      )}

      {res && res.ok && (
        <div className={`rounded-md border px-3 py-2 text-xs ${good ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
          <p className="font-semibold inline-flex items-center gap-1.5">
            {good ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
            {good ? 'Looks good' : 'Better to open the Excel'}
            {res.confidence && <span className="font-normal text-[10px] opacity-70">· {res.confidence} confidence</span>}
          </p>
          {res.note && <p className="mt-1">{res.note}</p>}
          {res.issues && res.issues.length > 0 && (
            <ul className="mt-1 list-disc pl-4 space-y-0.5">
              {res.issues.map((i, ix) => <li key={ix}>{i}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
