// Fetches JMR module settings from public.app_settings (key/value rows).
// Cached per-request so multiple callers share one round trip.

import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import type { JmrSettings } from '@/lib/types'

const DEFAULTS: JmrSettings = {
  gst_rate_pct: 18,
  weekly_report_day: 'monday',
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
    gst_rate_pct:             parseNum('jmr_gst_rate_pct', DEFAULTS.gst_rate_pct),
    weekly_report_day:        map['jmr_weekly_report_day'] ?? DEFAULTS.weekly_report_day,
    weekly_report_recipients: parseArr('jmr_weekly_report_recipients'),
  }
})
