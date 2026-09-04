// The Phase 2 feeds, end to end: Indent → PO tracker, Contractor report,
// Supplier report, and the masters mirror. Same shape as the budget sync in
// ./sync.ts — read IN4 → mirror → rebuild the module's data → compare with the
// last upload → (live mode only) write the module's state exactly as its upload
// did, so every screen downstream keeps working unchanged.
//
// One switch per feed (app_settings.in4_<feed>_live). The masters feed has no
// switch: it only fills the in4_* mirror tables the Masters screens read, and
// never writes into the hub's own lists.
//
// Server-only, service-role. Called by the cron dispatcher (one job per feed,
// twice a day) and by "Run now" on /admin/in4.

import { createClient as createServiceClient, type SupabaseClient } from '@supabase/supabase-js'
import { extractProjects, extractSubprojects, extractSkills } from './extract'
import {
  extractIndentRows, extractContractorCerts, extractSupplierCerts,
  extractParties, extractMaterials, extractStores, extractCompanies, extractUoms,
} from './extract-feeds'
import { buildTracker, buildTrackerState, compareTracker, type TrackerStoredState } from './tracker'
import { buildContractorDocs, compareContractor } from './contractor'
import { buildSupplierDocs, compareSupplier } from './supplier'
import { splitCode, cleanLabel } from './compute'
import { revalidateTrackerSoon } from '@/lib/procurement/tracker-cache'
import { revalidateReportState } from '@/lib/report-state-cache'
import { isOn, type SettingValues } from '@/lib/warehouse/settings'
import type { ReportDoc as ContractorDoc } from '@/lib/contractor-report'
import type { ReportDoc as SupplierDoc } from '@/lib/supplier-report'

export type Feed = 'budget' | 'tracker' | 'contractor' | 'supplier' | 'masters'
export type FeedMode = 'shadow' | 'live' | 'mirror'
export const FEEDS: Feed[] = ['budget', 'tracker', 'contractor', 'supplier', 'masters']

export const FEED_LIVE_KEY: Partial<Record<Feed, string>> = {
  budget: 'in4_budget_live', tracker: 'in4_tracker_live', contractor: 'in4_contractor_live', supplier: 'in4_supplier_live',
}
export function feedLastKey(feed: Feed): string { return feed === 'budget' ? 'in4_last_sync' : `in4_last_sync_${feed}` }

export const FEED_META: Record<Feed, { label: string; replaces: string; page: string; source: string }> = {
  budget:     { label: 'Budget vs Expenses report', replaces: 'the weekly ENGG_CONSOLIDATED_SRMDBUDGET… Excel on /budget', page: '/budget', source: 'ENGG_SUBPROJECT_BUDGET · BI.FACT_ENGG_WORK_ORDER · BI.FACT_ENGG_WO_PAYMENTS · BI.FACT_PURCHASE_SUPPLIER_PAY' },
  tracker:    { label: 'Indent → PO tracker', replaces: 'both uploads on /procurement-tracker (Indent-to-Issue and PO report)', page: '/procurement-tracker', source: 'PURCH_INDENT_TO_ISSUE' },
  contractor: { label: 'Contractor report', replaces: 'the "All Types Certificates Details" Excel on /contractor-report', page: '/contractor-report', source: 'ENGG_RPT_WO_CERTIFICATE_DETAILS · BI.ENGG_ADVANCE_PAYMENTS_HEADER · BI.ENGG_MISC_PAYMENTS_HEADER' },
  supplier:   { label: 'Supplier report', replaces: 'the "All Purchase Payments Report" Excel on /supplier-report', page: '/supplier-report', source: 'BI.FACT_PURCHASE_SUPPLIER_PAY · BI.FACT_PURCHASE_SUPPLIER_ADV_PAY' },
  masters:    { label: 'Masters (contractors, suppliers, materials, stores, trusts, units)', replaces: 'nothing — mirrors IN4 for the Masters screens', page: '/admin/masters', source: 'ENGG_SERVICE_PROVIDER · PURCH_SUPPLIER · PURCH_MATERIAL_LOOKUP · BI.DIM_STORE · COMMON.TBLCOMMONCOMPANY · COMMON_UOM_LOOKUP' },
}

export interface FeedResult {
  ok: boolean
  feed: Feed
  runId: number | null
  mode: FeedMode
  error?: string
  rowsRead: number
  wrote: boolean
  summary?: string
  comparison?: unknown
  startedAt: string
  finishedAt: string
}

export interface LastFeedSync { at: string; mode: FeedMode; ok: boolean; error?: string; rows?: number; wrote?: boolean; summary?: string }

function svc(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set — the IN4 sync writes with the service role.')
  return createServiceClient(url, key, { auth: { persistSession: false } })
}

const chunk = <T,>(arr: T[], size = 500): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

async function upsertAll(sb: SupabaseClient, table: string, rows: Record<string, unknown>[], onConflict: string) {
  for (const batch of chunk(rows)) {
    const { error } = await sb.from(table).upsert(batch, { onConflict })
    if (error) throw new Error(`${table}: ${error.message}`)
  }
}

/** Replace-all semantics for a mirror: whatever this run did not touch is gone
 *  from IN4 too. */
async function dropStale(sb: SupabaseClient, table: string, now: string, filter?: (q: ReturnType<SupabaseClient['from']>['delete'] extends (...a: never) => infer R ? R : never) => unknown) {
  let q = sb.from(table).delete().lt('synced_at', now)
  if (filter) q = filter(q) as typeof q
  const { error } = await q
  if (error) throw new Error(`${table} cleanup: ${error.message}`)
}

async function readMode(sb: SupabaseClient, feed: Feed, force?: 'shadow' | 'live'): Promise<FeedMode> {
  if (feed === 'masters') return 'mirror'
  if (force) return force
  const key = FEED_LIVE_KEY[feed]!
  const { data } = await sb.from('app_settings').select('value').eq('key', key).maybeSingle()
  return String(data?.value ?? 'false') === 'true' ? 'live' : 'shadow'
}

/** Cheap read for status chips. Works with any Supabase client. */
export async function readLastFeedSync(sb: { from: SupabaseClient['from'] }, feed: Feed): Promise<LastFeedSync | null> {
  const { data } = await sb.from('app_settings').select('value').eq('key', feedLastKey(feed)).maybeSingle()
  if (!data?.value) return null
  try { return JSON.parse(String(data.value)) as LastFeedSync } catch { return null }
}

export async function readFeedModes(sb: { from: SupabaseClient['from'] }): Promise<Record<Feed, FeedMode>> {
  const keys = Object.values(FEED_LIVE_KEY)
  const { data } = await sb.from('app_settings').select('key, value').in('key', keys)
  const on = new Set((data ?? []).filter(r => String(r.value) === 'true').map(r => r.key as string))
  const out = {} as Record<Feed, FeedMode>
  for (const f of FEEDS) out[f] = f === 'masters' ? 'mirror' : on.has(FEED_LIVE_KEY[f]!) ? 'live' : 'shadow'
  return out
}

// ── The masters mirror ───────────────────────────────────────────────────────

async function runMasters(sb: SupabaseClient, now: string): Promise<{ rows: number; summary: string }> {
  const [projects, subprojects, skills, parties, materials, stores, companies, uoms] = [
    await extractProjects(), await extractSubprojects(), await extractSkills(),
    await extractParties(), await extractMaterials(), await extractStores(), await extractCompanies(), await extractUoms(),
  ]
  await upsertAll(sb, 'in4_projects', projects.map(p => ({ ...p, synced_at: now })), 'id')
  await upsertAll(sb, 'in4_subprojects', subprojects.map(s => ({ ...s, synced_at: now })), 'id')
  await upsertAll(sb, 'in4_skills', skills.map(s => ({ id: s.id, name: s.name, code: splitCode(cleanLabel(s.name)).code || null, parent_id: s.parent_id, short_name: s.short_name, is_active: s.is_active, synced_at: now })), 'id')
  await upsertAll(sb, 'in4_parties', parties.map(p => ({ ...p, synced_at: now })), 'kind,id')
  await upsertAll(sb, 'in4_materials', materials.map(m => ({ ...m, synced_at: now })), 'id')
  await upsertAll(sb, 'in4_stores', stores.map(s => ({ ...s, synced_at: now })), 'id')
  await upsertAll(sb, 'in4_companies', companies.map(c => ({ ...c, synced_at: now })), 'id')
  await upsertAll(sb, 'in4_uoms', uoms.map(u => ({ ...u, synced_at: now })), 'id')
  for (const t of ['in4_parties', 'in4_materials', 'in4_stores', 'in4_companies', 'in4_uoms']) await dropStale(sb, t, now)
  const rows = projects.length + subprojects.length + skills.length + parties.length + materials.length + stores.length + companies.length + uoms.length
  const contractors = parties.filter(p => p.kind === 'contractor').length
  return { rows, summary: `${contractors} contractors · ${parties.length - contractors} suppliers · ${materials.length} materials · ${stores.length} stores · ${companies.length} trusts · ${uoms.length} units` }
}

// ── Indent → PO ──────────────────────────────────────────────────────────────

async function runTracker(sb: SupabaseClient, now: string, mode: FeedMode, actorId: string | null) {
  const rows = await extractIndentRows()
  const { lines, items } = buildTracker(rows)
  const state = buildTrackerState(lines, `IN4 live sync ${now.slice(0, 10)}`, now)

  await upsertAll(sb, 'in4_indent_items', items.map(i => ({ ...i, synced_at: now })), 'indent_item_id')
  await dropStale(sb, 'in4_indent_items', now)

  const { data: slots, error } = await sb.from('procurement_tracker_state').select('id, state, version').in('id', ['global', 'po'])
  if (error) throw new Error(`procurement_tracker_state: ${error.message}`)
  const global = (slots ?? []).find(s => s.id === 'global')
  const po = (slots ?? []).find(s => s.id === 'po')
  const hubState = (global?.state ?? null) as TrackerStoredState | null
  const comparison = compareTracker(hubState, state)

  let wrote = false
  let warehouse = ''
  if (mode === 'live') {
    // Snapshot both slots, then write: everything in the indent slot, and an
    // empty PO slot — IN4's rates are already on every line, so the second
    // report has nothing left to add and the merge just passes the first through.
    for (const s of [global, po]) {
      if (!s) continue
      const { error: snapErr } = await sb.from('procurement_tracker_state_history').insert({ state_id: s.id, state: s.state, version: s.version, snapshot_by: actorId })
      if (snapErr) console.warn('[in4-tracker] history snapshot failed:', snapErr.message)
    }
    const emptyPo: TrackerStoredState = { format: 'flat', fileName: 'IN4 live sync — rates are on the indent lines', savedAt: now, projects: [], pendingLineCount: 0, totalGrnValue: 0, pendingValue: 0, indentStatuses: [], lineStatuses: [] }
    const { error: w1 } = await sb.from('procurement_tracker_state').upsert({ id: 'global', state: state, version: (global?.version ?? 0) + 1, updated_at: now, updated_by: actorId })
    if (w1) throw new Error(`procurement_tracker_state(global): ${w1.message}`)
    const { error: w2 } = await sb.from('procurement_tracker_state').upsert({ id: 'po', state: emptyPo, version: (po?.version ?? 0) + 1, updated_at: now, updated_by: actorId })
    if (w2) throw new Error(`procurement_tracker_state(po): ${w2.message}`)
    revalidateTrackerSoon()
    wrote = true

    // The known-projects registry the visibility picker uses.
    const known = state.projects.map(p => p.projectName?.trim()).filter((x): x is string => !!x).map(name => ({ name, last_seen_at: now, last_seen_by: actorId }))
    if (known.length) {
      const { error: kErr } = await sb.from('procurement_known_projects').upsert(known, { onConflict: 'name' })
      if (kErr) console.warn('[in4-tracker] known projects:', kErr.message)
    }

    // Feed the Warehouse from the same data, the way the upload did.
    try {
      const { data: wh } = await sb.from('app_settings').select('key, value').like('key', 'wh_%')
      const values: SettingValues = {}
      for (const r of wh ?? []) values[r.key as string] = (r.value as string) ?? ''
      if (isOn(values, 'wh_auto_sync_on_upload')) {
        const { runIn4Sync: whSync } = await import('@/lib/warehouse/in4-sync-apply')
        const res = await whSync(['items', 'units', 'disciplines', 'pos'], actorId, sb)
        warehouse = res.ok
          ? [res.itemsCreated ? `${res.itemsCreated} items` : '', res.itemsAdopted ? `${res.itemsAdopted} items linked` : '', res.posCreated ? `${res.posCreated} POs` : ''].filter(Boolean).join(', ') || 'warehouse up to date'
          : `warehouse sync failed: ${res.error}`
      }
    } catch (e) { warehouse = `warehouse sync failed: ${e instanceof Error ? e.message : e}` }
  }

  const t = comparison.totals
  const summary = `${state.lineStatuses.length} lines · ${state.projects.length} projects · ${state.pendingLineCount} pending (upload had ${t.hubLines} lines · ${t.hubPending} pending)${warehouse ? ` · ${warehouse}` : ''}`
  return { rows: rows.length, comparison, wrote, summary }
}

// ── Contractor / Supplier reports ────────────────────────────────────────────

async function namesFor(sb: SupabaseClient) {
  const [projects, subprojects, skills] = [await extractProjects(), await extractSubprojects(), await extractSkills()]
  const pn = new Map(projects.map(p => [p.id, p.name]))
  const spn = new Map(subprojects.map(s => [s.id, s.name]))
  const spProject = new Map(subprojects.map(s => [s.id, s.project_id]))
  const kn = new Map(skills.map(k => [k.id, k.name]))
  // Party names from the mirror (the masters feed keeps it current); fall back
  // to IN4 directly if it has never run.
  let { data: parties } = await sb.from('in4_parties').select('kind, id, name')
  if (!parties || parties.length === 0) parties = (await extractParties()).map(p => ({ kind: p.kind, id: p.id, name: p.name }))
  const contractors = new Map(parties.filter(p => p.kind === 'contractor').map(p => [p.id as number, p.name as string]))
  const suppliers = new Map(parties.filter(p => p.kind === 'supplier').map(p => [p.id as number, p.name as string]))
  return {
    projectName: (id: number | null) => (id == null ? '(No project)' : pn.get(id) ?? `Project ${id}`),
    subprojectName: (id: number) => spn.get(id) ?? `Sub-project ${id}`,
    skillName: (id: number | null) => (id == null ? '' : kn.get(id) ?? ''),
    contractorName: (id: number | null) => (id == null ? '' : contractors.get(id) ?? `Contractor ${id}`),
    supplierName: (id: number | null) => (id == null ? '' : suppliers.get(id) ?? `Supplier ${id}`),
    projectOfSubproject: (id: number) => spProject.get(id) ?? null,
  }
}

type ReportTable = 'contractor_report_state' | 'supplier_report_state'

/** Write the docs into the report's state the way the upload did — history
 *  snapshot, version bump — carrying each project's area settings across. In
 *  live mode IN4 IS the list, so a project IN4 no longer reports drops out (the
 *  snapshot keeps it). */
async function writeReportState<D extends { projectName: string; areaBySub?: Record<string, number> }>(sb: SupabaseClient, table: ReportTable, docs: D[], now: string, actorId: string | null) {
  const { data: cur, error } = await sb.from(table).select('state, version').eq('id', 'global').maybeSingle()
  if (error) throw new Error(`${table}: ${error.message}`)
  const state = (cur?.state ?? { reports: [] }) as { reports?: D[]; settings?: Record<string, unknown> }
  const prev = new Map((state.reports ?? []).map(r => [r.projectName, r]))
  const next = docs.map(d => ({ ...d, areaBySub: prev.get(d.projectName)?.areaBySub ?? d.areaBySub }))
  if (cur) {
    const { error: snapErr } = await sb.from(`${table}_history`).insert({ state_id: 'global', state: cur.state, version: cur.version, snapshot_by: actorId })
    if (snapErr) console.warn(`[in4-${table}] history snapshot failed:`, snapErr.message)
  }
  const { error: updErr } = await sb.from(table).upsert({ id: 'global', state: { ...state, reports: next }, version: (cur?.version ?? 0) + 1, updated_at: now, updated_by: actorId })
  if (updErr) throw new Error(`${table}: ${updErr.message}`)
  revalidateReportState(table)
}

async function runContractor(sb: SupabaseClient, now: string, mode: FeedMode, actorId: string | null) {
  const certs = await extractContractorCerts()
  const names = await namesFor(sb)
  const docs = buildContractorDocs(certs, names, now)

  await upsertAll(sb, 'in4_wo_certificates', certs.map(c => ({
    kind: c.kind, certificate_id: c.certificate_id, certificate_type_id: c.certificate_type_id, certificate_type: c.certificate_type,
    wo_id: c.wo_id ?? 0, wo_no: c.wo_no, wo_value: c.wo_value, project_id: c.project_id, subproject_id: c.subproject_id,
    category_id: c.skill_id ?? 0, subcategory_id: c.subskill_id ?? 0, contractor_id: c.contractor_id, contractor_name: names.contractorName(c.contractor_id) || null,
    status: c.status, invoice_no: c.invoice_no, invoice_date: c.invoice_date, creation_dt: c.creation_dt,
    gross_bill_amt: c.gross, certified_amt: c.certified, paid_amt: c.paid, recoveries: c.recoveries, deductions: c.deductions,
    retention_amt: c.retention, outstanding_amt: c.outstanding, synced_at: now,
  })), 'kind,certificate_id')
  await dropStale(sb, 'in4_wo_certificates', now)

  const { data: cur } = await sb.from('contractor_report_state').select('state').eq('id', 'global').maybeSingle()
  const hubDocs = ((cur?.state as { reports?: ContractorDoc[] } | null)?.reports ?? [])
  const comparison = compareContractor(hubDocs, docs)
  let wrote = false
  if (mode === 'live') { await writeReportState(sb, 'contractor_report_state', docs, now, actorId); wrote = true }
  const summary = `${docs.length} projects · ${certs.length} certificates · vs upload: ${comparison.totals.exact} exact · ${comparison.totals.near} near · ${comparison.totals.off} off`
  return { rows: certs.length, comparison, wrote, summary }
}

async function runSupplier(sb: SupabaseClient, now: string, mode: FeedMode, actorId: string | null) {
  const raw = await extractSupplierCerts()
  const names = await namesFor(sb)
  const certs = raw.map(c => ({ ...c, project_id: names.projectOfSubproject(c.subproject_id) }))
  const docs = buildSupplierDocs(certs, names, now)

  await upsertAll(sb, 'in4_supplier_certificates', certs.map(c => ({
    kind: c.kind, certificate_id: c.certificate_id, certificate_no: c.certificate_no, project_id: c.project_id, subproject_id: c.subproject_id,
    supplier_id: c.supplier_id, supplier_name: names.supplierName(c.supplier_id) || null, po_id: c.po_id, status: c.status, category: c.category,
    certified_amt: c.certified, landed_cost: c.landed, tax_addition: c.tax_add, tax_deduction: c.tax_ded, adv_recovery: c.adv_recovery,
    debit_note_adj: c.debit_note, retention: c.retention, payable: c.payable, paid: c.paid, outstanding: c.outstanding, synced_at: now,
  })), 'kind,certificate_id')
  await dropStale(sb, 'in4_supplier_certificates', now)

  const { data: cur } = await sb.from('supplier_report_state').select('state').eq('id', 'global').maybeSingle()
  const hubDocs = ((cur?.state as { reports?: SupplierDoc[] } | null)?.reports ?? [])
  const comparison = compareSupplier(hubDocs, docs)
  let wrote = false
  if (mode === 'live') { await writeReportState(sb, 'supplier_report_state', docs, now, actorId); wrote = true }
  const summary = `${docs.length} projects · ${certs.length} certificates · vs upload: ${comparison.totals.exact} exact · ${comparison.totals.near} near · ${comparison.totals.off} off`
  return { rows: certs.length, comparison, wrote, summary }
}

// ── The runner ───────────────────────────────────────────────────────────────

export interface FeedOptions { trigger: 'cron' | 'manual'; actorId?: string | null; forceMode?: 'shadow' | 'live' }

export async function runFeed(feed: Exclude<Feed, 'budget'>, opts: FeedOptions): Promise<FeedResult> {
  const sb = svc()
  const startedAt = new Date().toISOString()
  const mode = await readMode(sb, feed, opts.forceMode)
  const { data: runRow } = await sb.from('in4_sync_runs').insert({ feed, trigger: opts.trigger, mode, actor_id: opts.actorId ?? null }).select('id').single()
  const runId = (runRow?.id as number | undefined) ?? null
  const finish = async (patch: Record<string, unknown>) => {
    if (runId != null) await sb.from('in4_sync_runs').update({ finished_at: new Date().toISOString(), ...patch }).eq('id', runId)
  }
  try {
    let out: { rows: number; comparison?: unknown; wrote?: boolean; summary: string }
    if (feed === 'masters') out = await runMasters(sb, startedAt)
    else if (feed === 'tracker') out = await runTracker(sb, startedAt, mode, opts.actorId ?? null)
    else if (feed === 'contractor') out = await runContractor(sb, startedAt, mode, opts.actorId ?? null)
    else out = await runSupplier(sb, startedAt, mode, opts.actorId ?? null)

    const finishedAt = new Date().toISOString()
    await finish({ ok: true, rows_read: out.rows, compared: out.comparison ?? null, wrote_budget_hub: !!out.wrote })
    const last: LastFeedSync = { at: finishedAt, mode, ok: true, rows: out.rows, wrote: !!out.wrote, summary: out.summary }
    await sb.from('app_settings').upsert({ key: feedLastKey(feed), value: JSON.stringify(last) }, { onConflict: 'key' })
    return { ok: true, feed, runId, mode, rowsRead: out.rows, wrote: !!out.wrote, summary: out.summary, comparison: out.comparison, startedAt, finishedAt }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    await finish({ ok: false, error })
    await sb.from('app_settings').upsert({ key: feedLastKey(feed), value: JSON.stringify({ at: new Date().toISOString(), mode, ok: false, error } satisfies LastFeedSync) }, { onConflict: 'key' })
    return { ok: false, feed, runId, mode, error, rowsRead: 0, wrote: false, startedAt, finishedAt: new Date().toISOString() }
  }
}
