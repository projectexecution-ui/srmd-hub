'use client'
// The "CT Hub V1" card on the Admin home — internal use. One button: put the
// previous CT Hub back for everyone, or bring the revamp back. No deploy.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { History, Loader2, AlertTriangle } from 'lucide-react'
import { setCthubShell } from '@/app/actions/shell'
import type { ShellMode } from '@/lib/revamp/live'

export function ShellSwitch({ mode }: { mode: ShellMode }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const v1 = mode === 'v1'

  function flip() {
    setError(null)
    start(async () => {
      const res = await setCthubShell(v1 ? 'v2' : 'v1')
      if (!res.ok) { setError(res.error ?? 'Could not switch.'); return }
      router.refresh()
    })
  }

  return (
    <div className={`rounded-2xl border p-4 flex flex-wrap items-center gap-3 ${v1 ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-white'}`}>
      <History className={`h-5 w-5 flex-shrink-0 ${v1 ? 'text-amber-700' : 'text-gray-400'}`} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-gray-900">
          CT Hub V1 <span className="ml-1 text-[11px] font-medium text-gray-500">internal use</span>
        </p>
        <p className="text-xs text-gray-600">
          {v1
            ? 'ON — everyone sees the previous CT Hub (old sidebar, old project pages). The revamp is installed but hidden.'
            : 'Off — everyone sees the revamp. Switching on puts the previous CT Hub back for everyone on their next page load, no deploy.'}
        </p>
        {error && <p className="mt-1 text-xs text-rose-700 inline-flex items-center gap-1"><AlertTriangle className="h-3 w-3" />{error}</p>}
      </div>
      <button
        type="button"
        onClick={flip}
        disabled={pending}
        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold min-h-[44px] disabled:opacity-60 ${v1 ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'border border-amber-300 bg-white text-amber-800 hover:bg-amber-50'}`}
      >
        {pending && <Loader2 className="h-4 w-4 animate-spin" />}
        {v1 ? 'Back to the revamp' : 'Switch to CT Hub V1'}
      </button>
    </div>
  )
}
