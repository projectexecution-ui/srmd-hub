// What the workspace header shows (build order §1): project name, then grey
// meta — workspace · trust · sub-projects · sft — with the IN4 sync stamp and
// an unread count on the right.
//
// §10 applies to the header too: every field here is something IN4 or CT Hub
// actually holds. Where a value is missing it comes back null and the header
// leaves the chip out rather than inventing one — the trust in particular is
// read from IN4's own certifying company, never guessed from the project name.

import { createClient } from '@/lib/supabase/server'
import { getMyUser } from '@/lib/auth-user'

export interface WorkspaceHeader {
  id: string
  code: string | null
  name: string
  /** The CT Hub group this project sits under, when it has one. */
  parentName: string | null
  builtUpSft: number | null
  /** IN4's certifying company for this project — the trust. Null when the
   *  project is not linked to an IN4 sub-project yet. */
  trustCode: string | null
  trustName: string | null
  /** CT Hub child projects. Null when this project has none, so the header
   *  omits the chip instead of announcing "0 sub-projects". */
  subProjectCount: number | null
  /** Last successful IN4 mirror sync, ISO. Null when the mirror has never run. */
  syncedAt: string | null
  /** Unread notifications pointing at this project. */
  unread: number
}

/**
 * The trust chain, which is worth stating because it is four hops and none of
 * them is a name match:
 *
 *   projects → cc_bph_project_links → in4_subproject_links → in4_subprojects
 *   → in4_projects.cert_company_id → in4_companies
 *
 * Both link tables are human-confirmed mappings, so a project shows its trust
 * only when somebody has actually confirmed which IN4 sub-project it is. That
 * is the right failure: a wrong trust on a work order is worse than a blank.
 */
export async function loadWorkspaceHeader(projectId: string): Promise<WorkspaceHeader | null> {
  const supabase = await createClient()

  const { data: project, error } = await supabase
    .from('projects')
    .select('id, code, name, built_up_sft, parent_project_id')
    .eq('id', projectId)
    .maybeSingle()
  if (error || !project) return null

  const [parentRes, childRes, linkRes, syncRes, user] = await Promise.all([
    project.parent_project_id
      ? supabase.from('projects').select('name').eq('id', project.parent_project_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from('projects').select('id', { count: 'exact', head: true })
      .eq('parent_project_id', projectId).is('archived_at', null),
    supabase.from('cc_bph_project_links').select('bph_project_id').eq('cc_project_id', projectId),
    supabase.from('in4_sync_runs').select('finished_at').eq('ok', true)
      .not('finished_at', 'is', null).order('finished_at', { ascending: false }).limit(1).maybeSingle(),
    getMyUser(),
  ])

  let trustCode: string | null = null
  let trustName: string | null = null
  const bphIds = (linkRes.data ?? []).map(r => r.bph_project_id as string).filter(Boolean)
  if (bphIds.length > 0) {
    const { data: subLinks } = await supabase
      .from('in4_subproject_links').select('subproject_id').in('bph_project_id', bphIds)
    const subIds = (subLinks ?? []).map(r => r.subproject_id as number)
    if (subIds.length > 0) {
      const { data: subs } = await supabase
        .from('in4_subprojects').select('project_id').in('id', subIds).limit(1)
      const in4ProjectId = subs?.[0]?.project_id as number | undefined
      if (in4ProjectId != null) {
        const { data: ip } = await supabase
          .from('in4_projects').select('cert_company_id').eq('id', in4ProjectId).maybeSingle()
        const companyId = ip?.cert_company_id as number | null | undefined
        if (companyId != null) {
          const { data: co } = await supabase
            .from('in4_companies').select('code, name').eq('id', companyId).maybeSingle()
          trustCode = (co?.code as string | null) ?? null
          trustName = (co?.name as string | null) ?? null
        }
      }
    }
  }

  // Unread notifications for this person that point at this project. The
  // notifications table has no project column, so the project id in the URL is
  // the only link there is — an under-count is possible, never an over-count.
  let unread = 0
  if (user) {
    const { count } = await supabase
      .from('notifications').select('id', { count: 'exact', head: true })
      .eq('user_id', user.id).eq('is_read', false).like('url', `%${projectId}%`)
    unread = count ?? 0
  }

  const childCount = childRes.count ?? 0

  return {
    id: project.id as string,
    code: (project.code as string | null) ?? null,
    name: project.name as string,
    parentName: (parentRes.data?.name as string | null) ?? null,
    builtUpSft: project.built_up_sft != null ? Number(project.built_up_sft) : null,
    trustCode,
    trustName,
    subProjectCount: childCount > 0 ? childCount : null,
    syncedAt: (syncRes.data?.finished_at as string | null) ?? null,
    unread,
  }
}
