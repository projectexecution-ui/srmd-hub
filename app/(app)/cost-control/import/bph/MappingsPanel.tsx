'use client'
// Shows the BPH↔CT mappings already saved. Each row can be re-synced
// (re-pull latest BPH numbers — useful after a parser fix, or to refresh
// on demand without waiting for the next /budget save) or unlinked.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { RefreshCw, Link2Off, Loader2, Check, AlertTriangle, ArrowRight } from 'lucide-react'
import { confirm } from '@/components/ui/confirm-dialog'
import { commitBphImport, unlinkBphMapping } from './actions'

export interface MappingRow {
  bph_project_id: string
  cc_project_id: string
  bph_name: string
  cc_label: string
  last_pulled_at: string | null
}

export function MappingsPanel({ mappings }: { mappings: MappingRow[] }) {
  return (
    <Card className="overflow-hidden">
      <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200">
        <h3 className="text-sm font-semibold text-gray-900">Current mappings</h3>
        <p className="text-[11px] text-gray-500">
          These auto-sync every time you upload to /budget. Use <b>Sync now</b> to pull the latest BPH numbers immediately (e.g. after a fix), or <b>Unlink</b> to stop auto-syncing a project.
        </p>
      </div>
      <ul className="divide-y divide-gray-100">
        {mappings.map(m => <MappingItem key={m.bph_project_id} m={m} />)}
      </ul>
    </Card>
  )
}

function MappingItem({ m }: { m: MappingRow }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  function syncNow() {
    setMsg(null)
    startTransition(async () => {
      // useAi:false — this button has no preview step, so AI must never
      // guess a mapping here; only exact/normalised code matches land.
      const res = await commitBphImport({ bph_project_id: m.bph_project_id, cc_project_id: m.cc_project_id }, { useAi: false })
      if (!res.ok) { setMsg({ ok: false, text: res.error }); return }
      setMsg({ ok: true, text: `${res.inserted} new · ${res.updated} updated${res.skipped ? ` · ${res.skipped} skipped` : ''}` })
      router.refresh()
    })
  }

  async function unlink() {
    const ok = await confirm({
      title: 'Unlink this mapping?',
      message: `Stop auto-syncing "${m.bph_name}" → ${m.cc_label}. Budget data already pulled stays put; it just won't refresh on future BPH uploads. You can re-map anytime.`,
      confirmLabel: 'Unlink',
      danger: true,
    })
    if (!ok) return
    startTransition(async () => {
      const res = await unlinkBphMapping(m.bph_project_id)
      if (!res.ok) { setMsg({ ok: false, text: res.error ?? 'Unlink failed' }); return }
      router.refresh()
    })
  }

  const when = m.last_pulled_at
    ? new Date(m.last_pulled_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })
    : 'never'

  return (
    <li className="px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
      <div className="min-w-0">
        <p className="text-sm text-gray-900 flex items-center gap-1.5 flex-wrap">
          <span className="font-medium">{m.bph_name}</span>
          <ArrowRight className="h-3.5 w-3.5 text-gray-400" />
          <Link href={`/cost-control/projects/${m.cc_project_id}`} className="font-semibold text-blue-700 hover:underline">
            {m.cc_label}
          </Link>
        </p>
        <p className="text-[11px] text-gray-500">Last synced {when}</p>
        {msg && (
          <p className={`text-[11px] mt-0.5 inline-flex items-center gap-1 ${msg.ok ? 'text-emerald-700' : 'text-rose-700'}`}>
            {msg.ok ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}{msg.text}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={syncNow} disabled={pending}>
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Sync now
        </Button>
        <Button size="sm" variant="ghost" onClick={unlink} disabled={pending}
          className="text-rose-700 hover:bg-rose-50">
          <Link2Off className="h-3.5 w-3.5" /> Unlink
        </Button>
      </div>
    </li>
  )
}
