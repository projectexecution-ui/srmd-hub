// What is actually WRONG in the setup right now.
//
// The old Admin was 33 links and no state: it could not tell you that 25 of 41
// projects have no area, that three have no approver, or that five warehouse
// alerts are switched off so a raised request tells nobody. You found those out
// when something failed.
//
// A check earns its place here only if it is (a) true today, (b) fixable from a
// screen we can link to, and (c) something a person would want to know without
// asking. "Interesting but not actionable" is not a check.

import { createClient } from '@/lib/supabase/server'
import { resolveRoof } from '@/lib/notifications/roof'
import { recipientSettingKeys } from '@/lib/notifications/catalog'

export type Severity = 'blocker' | 'warn' | 'info'

export interface HealthFinding {
  id: string
  severity: Severity
  /** One line, with the number in it. */
  title: string
  /** Why it matters, in the words of the consequence. */
  detail: string
  /** Where to go and fix it. */
  href: string
  fixLabel: string
}

export interface HealthInputs {
  projects: number
  projectsNoArea: number
  projectsNoApprover: number
  rolesWithPermissions: number
  rolesInUse: number
  /** Messages that deliver nothing, from the notifications roof. */
  silentMessages: Array<{ key: string; label: string; href: string }>
}

/** Pure, so every threshold and wording is testable without a database. */
export function checkHealth(i: HealthInputs): HealthFinding[] {
  const out: HealthFinding[] = []

  if (i.projectsNoApprover > 0) {
    out.push({
      id: 'projects-no-approver',
      severity: 'blocker',
      title: `${i.projectsNoApprover} project${i.projectsNoApprover === 1 ? ' has' : 's have'} no approver`,
      detail: 'A budget raised on one of these has nobody to go to, and simply sits there.',
      href: '/cost-control',
      fixLabel: 'Set approvers',
    })
  }

  if (i.silentMessages.length > 0) {
    out.push({
      id: 'silent-messages',
      severity: 'blocker',
      title: i.silentMessages.length === 1
        ? '1 alert reaches nobody'
        : `${i.silentMessages.length} alerts reach nobody`,
      detail: `Switched on but delivering nothing — ${i.silentMessages.slice(0, 3).map(m => m.label).join(', ')}`
        + (i.silentMessages.length > 3 ? ` and ${i.silentMessages.length - 3} more.` : '.'),
      href: '/admin/email',
      fixLabel: 'See which',
    })
  }

  if (i.projectsNoArea > 0) {
    const pct = Math.round((i.projectsNoArea / Math.max(1, i.projects)) * 100)
    out.push({
      id: 'projects-no-area',
      severity: 'warn',
      title: `${i.projectsNoArea} of ${i.projects} projects have no area set`,
      detail: `Every ₹/sft figure is blank on ${pct}% of the portfolio, so budgets cannot be compared building to building.`,
      href: '/cost-control',
      fixLabel: 'Add areas',
    })
  }

  const unused = i.rolesWithPermissions - i.rolesInUse
  if (unused > 0) {
    out.push({
      id: 'unused-roles',
      severity: 'info',
      title: `${unused} roles are set up but nobody holds them`,
      detail: `The permission grid carries ${i.rolesWithPermissions} roles; only ${i.rolesInUse} are in use. The rest make the grid harder to read than it needs to be.`,
      href: '/admin/permissions',
      fixLabel: 'Review roles',
    })
  }

  const order: Record<Severity, number> = { blocker: 0, warn: 1, info: 2 }
  return out.sort((a, b) => order[a.severity] - order[b.severity])
}

export async function loadHealth(): Promise<HealthFinding[]> {
  const supabase = await createClient()

  const [projRes, apprRes, permRes, profRes, settingsRes, rulesRes] = await Promise.all([
    supabase.from('projects').select('id, built_up_sft').is('archived_at', null),
    supabase.from('cc_project_approvers').select('project_id'),
    supabase.from('role_permissions').select('role'),
    supabase.from('profiles').select('id, role, full_name').eq('is_active', true),
    supabase.from('app_settings').select('key, value').in('key', recipientSettingKeys()),
    supabase.from('notification_rules').select('event_type, channel, enabled').eq('scope', 'global'),
  ])

  const projects = (projRes.data ?? []) as Array<{ id: string; built_up_sft: number | null }>
  const withApprover = new Set(
    ((apprRes.data ?? []) as Array<{ project_id: string }>).map(r => r.project_id),
  )
  const profiles = (profRes.data ?? []) as Array<{ id: string; role: string; full_name: string | null }>

  const roof = resolveRoof({
    settings: new Map(
      ((settingsRes.data ?? []) as Array<{ key: string; value: string }>).map(r => [r.key, r.value]),
    ),
    rules: (rulesRes.data ?? []) as Array<{ event_type: string; channel: string; enabled: boolean }>,
    names: new Map(profiles.map(p => [p.id, p.full_name ?? 'Unnamed'])),
  })

  return checkHealth({
    projects: projects.length,
    projectsNoArea: projects.filter(p => !p.built_up_sft).length,
    projectsNoApprover: projects.filter(p => !withApprover.has(p.id)).length,
    rolesWithPermissions: new Set(((permRes.data ?? []) as Array<{ role: string }>).map(r => r.role)).size,
    rolesInUse: new Set(profiles.map(p => p.role)).size,
    silentMessages: roof.rows
      .filter(r => r.warning)
      .map(r => ({ key: r.message.key, label: r.message.label, href: r.message.settingsHref })),
  })
}
