// Server-side aggregation for the JMR dashboard.
//
// The Bills feature was removed — JMR is now just "log the day → Head
// approves". So the only money view is SPEND: the value of work logged in
// jmr_daily_entries (rate × qty), grossed up by GST for the cash-outflow
// picture (app_settings.jmr_gst_rate_pct, default 18).

import { createClient } from '@/lib/supabase/server'
import { getJmrSettings } from '@/lib/jmr/settings'

export interface DashboardSnapshot {
  totals: { spend: number }
  perContractor: Array<{ contractor_id: string; name: string; spend: number }>
}

export async function getDashboardSnapshot(): Promise<DashboardSnapshot> {
  const supabase = await createClient()

  const [entriesRes, contractorsRes, settings] = await Promise.all([
    supabase
      .from('jmr_daily_entries')
      .select('contractor_id, amount')
      .in('status', ['submitted', 'pm_approved']),
    supabase.from('jmr_contractors').select('id, name'),
    getJmrSettings(),
  ])

  const gstMul = 1 + (settings.gst_rate_pct / 100)
  const entries = entriesRes.data ?? []
  const contractors = contractorsRes.data ?? []
  const cName = new Map(contractors.map(c => [c.id, c.name]))

  const map = new Map<string, number>()
  for (const e of entries) {
    map.set(e.contractor_id, (map.get(e.contractor_id) ?? 0) + Number(e.amount) * gstMul)
  }

  const perContractor = [...map.entries()]
    .map(([contractor_id, spend]) => ({ contractor_id, name: cName.get(contractor_id) ?? 'Contractor', spend }))
    .sort((a, b) => b.spend - a.spend)

  const spend = perContractor.reduce((s, c) => s + c.spend, 0)

  return { totals: { spend }, perContractor }
}
