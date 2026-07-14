// Admin project picker for the Bills Pipeline.
//   GET  — list every billing project in the Zoho portal + which are selected.
//   POST — save the selected set to app_settings['bills_pipeline_projects'].

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient, type SupabaseClient } from '@supabase/supabase-js'
import { getMyPermissions, can } from '@/lib/auth'
import { getZohoToken, fetchBillingProjects } from '@/lib/bills-pipeline/zoho'
import { getSelectedProjects, codeForProject, PROJECTS_KEY, type BpProject } from '@/lib/bills-pipeline/projects'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function serviceClient(): SupabaseClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')
  return createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, { auth: { persistSession: false } })
}

export async function GET() {
  const perms = await getMyPermissions()
  if (!can(perms, 'bills-pipeline', 'admin')) {
    return NextResponse.json({ ok: false, reason: 'Forbidden — bills-pipeline admin required' }, { status: 403 })
  }

  let supabase: SupabaseClient
  try { supabase = serviceClient() } catch (e) {
    return NextResponse.json({ ok: false, reason: e instanceof Error ? e.message : 'init failed' }, { status: 503 })
  }

  let token: string
  try { token = await getZohoToken(supabase) } catch (e) {
    return NextResponse.json({ ok: false, reason: e instanceof Error ? e.message : 'Zoho not connected' }, { status: 503 })
  }

  let available: BpProject[]
  try {
    const raw = await fetchBillingProjects(token)
    available = raw.map(p => ({ code: codeForProject(p.id, p.name), id: p.id, name: p.name }))
  } catch (e) {
    return NextResponse.json({ ok: false, reason: e instanceof Error ? e.message : 'Could not list projects' }, { status: 502 })
  }

  const selected = await getSelectedProjects(supabase)
  return NextResponse.json({ ok: true, available, selectedIds: selected.map(p => p.id) })
}

export async function POST(req: NextRequest) {
  const perms = await getMyPermissions()
  if (!can(perms, 'bills-pipeline', 'admin')) {
    return NextResponse.json({ ok: false, reason: 'Forbidden — bills-pipeline admin required' }, { status: 403 })
  }

  let body: { projects?: BpProject[] }
  try { body = await req.json() } catch {
    return NextResponse.json({ ok: false, reason: 'Invalid JSON' }, { status: 400 })
  }

  const projects = (body.projects ?? [])
    .filter(p => p && typeof p.code === 'string' && typeof p.id === 'string')
    .map(p => ({ code: p.code, id: p.id, name: p.name }))

  if (projects.length === 0) {
    return NextResponse.json({ ok: false, reason: 'Select at least one project' }, { status: 400 })
  }

  let supabase: SupabaseClient
  try { supabase = serviceClient() } catch (e) {
    return NextResponse.json({ ok: false, reason: e instanceof Error ? e.message : 'init failed' }, { status: 503 })
  }

  const { error } = await supabase
    .from('app_settings')
    .upsert({ key: PROJECTS_KEY, value: JSON.stringify(projects) }, { onConflict: 'key' })

  if (error) return NextResponse.json({ ok: false, reason: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, count: projects.length })
}
