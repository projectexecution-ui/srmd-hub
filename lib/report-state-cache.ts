import { unstable_cache, revalidateTag } from 'next/cache'
import { createClient as createServiceClient } from '@supabase/supabase-js'

/** Cached read of the Contractor and Supplier report blobs.
 *
 *  Why: contractor_report_state and supplier_report_state hold a few hundred kB
 *  of JSON each (every project × sub-project × category × party). The report
 *  pages fetch them on every open and the V2 upload page on every visit, and
 *  each fetch parsed the whole blob from scratch — the same pattern that made
 *  the tracker blob the most expensive read in the app before it was cached
 *  (lib/procurement/tracker-cache.ts). Same fix: one shared entry per table,
 *  invalidated by tag on every write (the PUT routes and the IN4 feeds).
 *
 *  Safe to share across users: both blobs are org-wide and the routes gate
 *  entry with auth before reaching the cache; nothing per-user is inside.
 *  Uses a service-role client because an unstable_cache callback must not read
 *  cookies, and the request-scoped Supabase client does.
 */
export type ReportTable = 'contractor_report_state' | 'supplier_report_state'

export type ReportStateRow = {
  state: unknown
  version: number
  updatedAt: string
  updatedByName: string | null
}

export const reportTag = (table: ReportTable) => `report-state:${table}`

function serviceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function fetchRow(sb: any, table: ReportTable): Promise<ReportStateRow | null> {
  const { data, error } = await sb.from(table).select('state, version, updated_at, updated_by').eq('id', 'global').maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  let updatedByName: string | null = null
  if (data.updated_by) {
    const { data: prof } = await sb.from('profiles').select('full_name, name').eq('id', data.updated_by).maybeSingle()
    updatedByName = prof?.full_name ?? prof?.name ?? null
  }
  return { state: data.state, version: data.version, updatedAt: data.updated_at, updatedByName }
}

const cachedContractor = unstable_cache(async () => fetchRow(serviceClient(), 'contractor_report_state'), ['report-state-contractor'], { tags: [reportTag('contractor_report_state')], revalidate: 3600 })
const cachedSupplier = unstable_cache(async () => fetchRow(serviceClient(), 'supplier_report_state'), ['report-state-supplier'], { tags: [reportTag('supplier_report_state')], revalidate: 3600 })

/** The blob, from cache. `fallbackClient` is used when there is no service key
 *  (local envs) so a misconfigured environment is slow, not broken. */
export async function getReportState(table: ReportTable, fallbackClient?: unknown): Promise<ReportStateRow | null> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    if (!fallbackClient) throw new Error('report-state-cache: no service key and no fallback client')
    return fetchRow(fallbackClient, table)
  }
  return table === 'contractor_report_state' ? cachedContractor() : cachedSupplier()
}

/** Call after ANY write to the table. `{ expire: 0 }` so the very next reader
 *  gets the new blob rather than the previous one while a refresh runs. */
export function revalidateReportState(table: ReportTable): void {
  revalidateTag(reportTag(table), { expire: 0 })
}
