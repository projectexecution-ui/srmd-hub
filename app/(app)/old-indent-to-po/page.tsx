import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Radio, FileDown } from 'lucide-react'
import { getMyProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { canSeeOldIndentToPo, OLD_INDENT_TO_PO_SRC } from '@/lib/old-indent-to-po'
import { ProcurementTrackerClient } from './client'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * OLD INDENT TO PO — the upload-based tracker, back.
 *
 * Aksha, 21 Sep 2026, on the standalone HTML I restored first: "this is the
 * first one - i want the next one ... i had made lot of improvemnrts".
 *
 * He is right, and the first restore was the wrong artefact. There were three
 * generations of this screen:
 *
 *   1  public/indent-tracker.html — a standalone offline viewer. Its own title
 *      calls it "(Offline Backup)". Still here, linked below.
 *   2  THIS — the upload-based tracker the improvements went into: two IN4
 *      report formats merged, the project filter strip that puts every project
 *      on one screen, universal search, the data-health panel, dropped-line
 *      inspection, the source inspector, PDF export.
 *   3  /procurement-tracker as it stands today — live from IN4, untouched by
 *      this and still there for everyone who has it.
 *
 * Restored whole out of the commit that deleted it (clean-up round 2,
 * 10 September): 15 engine files, 21 components, four routes. Not rebuilt —
 * the point is the screen he remembers, and 5,500 lines rewritten from memory
 * would be a different one.
 *
 * WHAT WAS DELIBERATELY LEFT OUT: the daily digest and its notification
 * settings. That is the part he actually asked to be rid of on 10 September
 * ("remove chase feature, it's not required for me now") — a cron that mails
 * people. The chase NOTES stayed, because they are a note on a row, they are
 * woven through five of the restored files, and cutting them would mean
 * editing a restore whose whole value is being faithful.
 */
export default async function OldIndentToPoPage() {
  const profile = await getMyProfile()
  // Not a redirect and not a polite message: for anybody else this screen does
  // not exist. Same refusal the lane's absence implies.
  if (!canSeeOldIndentToPo(profile?.role)) notFound()

  // Projects the team marked "closed" — always rolled up under Cleared on the
  // filter strip, even when IN4 still shows a few stray pending items on them.
  // Kept in app_settings so it survives every upload.
  const supabase = await createClient()
  const { data: row } = await supabase
    .from('app_settings').select('value').eq('key', 'procurement_closed_projects').maybeSingle()
  let closedProjects: string[] = []
  try {
    const parsed = JSON.parse((row?.value as string | undefined) ?? '[]')
    if (Array.isArray(parsed)) closedProjects = parsed.filter((x): x is string => typeof x === 'string')
  } catch { /* malformed setting — treat as none */ }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 px-4 md:px-6 pt-3 max-w-7xl mx-auto w-full">
        <div className="min-w-0">
          <h1 className="text-xl md:text-2xl font-bold leading-tight text-gray-900">OLD INDENT TO PO</h1>
          <p className="text-[13px] text-gray-500 mt-0.5">
            The upload-based tracker — every project on one screen. Your last upload is still here.
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Link
            href="/procurement-tracker"
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 text-[13px] font-medium text-gray-700 hover:bg-gray-50"
          >
            <Radio className="h-4 w-4 text-emerald-600" /> Live tracker
          </Link>
          {/* Generation 1, kept because it works with no server at all. */}
          <a
            href={OLD_INDENT_TO_PO_SRC}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 text-[13px] font-medium text-gray-700 hover:bg-gray-50"
          >
            <FileDown className="h-4 w-4" /> Offline copy
          </a>
        </div>
      </div>

      {/* in4=null on purpose: the IN4 tracker FEED was removed in the same
          clean-up and is not coming back, so this is the upload tracker doing
          what its name says. The live IN4 view is the lane next door. */}
      <ProcurementTrackerClient isAdmin closedProjects={closedProjects} in4={null} />
    </div>
  )
}
