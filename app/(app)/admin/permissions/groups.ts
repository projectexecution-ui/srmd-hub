import type { ComponentType } from 'react'
import { MODULES, TILE_TONES } from '@/lib/modules'
import type { Role } from '@/lib/types'

export interface ModuleRef { slug: string; label: string }

// Professional grouping so a long module list scans in sections. Any slug not
// listed here lands in "Other" — nothing is ever hidden. Shared by both the
// access and delete matrices so they stay identical.
export const MODULE_GROUPS: { title: string; slugs: string[] }[] = [
  { title: 'Inbox & approvals', slugs: ['approvals', 'ecc'] },
  { title: 'Procurement', slugs: ['indents', 'pos', 'grns', 'invoices', 'payments', 'vendors', 'procurement-tracker', 'comparison', 'established-rates'] },
  { title: 'Cost & bills', slugs: ['cost-control', 'budget-vs-actual', 'budget-vs-actual-v2', 'bills-pipeline', 'stuck-bills', 'contractor-report', 'supplier-report'] },
  { title: 'Site & field', slugs: ['schedule', 'daily-site-report', 'jmr', 'inventory', 'projects', 'attendance'] },
  { title: 'Data & tools', slugs: ['uploads', 'blueprint-demo'] },
  { title: 'Admin', slugs: ['admin-users', 'admin-settings', 'admin-permissions'] },
]

export function groupModules(modules: ModuleRef[]): { title: string; mods: ModuleRef[] }[] {
  const bySlug = new Map(modules.map(m => [m.slug, m]))
  const used = new Set<string>()
  const out: { title: string; mods: ModuleRef[] }[] = []
  for (const g of MODULE_GROUPS) {
    const mods = g.slugs.map(s => bySlug.get(s)).filter(Boolean) as ModuleRef[]
    mods.forEach(m => used.add(m.slug))
    if (mods.length) out.push({ title: g.title, mods })
  }
  const others = modules.filter(m => !used.has(m.slug))
  if (others.length) out.push({ title: 'Other', mods: others })
  return out
}

export const moduleMetaMap = new Map<string, { icon: ComponentType<{ className?: string }>; tone: keyof typeof TILE_TONES }>(
  MODULES.map(m => [m.slug, { icon: m.icon, tone: m.tone }]),
)

// ── Role categories — help an admin set up permissions by grouping roles by
// what they are (leadership vs office vs site) instead of a flat list. Keyed by
// the role enum value; a newly-added role lands in "Other".
export const ROLE_GROUPS: { title: string; roles: string[] }[] = [
  { title: 'Leadership & approvers', roles: ['admin', 'founder', 'head', 'project_head', 'hop'] },
  { title: 'Office & coordination', roles: ['backoffice', 'backoffice_backup', 'contractor', 'coordinator', 'billing', 'uploader'] },
  { title: 'Site & store', roles: ['engineer', 'site_staff', 'store_manager'] },
  { title: 'Read-only', roles: ['viewer'] },
]

export function groupRoles(roles: readonly Role[]): { title: string; roles: Role[] }[] {
  const present = new Set(roles as string[])
  const used = new Set<string>()
  const out: { title: string; roles: Role[] }[] = []
  for (const g of ROLE_GROUPS) {
    const rs = g.roles.filter(r => present.has(r)) as Role[]
    rs.forEach(r => used.add(r as string))
    if (rs.length) out.push({ title: g.title, roles: rs })
  }
  const others = (roles as Role[]).filter(r => !used.has(r as string))
  if (others.length) out.push({ title: 'Other', roles: others })
  return out
}

// Sort roles into category order so the matrix columns cluster by category too.
const roleOrder = new Map<string, number>()
ROLE_GROUPS.forEach((g, gi) => g.roles.forEach((r, ri) => roleOrder.set(r, gi * 100 + ri)))
export function sortRolesByCategory(roles: Role[]): Role[] {
  return [...roles].sort((a, b) => (roleOrder.get(a as string) ?? 9_999) - (roleOrder.get(b as string) ?? 9_999))
}
