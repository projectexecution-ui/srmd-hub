import { createClient } from '@/lib/supabase/server'
import { getMyProfile, getMyPermissions, can, isPortalOwner } from '@/lib/auth'
import { loadDecisions, loadStakeholders } from '@/lib/site-register/queries'
import { DecisionsClient } from './DecisionsClient'

/**
 * Decisions & Specifications.
 *
 * The tree IS the budget's category → sub-category list for this project, so a
 * specification sits exactly where its money sits and there is no second
 * structure to keep up to date. Most sub-categories need no decision at all,
 * which is why applicability is a deliberate tick — and, because it is
 * configuration rather than reading, it lives behind one button.
 */
export async function DecisionsTab({ projectId, view = 0 }: { projectId: string; view?: number }) {
  const sb = await createClient()
  const [cats, stake, profile, owner, perms, { data: users }, { data: projects }] = await Promise.all([
    loadDecisions(projectId),
    loadStakeholders(projectId),
    getMyProfile(),
    isPortalOwner(),
    getMyPermissions(),
    sb.from('profiles').select('id, full_name, name, email').eq('is_active', true).order('full_name'),
    sb.from('projects').select('id, name, short_name, code').is('archived_at', null).order('name'),
  ])

  const canConfigure = owner || ['admin', 'head', 'founder', 'project_head'].includes(profile?.role ?? '')
  const canRecord = can(perms, 'cost-control', 'edit')

  type Row = Record<string, unknown>
  return (
    <DecisionsClient
      projectId={projectId}
      projectName={stake.projectName}
      categories={cats}
      flat={view === 1}
      canConfigure={canConfigure}
      canRecord={canRecord}
      disciplines={stake.enabled.map(d => ({ id: d.id, name: d.name }))}
      users={((users ?? []) as Row[]).map(u => ({
        id: u.id as string,
        name: (u.full_name as string) || (u.name as string) || (u.email as string) || 'Someone',
      }))}
      otherProjects={((projects ?? []) as Row[])
        .filter(p => p.id !== projectId)
        .map(p => ({ id: p.id as string, name: (p.short_name as string) || (p.name as string) || (p.code as string) || 'Project' }))}
    />
  )
}
