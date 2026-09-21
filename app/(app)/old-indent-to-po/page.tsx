import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Radio, FileDown } from 'lucide-react'
import { getMyProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { readFeedModes, readLastFeedSync } from '@/lib/in4/feeds'
import { canOpenOldIndentToPo, OLD_INDENT_TO_PO_SRC } from '@/lib/old-indent-to-po'
import { ProcurementTrackerClient } from './client'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * OLD INDENT TO PO — his tracker, fed by IN4.
 *
 * Aksha, 21 Sep 2026: "this is the first one - i want the next one ... i had
 * made lot of improvemnrts", then "just connrct live in4 data with old
 * tracker". Three generations of this screen:
 *
 *   1  public/indent-tracker.html — a standalone viewer whose own title says
 *      "(Offline Backup)". Linked below; it still needs an Excel.
 *   2  THIS — the tracker the improvements went into: two IN4 report formats
 *      merged, the project filter strip that puts every project on one screen,
 *      universal search, data health, the source inspector, dropped-line
 *      inspection, PDF export.
 *   3  /procurement-tracker as it stands — a different live view, untouched.
 *
 * Restored whole out of the commit that deleted it (clean-up round 2,
 * 10 September) rather than rebuilt: the point is the screen he remembers.
 *
 * IT NO LONGER NEEDS THE SPREADSHEET. The `tracker` feed reads IN4's
 * PURCH_INDENT_TO_ISSUE twice a day and writes the same state blob an upload
 * used to write, so everything below is unchanged and simply stops waiting for
 * an Excel. The feed had gone with the screen, which is why the in4_indent_items
 * mirror had been frozen since 10 September — a mirror does not refresh itself.
 *
 * LEFT OUT DELIBERATELY: the daily digest and its notification settings — the
 * cron that mailed people, which is the part he asked to be rid of in
 * September. Chase NOTES stayed: a note on a row, woven through five of the
 * restored files, and cutting them would mean editing a restore whose whole
 * value is fidelity.
 */
export default async function OldIndentToPoPage() {
  // Not a redirect and not a polite message: for anybody not on the list this
  // screen does not exist. Same refusal the lane's absence implies.
  if (!(await canOpenOldIndentToPo())) notFound()

  const profile = await getMyProfile()
  const isAdmin = profile?.role === 'admin'

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

  /**
   * Live from IN4, not from a spreadsheet.
   *
   * Aksha, 21 Sep 2026: "just connrct live in4 data with old tracker". The
   * tracker feed reads PURCH_INDENT_TO_ISSUE twice a day and writes the same
   * state blob an upload used to write, so every screen below is unchanged and
   * simply stops needing the Excel. When the switch is on the client hides the
   * upload boxes; when it is off they come back, so the upload route is never
   * taken away — it is just no longer the only way in.
   */
  const [modes, last] = await Promise.all([
    readFeedModes(supabase),
    readLastFeedSync(supabase, 'tracker'),
  ])
  const in4 = modes.tracker === 'live'
    ? { live: true, at: last?.ok ? last.at : null, error: last && !last.ok ? (last.error ?? 'failed') : null }
    : null

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 px-4 md:px-6 pt-3 max-w-7xl mx-auto w-full">
        <div className="min-w-0">
          <h1 className="text-xl md:text-2xl font-bold leading-tight text-gray-900">OLD INDENT TO PO</h1>
          <p className="text-[13px] text-gray-500 mt-0.5">
            Every project on one screen — fed from IN4, twice a day.
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

      {/* The real role, not a hard-coded true. Being ON the list gets you the
          tracker; it does not get you the admin link beside it, which leads to
          a page that would refuse anybody who is not an admin. */}
      <ProcurementTrackerClient isAdmin={isAdmin} closedProjects={closedProjects} in4={in4} />
    </div>
  )
}
