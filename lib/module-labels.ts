// Display labels for each module slug. Mirrors lib/role-labels.ts —
// MODULES in lib/modules.ts is the immutable registry; this file lets
// Portal Owner / admin override the user-facing label + description
// without a code change. Inline rename lives on /admin/dashboard-modules.

import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { MODULES } from '@/lib/modules'
import { getShell } from '@/lib/shell'

export interface ModuleLabel { label: string; description: string }
export type ModuleLabelMap = Record<string, ModuleLabel>

/** Defaults sourced from MODULES — used whenever an override row is missing. */
export const DEFAULT_MODULE_LABELS: ModuleLabelMap = Object.fromEntries(
  MODULES.map(m => [m.slug, { label: m.label, description: m.description }]),
)

/**
 * Cached server fetch of the module-label map. Falls back to MODULES defaults
 * whenever the table is empty / unreachable so the UI never renders blank.
 *
 * Use this in server components and pass the result down to clients that
 * render module labels (NavBar, TileLauncher, admin matrices, etc.).
 */
export const getModuleLabels = cache(async (): Promise<ModuleLabelMap> => {
  try {
    const shell = await getShell()
    if (shell) return shell.labels
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('module_labels')
      .select('slug, label, description')
    if (error || !data) return DEFAULT_MODULE_LABELS

    const out: ModuleLabelMap = { ...DEFAULT_MODULE_LABELS }
    for (const row of data as Array<{ slug: string; label: string; description: string | null }>) {
      const def = DEFAULT_MODULE_LABELS[row.slug]
      out[row.slug] = {
        label: row.label,
        description: row.description ?? def?.description ?? '',
      }
    }
    return out
  } catch {
    return DEFAULT_MODULE_LABELS
  }
})

/**
 * Pure helper for components that already have the labels map in hand.
 * Returns the override label if set, otherwise the MODULES default,
 * otherwise the slug itself (last-resort fallback).
 */
export function labelFor(labels: ModuleLabelMap, slug: string): string {
  return labels[slug]?.label ?? DEFAULT_MODULE_LABELS[slug]?.label ?? slug
}
export function descriptionFor(labels: ModuleLabelMap, slug: string): string {
  return labels[slug]?.description ?? DEFAULT_MODULE_LABELS[slug]?.description ?? ''
}
