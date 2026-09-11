// One loader for the People screen and the Projects screen: both are views of
// the same rows (a person, a project, one capability), so they read the same data.

import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { getRoleLabels } from '@/lib/role-labels'
import { BILLS_PROJECT_CODES } from '@/lib/bills-pipeline/digest-settings'
import { billsProjectLabels } from '@/lib/bills-pipeline/project-names'
import { GRANT_KEYS } from '@/lib/revamp/people-grants'
import type { Person, ProjectRow, PeopleData } from './PeopleClient'

export async function loadPeopleData(): Promise<PeopleData> {
  const supabase = await createClient()
  const svcUrl = process.env.NEXT_PUBLIC_SUPABASE_URL, svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const svc = svcUrl && svcKey ? createServiceClient(svcUrl, svcKey, { auth: { persistSession: false } }) : null

  const grantKeys = Object.values(GRANT_KEYS) as string[]
  const [usersRes, overridesRes, projectsRes, approversRes, assignRes, hiddenRes, knownRes, in4Res, settingsRes, prefsRes, roleLabels, billsLabels] = await Promise.all([
    supabase.from('profiles').select('id, full_name, email, role').eq('is_active', true).order('role').order('full_name'),
    supabase.from('user_module_roles').select('user_id, role').eq('module_slug', 'cost-control'),
    supabase.from('projects').select('id, code, name, short_name, parent_project_id').is('archived_at', null).order('code'),
    supabase.from('cc_project_approvers').select('project_id, user_id, role'),
    supabase.from('project_assignments').select('user_id, project_id'),
    supabase.from('procurement_user_project_visibility').select('user_id, project_name'),
    supabase.from('procurement_known_projects').select('name'),
    supabase.from('in4_projects').select('name'),
    supabase.from('app_settings').select('key, value').in('key', [...grantKeys, 'bills_digest_assignments']),
    svc ? svc.from('notification_preferences').select('user_id, in_app, email, web_push, telegram, telegram_chat_id') : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    getRoleLabels(),
    billsProjectLabels(supabase),
  ])

  const labelOf = roleLabels as Record<string, { label?: string } | undefined>
  const overrides = new Map(((overridesRes.data ?? []) as Array<{ user_id: string; role: string }>).map(r => [r.user_id, r.role]))
  const people: Person[] = ((usersRes.data ?? []) as Array<{ id: string; full_name: string | null; email: string | null; role: string }>).map(u => ({
    id: u.id,
    name: u.full_name?.trim() || u.email || 'Unnamed',
    email: u.email ?? '',
    role: u.role,
    roleLabel: labelOf[u.role]?.label ?? u.role,
    ccRole: overrides.get(u.id) ?? u.role,
  }))

  const rawProjects = (projectsRes.data ?? []) as Array<{ id: string; code: string | null; name: string; short_name: string | null; parent_project_id: string | null }>
  const parentIds = new Set(rawProjects.map(p => p.parent_project_id).filter(Boolean) as string[])
  const projects: ProjectRow[] = rawProjects.map(p => ({
    id: p.id, label: p.short_name?.trim() || p.code || p.name, name: p.name, code: p.code ?? '', shortName: p.short_name?.trim() ?? '', isGroup: parentIds.has(p.id),
  }))

  const settings = new Map(((settingsRes.data ?? []) as Array<{ key: string; value: string }>).map(r => [r.key, r.value]))
  const idsIn = (key: string) => (settings.get(key) ?? '').match(/[0-9a-f-]{36}/gi) ?? []
  let bills: Record<string, string[]> = {}
  try { const p = JSON.parse(settings.get('bills_digest_assignments') ?? '{}'); if (p && typeof p === 'object' && !Array.isArray(p)) bills = p } catch { /* none */ }

  const indentProjects = [...new Set([
    ...((knownRes.data ?? []) as Array<{ name: string }>).map(r => r.name),
    ...((in4Res.data ?? []) as Array<{ name: string | null }>).map(r => (r.name ?? '').trim()),
  ].filter(Boolean))].sort((a, b) => a.localeCompare(b))

  return {
    people,
    projects,
    roles: Object.keys(roleLabels).map(key => ({ key, label: labelOf[key]?.label ?? key })),
    grants: {
      accounts: idsIn(GRANT_KEYS.accounts),
      archive: idsIn(GRANT_KEYS.archive),
      rename: idsIn(GRANT_KEYS.rename),
      manual_upload: idsIn(GRANT_KEYS.manual_upload),
    },
    approvers: (approversRes.data ?? []) as Array<{ project_id: string; user_id: string; role: string }>,
    assignments: (assignRes.data ?? []) as Array<{ user_id: string; project_id: string }>,
    hiddenIndents: (hiddenRes.data ?? []) as Array<{ user_id: string; project_name: string }>,
    indentProjects,
    billsCodes: BILLS_PROJECT_CODES.map(code => ({ code, label: billsLabels.get(code)?.label ?? code })),
    billsAssignments: bills,
    prefs: ((prefsRes.data ?? []) as Array<{ user_id: string; in_app: boolean | null; email: boolean | null; web_push: boolean | null; telegram: boolean | null; telegram_chat_id: string | null }>)
      .map(p => ({ userId: p.user_id, in_app: p.in_app ?? true, email: p.email ?? true, web_push: p.web_push ?? false, telegramLinked: !!p.telegram && !!p.telegram_chat_id })),
    prefsAvailable: !!svc,
  }
}
