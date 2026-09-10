// HOW each recipient setting is stored — because they are not stored the same
// way, and writing the wrong shape silently breaks a live cron job.
//
// The three that hold email addresses each use a different format:
//
//   bills_worklist_to             "a@b.com, c@d.com"   comma-joined string
//   inv_daily_report_emails       "a@b.com, c@d.com"   split on [,;\s]+
//   jmr_weekly_report_recipients  ["a@b.com"]          JSON array
//
// and two more hold user IDs rather than addresses. Editing them from one
// screen is only safe if the screen writes each key back in its OWN format, so
// the module's existing settings page and the cron that reads it both keep
// working. That is what this file is for. Nothing writes an app_settings key
// without going through it.

export type RecipientFormat = 'csv' | 'json-array' | 'bool'

export interface KeySpec {
  format: RecipientFormat
  /** 'email' = the values are addresses; 'user' = they are profile ids. */
  holds: 'email' | 'user' | 'flag'
  /** Which module's own settings page also writes this key. */
  alsoWrittenBy: string
}

export const KEY_SPECS: Record<string, KeySpec> = {
  bills_worklist_to: {
    format: 'csv', holds: 'email',
    alsoWrittenBy: '/bills-pipeline/digest-settings',
  },
  inv_daily_report_emails: {
    format: 'csv', holds: 'email',
    alsoWrittenBy: '/inventory/admin/settings',
  },
  jmr_weekly_report_recipients: {
    format: 'json-array', holds: 'email',
    alsoWrittenBy: '/jmr/admin/settings',
  },
  bills_digest_cc: {
    format: 'json-array', holds: 'user',
    alsoWrittenBy: '/bills-pipeline/digest-settings',
  },
  // On/off switches, written as "true"/"false" by their own forms. The
  // inventory parser also accepts "1" and "on", but writes "true".
  bills_digest_enabled: { format: 'bool', holds: 'flag', alsoWrittenBy: '/bills-pipeline/digest-settings' },
  procurement_notify_enabled: { format: 'bool', holds: 'flag', alsoWrittenBy: '/procurement-tracker/admin' },
  inv_low_stock_alerts: { format: 'bool', holds: 'flag', alsoWrittenBy: '/inventory/admin/settings' },
  inv_daily_report: { format: 'bool', holds: 'flag', alsoWrittenBy: '/inventory/admin/settings' },
  cc_tg_trustee_digest: { format: 'bool', holds: 'flag', alsoWrittenBy: '/cost-control/settings' },
}

export function specFor(key: string): KeySpec | undefined {
  return KEY_SPECS[key]
}

/** Read a stored value into a list, whatever shape it is in. */
export function parseList(key: string, raw: string | null | undefined): string[] {
  if (raw == null || raw === '') return []
  const spec = KEY_SPECS[key]
  if (spec?.format === 'json-array') {
    try {
      const v = JSON.parse(raw)
      return Array.isArray(v) ? v.map(String).map(s => s.trim()).filter(Boolean) : []
    } catch {
      return []
    }
  }
  return raw.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean)
}

/**
 * Write a list back in the key's OWN format.
 *
 * Throws on an unknown key rather than guessing: a wrong guess here corrupts a
 * setting that a cron job reads at 09:00 tomorrow, and nobody would see it fail.
 */
export function serialiseList(key: string, values: string[]): string {
  const spec = KEY_SPECS[key]
  if (!spec) throw new Error(`No storage format recorded for "${key}" — refusing to guess.`)
  if (spec.format === 'bool') throw new Error(`"${key}" is an on/off switch, not a list.`)
  const clean = values.map(v => v.trim()).filter(Boolean)
  return spec.format === 'json-array' ? JSON.stringify(clean) : clean.join(', ')
}

export function parseFlag(raw: string | null | undefined, fallback = true): boolean {
  if (raw == null || raw === '') return fallback
  return raw === 'true' || raw === '1' || raw === 'on'
}

/** Every form in the app writes these as "true"/"false". Match that exactly. */
export function serialiseFlag(on: boolean): string {
  return String(on)
}

/** Addresses only — a list meant to hold emails must not accept anything else. */
export function validEmails(values: string[]): { ok: string[]; rejected: string[] } {
  const ok: string[] = []
  const rejected: string[] = []
  for (const v of values.map(s => s.trim()).filter(Boolean)) {
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) ok.push(v)
    else rejected.push(v)
  }
  return { ok, rejected }
}
