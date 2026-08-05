// Config for the daily per-project Bills digest email. Stored in app_settings
// (no migration), mirrors lib/procurement/notify-settings.ts.
//
//   bills_digest_enabled      'true' | 'false'
//   bills_digest_assignments  JSON { userId: [projectCode…] }   (Atm Head → their projects)
//   bills_digest_cc           JSON [userId…]                    (management — get every assigned project)
//
// Project codes are the billing codes used across the module (BP_CONFIG.PROJECTS).

import { BP_CONFIG } from './config'

export const BILLS_PROJECT_CODES = Object.keys(BP_CONFIG.PROJECTS) as string[]

export interface BillsDigestConfig {
  enabled: boolean
  assignments: Record<string, string[]>  // userId -> project codes
  cc: string[]                            // management userIds
  stages: Record<string, string[]>        // userId -> internal stages to include (empty/absent → default: Site Head only)
}

/** A recipient with no explicit stage picks defaults to the Site-Head desk only.
 *  Matched by substring so it survives a stage rename in the Zoho blueprint. */
export function stageAllowed(status: string, picked: string[] | undefined): boolean {
  if (picked && picked.length) return picked.includes(status)
  return /site\s*head/i.test(status || '')
}

function parseJson<T>(v: string | undefined, fallback: T): T {
  if (!v) return fallback
  try { return JSON.parse(v) as T } catch { return fallback }
}

export function parseBillsDigestConfig(rows: Array<{ key: string; value: string }>): BillsDigestConfig {
  const map = new Map(rows.map(r => [r.key, r.value]))
  const rawAssign = parseJson<Record<string, string[]>>(map.get('bills_digest_assignments'), {})
  // Keep only known project codes, drop empties.
  const assignments: Record<string, string[]> = {}
  for (const [uid, codes] of Object.entries(rawAssign)) {
    const clean = (Array.isArray(codes) ? codes : []).filter(c => BILLS_PROJECT_CODES.includes(c))
    if (clean.length) assignments[uid] = clean
  }
  const rawStages = parseJson<Record<string, string[]>>(map.get('bills_digest_stages'), {})
  const stages: Record<string, string[]> = {}
  for (const [uid, list] of Object.entries(rawStages)) {
    const clean = (Array.isArray(list) ? list : []).filter(s => typeof s === 'string' && s)
    if (clean.length) stages[uid] = clean
  }
  return {
    enabled: (map.get('bills_digest_enabled') ?? 'false').toLowerCase() === 'true',
    assignments,
    cc: (parseJson<string[]>(map.get('bills_digest_cc'), []) || []).filter(Boolean),
    stages,
  }
}
