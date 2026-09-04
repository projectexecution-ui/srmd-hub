import { requirePermission, getMyProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { readFeedModes, readLastFeedSync } from '@/lib/in4/feeds'
import { ProcurementTrackerClient } from './client'

export const dynamic = 'force-dynamic'

export default async function ProcurementTrackerPage() {
  await requirePermission('procurement-tracker', 'view')
  // Pass admin status server-side so the page header can decide
  // whether to surface the in-module "Project Visibility" link
  // (lives at /procurement-tracker/admin).
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

  return <ProcurementTrackerClient isAdmin={isAdmin} closedProjects={closedProjects} in4={in4} />
}
