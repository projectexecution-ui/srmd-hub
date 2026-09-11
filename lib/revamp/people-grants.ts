/** The four "who may" lists behind Admin → People → Powers. Each is a comma-separated list of user ids in app_settings. */
export const GRANT_KEYS = {
  accounts: 'cc_accounts_users',
  archive: 'cc_archive_users',
  rename: 'cthub_namers',
  manual_upload: 'in4_manual_upload_users',
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
