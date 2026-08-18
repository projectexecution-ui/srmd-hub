// Display labels for each user_role. The underlying enum values are fixed in
// the database; what changes here is just what they're CALLED in the UI.
// Portal Owners edit these via /admin/permissions (column headers).

import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import type { Role } from '@/lib/types'

export interface RoleLabel {
  label: string
  description: string
}

export type RoleLabelMap = Record<Role, RoleLabel>

// Fallback labels — used if the role_labels table is empty / unreachable.
// Keep these in sync with the seed in 20260523_role_labels migration so the
// UI looks identical when the table is freshly seeded.
export const DEFAULT_ROLE_LABELS: RoleLabelMap = {
  admin:              { label: 'Admin',              description: 'Super-user. Manages users + permissions + settings.' },
  founder:            { label: 'Founder',            description: 'Top org level / Trustee. Final release on Cost Control working sheets.' },
  head:               { label: 'Head (Atm Head)',    description: 'PM / dept head. Atm Head — 2nd sign-off on Cost Control sheets, final approval on inventory.' },
  project_head:       { label: 'Project Head',       description: 'First sign-off on Cost Control working sheets. Chain: Project Head → Atm Head → Trustee.' },
  uploader:           { label: 'Uploader',           description: 'Edits operational data (vendors, indents, POs).' },
  engineer:           { label: 'Engineer',           description: 'Site engineer. Raises inventory + indents; confirms receipt of issued material.' },
  site_staff:         { label: 'Site Staff',         description: 'Labour / on-site. Attendance + view JMR.' },
  viewer:             { label: 'Viewer',             description: 'Read-only — can browse but cannot edit.' },
  contractor:         { label: 'Contractor',         description: 'External contractor. Sees only own JMR entries + bills.' },
  backoffice:         { label: 'Backoffice',         description: 'Inventory: marks requests "available", reserves stock. Pairs with Storekeeper.' },
  store_manager:      { label: 'Storekeeper',        description: 'Inventory: warehouse staff. Marks "available", issues material, logs receipts + damage.' },
  security:           { label: 'Security (Gate)',     description: 'Gate guard. Records material arriving and leaving at the barrier. Sees quantities only — no rate, no value, anywhere in the module.' },
  billing:            { label: 'Billing (IN4 Entry)', description: 'Enters approved Working Sheet amounts into the IN4 ERP. Sees the Cost Control billing queue; cannot edit or approve sheets.' },
  coordinator:        { label: 'Coordinator (setup)',  description: 'Cost Control setup & data — create projects, manage disciplines, sync BPH, full visibility. Cannot approve or release money.' },
  // Below: kept in DB enum + type for backward compat, but not surfaced in
  // /admin/permissions matrix. Use `head` instead of `hop`. No backup role
  // — the storekeeper covers when backoffice is unavailable.
  backoffice_backup:  { label: 'Backoffice Backup (legacy)', description: 'Legacy — superseded by Storekeeper covering for Backoffice.' },
  hop:                { label: 'HoP (legacy)',               description: 'Legacy — use Head (Atm Head) instead.' },
}

/**
 * Cached server-side fetch of the role labels map. Falls back to defaults if
 * the table is empty or unreachable so the UI never renders blank columns.
 */
export const getRoleLabels = cache(async (): Promise<RoleLabelMap> => {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('role_labels')
      .select('role, label, description')
    if (error || !data) return DEFAULT_ROLE_LABELS

    const out: RoleLabelMap = { ...DEFAULT_ROLE_LABELS }
    for (const row of data as Array<{ role: Role; label: string; description: string | null }>) {
      out[row.role] = {
        label: row.label,
        description: row.description ?? DEFAULT_ROLE_LABELS[row.role]?.description ?? '',
      }
    }
    return out
  } catch {
    return DEFAULT_ROLE_LABELS
  }
})
