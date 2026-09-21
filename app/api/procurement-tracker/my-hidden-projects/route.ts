// GET /api/procurement-tracker/my-hidden-projects
// Returns the project names that Admin has hidden for the *current*
// signed-in user. The procurement-tracker page fetches this on mount
// and filters its chip grid + lines accordingly.
//
// Response shape: { hidden: string[] }

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'

export const runtime = 'nodejs'

export async function GET() {
  // Same gate as the page — view perm on the tracker module.
  await requirePermission('procurement-tracker', 'view')

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ hidden: [] })

  const { data, error } = await supabase
    .from('procurement_user_project_visibility')
    .select('project_name')
    .eq('user_id', user.id)

  if (error) {
    console.error('[procurement] my-hidden-projects fetch failed:', error)
    return NextResponse.json({ hidden: [] })
  }

  return NextResponse.json({
    hidden: (data ?? []).map(r => r.project_name as string),
  })
}
