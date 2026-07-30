import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { ALL_ROLES, type Role } from '@/lib/types'

/**
 * Which roles count as "Management" and which as "Engineer" — the admin
 * decides at /admin/users. Drives the badges + grouping there and who is
 * offered in the project-setup engineer picker.
 *
 * NOTE: who may approve / see confidential figures stays governed by the
 * Approvals matrix (approval_rules → checkIsCcReviewer). This mapping is the
 * labelling + picker layer on top; the admin UI warns when the two disagree.
 */
export interface RoleSides {
  management: Role[]
  engineer: Role[]
}

export const DEFAULT_ROLE_SIDES: RoleSides = {
  management: ['admin', 'project_head', 'head', 'founder', 'coordinator'],
  engineer: ['engineer'],
}

/** Pure parser — exported for unit tests. Missing key → default side;
 *  present-but-empty → explicitly none. Admin is ALWAYS management, and a
 *  role can never sit on both sides (management wins). */
export function parseRoleSides(map: Record<string, string | undefined>): RoleSides {
  const csv = (v: string) =>
    v.split(',').map(s => s.trim()).filter((s): s is Role => (ALL_ROLES as string[]).includes(s))
  const management =
    map['roles_management'] != null ? csv(map['roles_management']) : [...DEFAULT_ROLE_SIDES.management]
  if (!management.includes('admin')) management.unshift('admin')
  const engineerRaw =
    map['roles_engineer'] != null ? csv(map['roles_engineer']) : [...DEFAULT_ROLE_SIDES.engineer]
  const engineer = engineerRaw.filter(r => !management.includes(r))
  return { management, engineer }
}

/** Cached per-request server reader. */
export const getRoleSides = cache(async (): Promise<RoleSides> => {
  const supabase = await createClient()
  const { data } = await supabase
    .from('app_settings')
    .select('key, value')
    .in('key', ['roles_management', 'roles_engineer'])
  const map: Record<string, string> = {}
  for (const r of data ?? []) map[r.key as string] = (r.value as string) ?? ''
  return parseRoleSides(map)
})
