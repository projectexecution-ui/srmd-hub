import type { ComponentType } from 'react'
import { MODULES, TILE_TONES } from '@/lib/modules'

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
