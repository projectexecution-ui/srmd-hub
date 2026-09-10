'use client'
// "Pull latest from IN4" on Project setup. When the project is linked to its
// IN4 sub-projects (the Budget Hub mapping), it re-pulls the latest figures in
// place (one click, no leaving the page). When not linked, it goes to the
// mapping page pre-selected to this project. Renamed from "Sync from BPH" on
// 10 Sep 2026 — the source is IN4 live, not the Excel upload it replaced.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { RefreshCw, Loader2, Check, AlertTriangle, FileSpreadsheet } from 'lucide-react'
import { resyncBphForProject } from '@/app/(app)/cost-control/import/bph/actions'

export function BphSyncButton({ projectId, isMapped }: { projectId: string; isMapped: boolean }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  if (!isMapped) {
    // Not mapped yet — send them to the map flow with this project preset.
    return (
      <Link
        href={`/cost-control/import/bph?cc_project=${projectId}`}
        className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-white text-teal-700 border border-teal-300 text-sm font-semibold hover:bg-teal-50"
        title="Link this project to its IN4 sub-projects to pull budget + actuals"
      >
        <FileSpreadsheet className="h-4 w-4" /> Link to IN4
      </Link>
    )
  }

  function sync() {
    setMsg(null)
    startTransition(async () => {
      const res = await resyncBphForProject(projectId)
      if (!res.ok) {
        if (res.error === 'not_mapped') { router.push(`/cost-control/import/bph?cc_project=${projectId}`); return }
        setMsg({ ok: false, text: res.error }); return
      }
      setMsg({ ok: true, text: `${res.inserted} new · ${res.updated} updated${res.skipped ? ` · ${res.skipped} skipped` : ''}` })
      router.refresh()
      setTimeout(() => setMsg(null), 6000)
    })
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={sync}
        disabled={pending}
        className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-white text-teal-700 border border-teal-300 text-sm font-semibold hover:bg-teal-50 disabled:opacity-60"
        title="Pull the latest budget + actuals from IN4 now"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        Pull latest from IN4
      </button>
      {msg && (
        <span className={`text-[11px] inline-flex items-center gap-1 ${msg.ok ? 'text-emerald-700' : 'text-rose-700'}`}>
          {msg.ok ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}{msg.text}
        </span>
      )}
    </span>
  )
}
