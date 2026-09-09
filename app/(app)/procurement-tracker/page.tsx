import Link from 'next/link'
import { Upload, Radio } from 'lucide-react'
import { requirePermission, getMyProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { readFeedModes, readLastFeedSync } from '@/lib/in4/feeds'
import { ProcurementTrackerClient } from './client'
import { LiveTracker } from './live'
import type { BoardParams } from '@/lib/revamp/indents-board'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Indent → PO Tracker. Default: live from IN4, every project, with the cycle
 * on every indent (the same rows as each project's Indents tab). The older
 * upload-based tracker — chase notes, the Excel uploads, the digest's source
 * — stays one click away under "Upload".
 */
export default async function ProcurementTrackerPage({ searchParams }: { searchParams: Promise<{ view?: string } & BoardParams> }) {
  await requirePermission('procurement-tracker', 'view')
  const { view, months: m, ...params } = await searchParams
  const months = Math.max(1, Math.min(60, Number(m) || 12))

  if (view !== 'upload') {
    return (
      <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
        <header className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-gray-900 leading-tight">Indent → PO Tracker</h1>
            <p className="text-[13px] text-gray-500 mt-0.5 inline-flex items-center gap-1.5"><Radio className="h-3.5 w-3.5 text-emerald-600" /> Live from IN4 — every project, the whole cycle, what is late.</p>
          </div>
          <Link href="/procurement-tracker?view=upload" className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 text-[13px] font-medium text-gray-700 hover:bg-gray-50 min-h-[44px]">
            <Upload className="h-4 w-4" /> Upload-based tracker
          </Link>
        </header>
        <LiveTracker params={{ ...params, months: m }} months={months} />
      </div>
    )
  }

  // ── The upload-based tracker, unchanged ──────────────────────────────────
  const profile = await getMyProfile()
  const isAdmin = profile?.role === 'admin'

  // Projects the team has marked "closed" — always rolled up under Cleared on
  // the filter strip, even when IN4 still shows a few stray pending items on
  // them. Stored in app_settings so it survives every upload.
  const supabase = await createClient()
  const { data: row } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'procurement_closed_projects')
    .maybeSingle()
  let closedProjects: string[] = []
  try {
    const parsed = JSON.parse(row?.value ?? '[]')
    if (Array.isArray(parsed)) closedProjects = parsed.filter((x): x is string => typeof x === 'string')
  } catch { /* malformed setting — treat as none */ }

  // When the IN4 feed is live the tracker is written from IN4 twice a day and
  // the two Excel uploads are no longer needed; the client hides them.
  const [modes, last] = await Promise.all([readFeedModes(supabase), readLastFeedSync(supabase, 'tracker')])
  const in4 = modes.tracker === 'live' ? { live: true, at: last?.ok ? last.at : null, error: last && !last.ok ? (last.error ?? 'failed') : null } : null

  return (
    <>
      <div className="px-4 md:px-6 pt-3 max-w-7xl mx-auto">
        <Link href="/procurement-tracker" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-indigo-700 hover:underline min-h-[44px]">
          <Radio className="h-3.5 w-3.5" /> Back to the live tracker
        </Link>
      </div>
      <ProcurementTrackerClient isAdmin={isAdmin} closedProjects={closedProjects} in4={in4} />
    </>
  )
}
