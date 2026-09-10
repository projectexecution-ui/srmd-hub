'use client'
// The one switch on the fallback page. While on, the IN4 feeds stop writing
// and the upload panels below become the source.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, AlertTriangle, UploadCloud, Radio } from 'lucide-react'
import { setManualUpload } from './actions'

export function ManualUploadToggle({ on }: { on: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function flip() {
    setError(null)
    start(async () => {
      const res = await setManualUpload(!on)
      if (!res.ok) { setError(res.error ?? 'Could not switch.'); return }
      router.refresh()
    })
  }

  return (
    <div className={`rounded-2xl border p-4 flex flex-wrap items-center gap-3 ${on ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-white'}`}>
      {on ? <UploadCloud className="h-5 w-5 text-amber-700 flex-shrink-0" /> : <Radio className="h-5 w-5 text-emerald-600 flex-shrink-0" />}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-gray-900">
          Manual upload (IN4 fallback) <span className="ml-1 text-[11px] font-medium text-gray-500">{on ? 'ON' : 'off'}</span>
        </p>
        <p className="text-xs text-gray-600">
          {on
            ? 'The IN4 feeds are paused — they read and compare but do not write. The sheets you upload below are what every screen shows. Switch off once IN4 reads again.'
            : 'IN4 is read automatically twice a day. Switch on only if the live read fails; the upload panels then appear here.'}
        </p>
        {error && <p className="mt-1 text-xs text-rose-700 inline-flex items-center gap-1"><AlertTriangle className="h-3 w-3" />{error}</p>}
      </div>
      <button
        type="button"
        onClick={flip}
        disabled={pending}
        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold min-h-[44px] disabled:opacity-60 ${on ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'border border-amber-300 bg-white text-amber-800 hover:bg-amber-50'}`}
      >
        {pending && <Loader2 className="h-4 w-4 animate-spin" />}
        {on ? 'Back to live IN4' : 'Switch on manual upload'}
      </button>
    </div>
  )
}
