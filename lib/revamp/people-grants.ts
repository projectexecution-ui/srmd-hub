/** The "who may" lists behind Admin → People → Powers. Each is a comma-separated list of user ids in app_settings.
 *  Since 23 Sep 2026 this is the ONLY place the first two are edited — Internal
 *  Estimate settings used to carry the same two lists (F5). */
export const GRANT_KEYS = {
  accounts: 'cc_accounts_users',
  archive: 'cc_archive_users',
  rename: 'cthub_namers',
  manual_upload: 'in4_manual_upload_users',
  /** May bring IN4 projects into the hub from Data › From IN4 (N1 / NS4 — "admin and Parimal"). */
  intake: 'in4_intake_users',
} as const
export type GrantKey = keyof typeof GRANT_KEYS
export type Result = { ok: boolean; message?: string }

/**
 * The IN4 indent name a CT Hub project goes by, if IN4 has one. Matched on the
 * project's name, short name or code (case-insensitive) — the same text match
 * the tracker uses, which is why a renamed project can lose its indents.
 */
export function indentNameFor(project: { name: string; shortName: string; code: string }, indentProjects: string[]): string | null {
  const norm = (s: string) => s.trim().toLowerCase()
  const wanted = new Set([project.name, project.shortName, project.code].filter(Boolean).map(norm))
  return indentProjects.find(n => wanted.has(norm(n))) ?? null
}
