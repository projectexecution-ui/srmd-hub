/** The four "who may" lists behind Admin → People → Powers. Each is a comma-separated list of user ids in app_settings. */
export const GRANT_KEYS = {
  accounts: 'cc_accounts_users',
  archive: 'cc_archive_users',
  rename: 'cthub_namers',
  manual_upload: 'in4_manual_upload_users',
} as const
export type GrantKey = keyof typeof GRANT_KEYS
export type Result = { ok: boolean; message?: string }
