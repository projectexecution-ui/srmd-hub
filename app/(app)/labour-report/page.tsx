// Labour Report — the daily manpower count per agency on a site.
//
// Aksha, 23 Sep 2026: in place of the Excel "DAILY LABOUR REPORT" and the small
// "SRAH DAILY MANPOWER" form. The site engineer (Vatsal on SRAH) types today's
// count per agency; the month sheet, its graph and the WhatsApp card read it.
//
// Gate: the permission matrix, slug 'labour-report' (view reads, edit types),
// plus the Portal Owner's module switch — requirePermission checks both.

import { requirePermission, can, getMyProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { todayIST } from '@/lib/utils'
import { LabourReportClient, type LabourAgency, type LabourEntry, type LabourProject } from './LabourReportClient'

export const dynamic = 'force-dynamic'

export default async function LabourReportPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const perms = await requirePermission('labour-report', 'view')
  const canEdit = can(perms, 'labour-report', 'edit')
  const [sp, profile, supabase] = await Promise.all([searchParams, getMyProfile(), createClient()])
  const today = todayIST()

  // Every live project is offered; the ones that already have an agency list
  // come first so the picker opens on a site that is actually being counted.
  const [{ data: projectRows }, { data: counted }] = await Promise.all([
    // Groups (NGH, P2, RU…) are headings, not sites — nobody counts labour on
    // a heading. `.or` rather than `.neq` so a null project_type still shows.
    supabase.from('projects').select('id, code, name, project_type').is('archived_at', null).or('project_type.is.null,project_type.neq.group').order('code'),
    supabase.from('labour_agencies').select('project_id'),
  ])
  const countedIds = new Set(((counted ?? []) as { project_id: string }[]).map(r => r.project_id))
  const projects: LabourProject[] = ((projectRows ?? []) as { id: string; code: string; name: string }[])
    .map(p => ({ id: p.id, code: p.code, name: p.name, counted: countedIds.has(p.id) }))
    .sort((a, b) => Number(b.counted) - Number(a.counted) || a.code.localeCompare(b.code))

  const projectId = sp.project && projects.some(p => p.id === sp.project) ? sp.project : (projects[0]?.id ?? null)

  // This month and the one before — the sheet is a month, the prefill needs
  // only the last saved day, and two months keep the payload small.
  const since = (() => { const [y, m] = today.split('-').map(Number); const d = new Date(Date.UTC(y, m - 2, 1)); return d.toISOString().slice(0, 10) })()
  const [{ data: agencyRows }, { data: entryRows }] = projectId
    ? await Promise.all([
        supabase.from('labour_agencies').select('id, name, sub_heads, sort_order, hidden').eq('project_id', projectId).order('sort_order'),
        supabase.from('labour_entries').select('report_date, agency_id, sub_head, count, updated_at').eq('project_id', projectId).gte('report_date', since).order('report_date'),
      ])
    : [{ data: [] }, { data: [] }]

  return (
    <LabourReportClient
      projects={projects}
      projectId={projectId}
      agencies={(agencyRows ?? []) as LabourAgency[]}
      entries={(entryRows ?? []) as LabourEntry[]}
      canEdit={canEdit}
      today={today}
      userId={profile?.id ?? null}
      userName={profile?.name || profile?.full_name || profile?.email || ''}
    />
  )
}
