// Fetches JMR module settings from public.app_settings (key/value rows).
// Cached per-request so multiple callers share one round trip.

import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import type { JmrSettings } from '@/lib/types'

const DEFAULTS: JmrSettings = {
  gst_rate_pct: 18,
  variance_tolerance_pct: 5,
  variance_tolerance_min_hours: 4,
  entry_edit_window_hours: 12,
  weekly_report_day: 'monday',
  weekly_report_hour_ist: 9,
  weekly_report_recipients: [],
}

export const getJmrSettings = cache(async (): Promise<JmrSettings> => {
  const supabase = await createClient()
  const { data } = await supabase
    .from('app_settings')
    .select('key, value')
    .like('key', 'jmr_%')
  const map: Record<string, string> = {}
  for (const row of data ?? []) map[row.key as string] = row.value as string

  const parseNum = (k: string, fallback: number): number => {
    const v = map[k]
    if (v == null) return fallback
    const n = Number(v)
    return isNaN(n) ? fallback : n
  }
  const parseArr = (k: string): string[] => {
    const v = map[k]
    if (!v) return []
    try { const a = JSON.parse(v); return Array.isArray(a) ? a : [] } catch { return [] }
  }

  return {
    gst_rate_pct:                 parseNum('jmr_gst_rate_pct', DEFAULTS.gst_rate_pct),
    variance_tolerance_pct:       parseNum('jmr_variance_tolerance_pct', DEFAULTS.variance_tolerance_pct),
    variance_tolerance_min_hours: parseNum('jmr_variance_tolerance_min_hours', DEFAULTS.variance_tolerance_min_hours),
    entry_edit_window_hours:      parseNum('jmr_entry_edit_window_hours', DEFAULTS.entry_edit_window_hours),
    weekly_report_day:            map['jmr_weekly_report_day'] ?? DEFAULTS.weekly_report_day,
    weekly_report_hour_ist:       parseNum('jmr_weekly_report_hour_ist', DEFAULTS.weekly_report_hour_ist),
    weekly_report_recipients:     parseArr('jmr_weekly_report_recipients'),
  }
})

export function isVarianceFlagged(
  billed: number, jmr: number, settings: JmrSettings, unit: string
): boolean {
  const diff = Math.abs(billed - jmr)
  const pct = jmr > 0 ? (diff / jmr) * 100 : (diff > 0 ? 100 : 0)
  const pctOver = pct > settings.variance_tolerance_pct
  const hrsOver = unit === 'hr' && diff > settings.variance_tolerance_min_hours
  // Spec: ">5% or 4hr, whichever HIGHER" — i.e. only flag if BOTH thresholds are breached.
  return pctOver && hrsOver || (unit !== 'hr' && pctOver)
}
