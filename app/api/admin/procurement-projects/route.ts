// Admin-side API for the /admin/procurement-projects page.
//
//   GET  → snapshot of the full state: known project names + every
//          (user × project) hidden row. Used by the page on load.
//   POST → toggle a single (userId, projectName) hidden state.
//          Body: { userId, projectName, hidden }   (boolean)
//
// All operations are gated by the table's RLS (role = 'admin'). We
// still call requirePermission here so the page route guard is
// consistent with the API route guard, but the DB rules are the
// real backstop.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getMyProfile } from '@/lib/auth'

export const runtime = 'nodejs'

async function requireAdmin() {
  const profile = await getMyProfile()
  if (!profile || profile.role !== 'admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 })
  }
  return null
}

export async function GET() {
  const guard = await requireAdmin()
  if (guard) return guard

  const supabase = await createClient()
  const [
    { data: known },
    { data: users },
    { data: hidden },
  ] = await Promise.all([
    supabase
      .from('procurement_known_projects')
      .select('name, last_seen_at')
      .order('name', { ascending: true }),
    supabase
      .from('profiles')
      .select('id, full_name, email, role, is_active')
      .eq('is_active', true)
      .order('full_name', { ascending: true }),
    supabase
      .from('procurement_user_project_visibility')
      .select('user_id, project_name'),
  ])

  return NextResponse.json({
    knownProjects: (known ?? []).map(r => ({ name: r.name as string, lastSeenAt: r.last_seen_at as string })),
    users: users ?? [],
    hiddenRows: hidden ?? [],
  })
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin()
  if (guard) return guard

  const body = await req.json().catch(() => null)
  if (!body || typeof body.userId !== 'string' || typeof body.projectName !== 'string' || typeof body.hidden !== 'boolean') {
    return NextResponse.json(
      { error: 'Expected { userId: string, projectName: string, hidden: boolean }' },
      { status: 400 },
    )
  }
  const { userId, projectName, hidden } = body

  const supabase = await createClient()
  if (hidden) {
    // Add the hide row (idempotent — primary key conflict = already hidden).
    const { error } = await supabase
      .from('procurement_user_project_visibility')
      .upsert(
        { user_id: userId, project_name: projectName },
        { onConflict: 'user_id,project_name' },
      )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    // Remove the hide row → project becomes visible again.
    const { error } = await supabase
      .from('procurement_user_project_visibility')
      .delete()
      .eq('user_id', userId)
      .eq('project_name', projectName)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
