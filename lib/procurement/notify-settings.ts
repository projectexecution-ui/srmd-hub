// Config for the Indent → PO Tracker weekday follow-up / reminder email.
// Stored as key/value rows in public.app_settings (prefix `procurement_notify_`),
// mirroring lib/jmr/settings.ts. A missing key reads as the code default, so no
// DB seeding is needed. The pure parser is shared by the cached server loader
// (session client) and the cron route (service-role client).
//
// The email is scoped PER ATM HEAD: `assignments` maps a head's profiles.id to
// the tracker project names they run. Recipients = the heads in that map.

import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'

export type NotifyFrequency = 'weekdays' | 'daily' | 'on_upload' | 'weekly'

export interface ProcurementNotifySections {
  needsPo: boolean
  awaiting: boolean
  changes: boolean
  staleAlert: boolean
}

/** userId → list of tracker project names that head runs. */
export type HeadAssignments = Record<string, string[]>

export interface ProcurementNotifyConfig {
  enabled: boolean
  frequency: NotifyFrequency
  /** 0=Sun … 6=Sat — only used when frequency === 'weekly'. */
  weeklyDay: number
  /** SLA: indent approved N+ days ago with no PO → "raise a PO". */
  noPoSlaDays: number
  /** SLA: PO placed N+ days ago, not received → "chase delivery / GRN". */
  grnSlaDays: number
  /** No-PO items older than this (days) are treated as abandoned — collapsed
   *  into a one-line "worth closing" note instead of listed to chase. */
  abandonedDays: number
  /** Max rows shown per section before "+N more". */
  listLen: number
  sections: ProcurementNotifySections
  /** Don't send when there's nothing to chase and nothing changed. */
  skipIfEmpty: boolean
  /** Atm Head → their project names. */
  assignments: HeadAssignments
  /** ISO of the last real (non-test) send — same-IST-day dedup marker. */
  lastSentAt: string | null
}

export const PROCUREMENT_NOTIFY_DEFAULTS: ProcurementNotifyConfig = {
  enabled: false,
  frequency: 'weekdays',
  weeklyDay: 1,
  noPoSlaDays: 2,
  grnSlaDays: 7,
  abandonedDays: 90,
  listLen: 6,
  sections: { needsPo: true, awaiting: true, changes: true, staleAlert: true },
  skipIfEmpty: true,
  assignments: {},
  lastSentAt: null,
}

const FREQS: NotifyFrequency[] = ['weekdays', 'daily', 'on_upload', 'weekly']

/** Pure parser over app_settings rows — no Supabase dependency, so it's reused
 *  by both the cached server loader and the service-role cron. */
export function parseProcurementNotifyConfig(
  rows: Array<{ key: string; value: string }>,
): ProcurementNotifyConfig {
  const m: Record<string, string> = {}
  for (const r of rows) m[r.key] = r.value

  const bool = (k: string, f: boolean) => (m[k] == null ? f : m[k] === 'true')
  const num = (k: string, f: number) => { const n = Number(m[k]); return Number.isFinite(n) && m[k] != null ? n : f }

  let sections = { ...PROCUREMENT_NOTIFY_DEFAULTS.sections }
  try {
    const s = JSON.parse(m['procurement_notify_sections'] ?? 'null')
    if (s && typeof s === 'object') sections = { ...sections, ...s }
  } catch { /* keep defaults */ }

  const assignments: HeadAssignments = {}
  try {
    const a = JSON.parse(m['procurement_notify_assignments'] ?? 'null')
    if (a && typeof a === 'object' && !Array.isArray(a)) {
      for (const [uid, projs] of Object.entries(a)) {
        if (Array.isArray(projs)) {
          const clean = projs.filter(x => typeof x === 'string')
          if (clean.length) assignments[uid] = clean
        }
      }
    }
  } catch { /* keep empty */ }

  const freqRaw = m['procurement_notify_frequency'] as NotifyFrequency | undefined
  const frequency: NotifyFrequency = freqRaw && FREQS.includes(freqRaw) ? freqRaw : PROCUREMENT_NOTIFY_DEFAULTS.frequency

  return {
    enabled: bool('procurement_notify_enabled', PROCUREMENT_NOTIFY_DEFAULTS.enabled),
    frequency,
    weeklyDay: num('procurement_notify_weekly_day', PROCUREMENT_NOTIFY_DEFAULTS.weeklyDay),
    noPoSlaDays: Math.max(0, num('procurement_notify_no_po_sla_days', PROCUREMENT_NOTIFY_DEFAULTS.noPoSlaDays)),
    grnSlaDays: Math.max(0, num('procurement_notify_grn_sla_days', PROCUREMENT_NOTIFY_DEFAULTS.grnSlaDays)),
    abandonedDays: Math.max(30, num('procurement_notify_abandoned_days', PROCUREMENT_NOTIFY_DEFAULTS.abandonedDays)),
    listLen: Math.min(25, Math.max(3, num('procurement_notify_list_len', PROCUREMENT_NOTIFY_DEFAULTS.listLen))),
    sections,
    skipIfEmpty: bool('procurement_notify_skip_if_empty', PROCUREMENT_NOTIFY_DEFAULTS.skipIfEmpty),
    assignments,
    lastSentAt: m['procurement_notify_last_sent_at'] ?? null,
  }
}

/** Per-request cached loader for server components. */
export const getProcurementNotifyConfig = cache(async (): Promise<ProcurementNotifyConfig> => {
  const supabase = await createClient()
  const { data } = await supabase
    .from('app_settings')
    .select('key, value')
    .like('key', 'procurement_notify_%')
  return parseProcurementNotifyConfig((data ?? []) as Array<{ key: string; value: string }>)
})
