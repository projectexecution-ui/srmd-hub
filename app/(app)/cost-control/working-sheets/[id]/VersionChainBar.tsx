'use client'
// Version-chain navigation bar shown above the main content on each WS
// detail page. Carries: the "v2 of 3" pill, prev/next links to sibling
// versions in the same chain, and (for engineers/admins) a "Start fresh
// chain" toggle that flips cc_working_sheets.break_chain.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, GitBranch, Loader2 } from 'lucide-react'
import { confirm } from '@/components/ui/confirm-dialog'
import { setBreakChain } from './version-actions'

interface SiblingLite {
  id: string
  ws_code: string
  version_no: number
}

export function VersionChainBar({
  wsId,
  versionNo,
  chainSize,
  breakChain,
  prev,
  next,
  canEdit,
}: {
  wsId: string
  versionNo: number
  chainSize: number
  breakChain: boolean
  prev: SiblingLite | null
  next: SiblingLite | null
  canEdit: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  async function onToggle() {
    const turningOn = !breakChain
    const ok = await confirm({
      title: turningOn ? 'Start a new version chain?' : 'Re-join the previous chain?',
      message: turningOn
        ? 'Mark THIS Working Sheet as the first version of a fresh chain. Older WSes in the same sub-skill stop being version-mates of this one. Older versions stay unchanged in their own chain — nothing is deleted.'
        : 'Re-join this WS to the chain it would naturally fall into based on its sub-skill + line type.',
      confirmLabel: turningOn ? 'Start fresh chain' : 'Re-join chain',
      danger: false,
    })
    if (!ok) return
    setErr(null)
    startTransition(async () => {
      const res = await setBreakChain(wsId, turningOn)
      if (!res.ok) { setErr(res.error); return }
      router.refresh()
    })
  }

  const lonely = chainSize === 1

  return (
    <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 flex-wrap">
      <span className={`inline-flex items-center gap-1 rounded-md text-xs font-mono font-semibold px-2 py-0.5 ${
        lonely ? 'bg-gray-50 text-gray-500 border border-gray-200' : 'bg-blue-50 text-blue-800 border border-blue-200'
      }`}>
        {breakChain && <GitBranch className="h-3 w-3" />}
        v{versionNo}/{chainSize}
      </span>

      {prev ? (
        <Link
          href={`/cost-control/working-sheets/${prev.id}`}
          className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-blue-700 hover:underline"
          title={`Previous: ${prev.ws_code} (v${prev.version_no})`}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          v{prev.version_no} · {prev.ws_code}
        </Link>
      ) : (
        <span className="inline-flex items-center gap-1 text-xs text-gray-300">
          <ChevronLeft className="h-3.5 w-3.5" />
          first
        </span>
      )}

      <span className="text-gray-300">·</span>

      {next ? (
        <Link
          href={`/cost-control/working-sheets/${next.id}`}
          className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-blue-700 hover:underline"
          title={`Next: ${next.ws_code} (v${next.version_no})`}
        >
          v{next.version_no} · {next.ws_code}
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      ) : (
        <span className="inline-flex items-center gap-1 text-xs text-gray-300">
          latest
          <ChevronRight className="h-3.5 w-3.5" />
        </span>
      )}

      {canEdit && (
        <div className="ml-auto flex items-center gap-1">
          {err && <span className="text-[10px] text-rose-700">{err}</span>}
          <button
            type="button"
            onClick={onToggle}
            disabled={pending}
            className={`inline-flex items-center gap-1 text-[11px] font-semibold rounded px-2 py-1 ${
              breakChain
                ? 'text-blue-700 hover:bg-blue-50'
                : 'text-gray-500 hover:text-blue-700 hover:bg-blue-50'
            } disabled:opacity-50`}
            title={breakChain ? 'This WS starts a new chain — click to re-join the previous one' : 'Mark this as the start of a NEW chain (not a version of older WSes in this sub-skill)'}
          >
            {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <GitBranch className="h-3 w-3" />}
            {breakChain ? 'Re-join chain' : 'Start fresh chain'}
          </button>
        </div>
      )}
    </div>
  )
}
