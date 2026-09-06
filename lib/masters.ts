// The Masters layer — the lists everything else in the hub points at — with
// IN4 as the base list wherever IN4 keeps one.
//
// The audit found the same contractor spelt four ways across four lists, the
// same cement in four item catalogues, two store lists and three screens that
// create a project. IN4 is the system those names come FROM (every PO, WO and
// GRN is raised against IN4's master), so the sync mirrors IN4's masters into
// in4_* tables and these loaders lay the hub's own lists against them: matched
// by name (and PAN / GSTIN for parties), or by a link an admin pinned on the
// Masters screen when the name alone could not decide.
//
// Nothing here writes to the hub's own lists. Merging is a decision to take
// with the numbers in front of you; the screens show the numbers.

import { createClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/warehouse/paging'

/** Normalise a name for comparison: case, spacing and punctuation differ
 *  between IN4 and what people typed into the hub. */
export function nameKey(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

type Sb = Awaited<ReturnType<typeof createClient>>

async function links(sb: Sb, kind: 'party' | 'material' | 'store'): Promise<Map<string, string>> {
  const { data } = await sb.from('master_links').select('hub_table, hub_id, in4_key').eq('kind', kind)
  return new Map((data ?? []).map(r => [`${r.hub_table}:${r.hub_id}`, r.in4_key as string]))
}

// ── Contacts (contractors + suppliers) ───────────────────────────────────────

export interface ContactRow {
  /** 'contractor:12' / 'supplier:4' for IN4 rows; 'hub:vendors:<uuid>' for a hub-only row. */
  key: string
  name: string
  kind: 'contractor' | 'supplier' | 'both' | 'hub-only'
  code: string | null
  pan: string | null
  gstin: string | null
  msme: string | null
  phone: string | null
  email: string | null
  city: string | null
  address: string | null
  skills: string[]
  isActive: boolean
  /** Hub lists this party also appears in, e.g. ["Vendors", "JMR contractors"]. */
  hubSources: string[]
  /** The hub rows behind hubSources, for the link action. */
  hubRefs: Array<{ table: 'vendors' | 'jmr_contractors'; id: string; name: string }>
  /** How many of name, PAN, GSTIN, phone, email, address are filled. */
  completeness: number
}

export async function loadContacts(): Promise<{ rows: ContactRow[]; in4Count: number; hubOnly: number; matched: number; synced: boolean }> {
  const sb = await createClient()
  const [pRes, vRes, jRes, pinned] = await Promise.all([
    sb.from('in4_parties').select('kind, id, name, code, pan, gstin, msme, phone, email, city, address, skills, is_active').order('name'),
    sb.from('vendors').select('id, name, gstin, address, contact_phone, contact_email'),
    sb.from('jmr_contractors').select('id, name, gst_number, phone, email'),
    links(sb, 'party'),
  ])
  type P = { kind: 'contractor' | 'supplier'; id: number; name: string; code: string | null; pan: string | null; gstin: string | null; msme: string | null; phone: string | null; email: string | null; city: string | null; address: string | null; skills: string[]; is_active: boolean }
  const parties = (pRes.data ?? []) as P[]

  // One row per distinct party — the same firm registered as contractor AND
  // supplier (same PAN) collapses to one, kind 'both'.
  const byKey = new Map<string, ContactRow>()
  const idxByName = new Map<string, string>()
  const idxByPan = new Map<string, string>()
  const idxByGst = new Map<string, string>()
  for (const p of parties) {
    const pan = p.pan?.toUpperCase() ?? null
    const existingKey = (pan && idxByPan.get(pan)) || idxByName.get(nameKey(p.name))
    if (existingKey) {
      const row = byKey.get(existingKey)!
      if (row.kind !== p.kind) row.kind = 'both'
      row.code ??= p.code; row.gstin ??= p.gstin; row.msme ??= p.msme; row.phone ??= p.phone; row.email ??= p.email; row.city ??= p.city; row.address ??= p.address
      row.skills = [...new Set([...row.skills, ...(p.skills ?? [])])]
      idxByName.set(nameKey(p.name), existingKey)
      continue
    }
    const key = `${p.kind}:${p.id}`
    byKey.set(key, { key, name: p.name, kind: p.kind, code: p.code, pan, gstin: p.gstin, msme: p.msme, phone: p.phone, email: p.email, city: p.city, address: p.address, skills: p.skills ?? [], isActive: p.is_active, hubSources: [], hubRefs: [], completeness: 0 })
    idxByName.set(nameKey(p.name), key)
    if (pan) idxByPan.set(pan, key)
    if (p.gstin) idxByGst.set(p.gstin.toUpperCase(), key)
  }

  const attach = (table: 'vendors' | 'jmr_contractors', label: string, id: string, name: string, gstin: string | null, phone: string | null, email: string | null, address: string | null) => {
    const pinnedKey = pinned.get(`${table}:${id}`)
    const key = (pinnedKey && byKey.has(pinnedKey) ? pinnedKey : null)
      ?? (gstin ? idxByGst.get(gstin.toUpperCase()) : undefined)
      ?? idxByName.get(nameKey(name))
    if (key) {
      const row = byKey.get(key)!
      if (!row.hubSources.includes(label)) row.hubSources.push(label)
      row.hubRefs.push({ table, id, name })
      row.phone ??= phone; row.email ??= email; row.address ??= address; row.gstin ??= gstin
      return
    }
    const hubKey = `hub:${table}:${id}`
    byKey.set(hubKey, { key: hubKey, name, kind: 'hub-only', code: null, pan: null, gstin, msme: null, phone, email, city: null, address, skills: [], isActive: true, hubSources: [label], hubRefs: [{ table, id, name }], completeness: 0 })
  }
  for (const v of (vRes.data ?? []) as Array<Record<string, unknown>>) attach('vendors', 'Vendors', String(v.id), String(v.name ?? '').trim(), (v.gstin as string | null) || null, (v.contact_phone as string | null) || null, (v.contact_email as string | null) || null, (v.address as string | null) || null)
  for (const c of (jRes.data ?? []) as Array<Record<string, unknown>>) attach('jmr_contractors', 'JMR contractors', String(c.id), String(c.name ?? '').trim(), (c.gst_number as string | null) || null, (c.phone as string | null) || null, (c.email as string | null) || null, null)

  const rows = [...byKey.values()]
  for (const r of rows) r.completeness = Math.round(([r.name, r.pan, r.gstin, r.phone, r.email, r.address].filter(Boolean).length / 6) * 100)
  rows.sort((a, b) => a.name.localeCompare(b.name))
  return {
    rows,
    in4Count: parties.length,
    hubOnly: rows.filter(r => r.kind === 'hub-only').length,
    matched: rows.filter(r => r.kind !== 'hub-only' && r.hubSources.length > 0).length,
    synced: parties.length > 0,
  }
}

// ── Items (materials) ────────────────────────────────────────────────────────

export interface ItemRow { id: number; name: string; code: string | null; uom: string | null; hsn: string | null; rate: number | null; isActive: boolean; inWarehouse: boolean; inInventory: boolean; whItemId: string | null }
export interface ItemSubtype { id: number; name: string; items: ItemRow[] }
export interface ItemType { id: number; name: string; subtypes: ItemSubtype[]; count: number; inWarehouse: number }
export interface ItemsMaster {
  types: ItemType[]
  in4Count: number
  synced: boolean
  hub: { warehouse: number; warehouseMatched: number; inventory: number; inventoryMatched: number; estSubcategories: number; jmrItems: number }
  /** Hub items with no IN4 material behind them — hand-typed, or IN4 renamed them. */
  unmatched: Array<{ table: 'wh_items' | 'inv_items'; id: string; name: string; unit: string | null }>
}

export async function loadItems(): Promise<ItemsMaster> {
  const sb = await createClient()
  const [mats, wh, inv, estRes, jmrRes, pinned] = await Promise.all([
    fetchAll<{ id: number; name: string; code: string | null; type_id: number | null; type_name: string | null; subtype_id: number | null; subtype_name: string | null; uom: string | null; hsn_code: string | null; rate: number | null; is_active: boolean }>((from, to) =>
      sb.from('in4_materials').select('id, name, code, type_id, type_name, subtype_id, subtype_name, uom, hsn_code, rate, is_active').order('id').range(from, to)),
    fetchAll<{ id: string; name: string; unit: string | null; in4_name: string | null }>((from, to) =>
      sb.from('wh_items').select('id, name, unit, in4_name').is('deleted_at', null).order('id').range(from, to)),
    fetchAll<{ id: string; name: string; unit: string | null }>((from, to) =>
      sb.from('inv_items').select('id, name, unit').is('deleted_at', null).order('id').range(from, to)),
    sb.from('est_subcategories').select('id', { count: 'exact', head: true }),
    sb.from('jmr_items').select('id', { count: 'exact', head: true }),
    links(sb, 'material'),
  ])
  const byName = new Map<string, number>()
  for (const m of mats.rows) if (!byName.has(nameKey(m.name))) byName.set(nameKey(m.name), m.id)
  const whByMat = new Map<number, string>()
  const invByMat = new Set<number>()
  const unmatched: ItemsMaster['unmatched'] = []
  for (const w of wh.rows) {
    const pin = pinned.get(`wh_items:${w.id}`)
    const id = pin ? Number(pin) : byName.get(nameKey(w.in4_name)) ?? byName.get(nameKey(w.name))
    if (id != null) { if (!whByMat.has(id)) whByMat.set(id, w.id) } else unmatched.push({ table: 'wh_items', id: w.id, name: w.name, unit: w.unit })
  }
  for (const i of inv.rows) {
    const pin = pinned.get(`inv_items:${i.id}`)
    const id = pin ? Number(pin) : byName.get(nameKey(i.name))
    if (id != null) invByMat.add(id); else unmatched.push({ table: 'inv_items', id: i.id, name: i.name, unit: i.unit })
  }

  const types = new Map<number, ItemType>()
  for (const m of mats.rows) {
    const tid = m.type_id ?? 0
    let t = types.get(tid)
    if (!t) { t = { id: tid, name: m.type_name ?? '(No type)', subtypes: [], count: 0, inWarehouse: 0 }; types.set(tid, t) }
    const sid = m.subtype_id ?? 0
    let st = t.subtypes.find(x => x.id === sid)
    if (!st) { st = { id: sid, name: m.subtype_name ?? '(No sub-type)', items: [] }; t.subtypes.push(st) }
    const inWarehouse = whByMat.has(m.id)
    st.items.push({ id: m.id, name: m.name, code: m.code, uom: m.uom, hsn: m.hsn_code, rate: m.rate, isActive: m.is_active, inWarehouse, inInventory: invByMat.has(m.id), whItemId: whByMat.get(m.id) ?? null })
    t.count++; if (inWarehouse) t.inWarehouse++
  }
  const sorted = [...types.values()].sort((a, b) => a.name.localeCompare(b.name))
  for (const t of sorted) { t.subtypes.sort((a, b) => a.name.localeCompare(b.name)); for (const s of t.subtypes) s.items.sort((a, b) => a.name.localeCompare(b.name)) }
  return {
    types: sorted,
    in4Count: mats.rows.length,
    synced: mats.rows.length > 0,
    hub: { warehouse: wh.rows.length, warehouseMatched: wh.rows.length - unmatched.filter(u => u.table === 'wh_items').length, inventory: inv.rows.length, inventoryMatched: inv.rows.length - unmatched.filter(u => u.table === 'inv_items').length, estSubcategories: estRes.count ?? 0, jmrItems: jmrRes.count ?? 0 },
    unmatched: unmatched.sort((a, b) => a.name.localeCompare(b.name)),
  }
}

// ── Stores ───────────────────────────────────────────────────────────────────

export interface StoreRow {
  key: string
  name: string
  code: string | null
  in4Id: number | null
  trust: string | null
  address: string | null
  isActive: boolean
  hubSources: string[]
  hubRefs: Array<{ table: 'wh_locations' | 'inv_warehouses'; id: string; name: string }>
  ownerProject: string | null
  keeper: string | null
  stockLines: number
}

export async function loadStores(): Promise<{ rows: StoreRow[]; in4Count: number; synced: boolean }> {
  const sb = await createClient()
  const [sRes, cRes, whRes, invRes, stockRes, projRes, profRes, pinned] = await Promise.all([
    sb.from('in4_stores').select('id, name, code, company_id, address, is_active').order('name'),
    sb.from('in4_companies').select('id, code'),
    sb.from('wh_locations').select('id, code, name, project_id, keeper_id, parent_id').is('deleted_at', null),
    sb.from('inv_warehouses').select('id, code, name, location').is('deleted_at', null),
    sb.from('wh_stock').select('location_id'),
    sb.from('projects').select('id, name'),
    sb.from('profiles').select('id, full_name, name, email'),
    links(sb, 'store'),
  ])
  const trust = new Map(((cRes.data ?? []) as Array<{ id: number; code: string | null }>).map(c => [c.id, c.code]))
  const projName = new Map(((projRes.data ?? []) as Array<{ id: string; name: string }>).map(p => [p.id, p.name]))
  const person = new Map(((profRes.data ?? []) as Array<Record<string, unknown>>).map(p => [p.id as string, (p.full_name as string) || (p.name as string) || (p.email as string) || '—']))
  const stock = new Map<string, number>()
  for (const s of (stockRes.data ?? []) as Array<{ location_id: string }>) stock.set(s.location_id, (stock.get(s.location_id) ?? 0) + 1)

  const rows = new Map<string, StoreRow>()
  const byName = new Map<string, string>()
  for (const s of (sRes.data ?? []) as Array<{ id: number; name: string; code: string | null; company_id: number | null; address: string | null; is_active: boolean }>) {
    const key = String(s.id)
    rows.set(key, { key, name: s.name, code: s.code, in4Id: s.id, trust: s.company_id ? trust.get(s.company_id) ?? null : null, address: s.address, isActive: s.is_active, hubSources: [], hubRefs: [], ownerProject: null, keeper: null, stockLines: 0 })
    byName.set(nameKey(s.name), key)
    // "Warehouse Vinay Vivek" ↔ hub "Vinay Vivek": also index without the word.
    byName.set(nameKey(s.name.replace(/^warehouse\s+/i, '')), key)
  }
  const attach = (table: 'wh_locations' | 'inv_warehouses', label: string, id: string, name: string, extra: Partial<StoreRow>) => {
    const pin = pinned.get(`${table}:${id}`)
    const key = (pin && rows.has(pin) ? pin : null) ?? byName.get(nameKey(name)) ?? byName.get(nameKey(name.replace(/^warehouse\s+/i, '')))
    if (key) {
      const r = rows.get(key)!
      if (!r.hubSources.includes(label)) r.hubSources.push(label)
      r.hubRefs.push({ table, id, name })
      Object.assign(r, Object.fromEntries(Object.entries(extra).filter(([, v]) => v != null && v !== 0)))
      return
    }
    const hubKey = `hub:${table}:${id}`
    rows.set(hubKey, { key: hubKey, name, code: null, in4Id: null, trust: null, address: null, isActive: true, hubSources: [label], hubRefs: [{ table, id, name }], ownerProject: null, keeper: null, stockLines: 0, ...extra })
  }
  for (const l of (whRes.data ?? []) as Array<Record<string, unknown>>) {
    if (l.parent_id) continue   // spots inside a site are not stores
    attach('wh_locations', 'Warehouse', l.id as string, String(l.name ?? ''), { code: (l.code as string | null) ?? null, ownerProject: l.project_id ? projName.get(l.project_id as string) ?? null : null, keeper: l.keeper_id ? person.get(l.keeper_id as string) ?? null : null, stockLines: stock.get(l.id as string) ?? 0 })
  }
  for (const w of (invRes.data ?? []) as Array<Record<string, unknown>>) {
    attach('inv_warehouses', 'Inventory (old)', w.id as string, String(w.name ?? ''), { ownerProject: (w.location as string | null) ?? null })
  }
  const out = [...rows.values()].sort((a, b) => a.name.localeCompare(b.name))
  return { rows: out, in4Count: sRes.data?.length ?? 0, synced: (sRes.data?.length ?? 0) > 0 }
}

// ── Trusts (paying companies) ────────────────────────────────────────────────

export interface TrustRow { id: number | null; code: string; name: string; projects: number; stores: number; workOrders: number; source: string }

export async function loadTrusts(): Promise<TrustRow[]> {
  const sb = await createClient()
  const [cRes, pRes, sRes, woRes] = await Promise.all([
    sb.from('in4_companies').select('id, name, code, print_name').order('id'),
    sb.from('in4_projects').select('cert_company_id'),
    sb.from('in4_stores').select('company_id'),
    sb.from('est_wo_history').select('wo_number'),
  ])
  const projects = new Map<number, number>(), stores = new Map<number, number>(), wos = new Map<string, number>()
  for (const p of (pRes.data ?? []) as Array<{ cert_company_id: number | null }>) if (p.cert_company_id) projects.set(p.cert_company_id, (projects.get(p.cert_company_id) ?? 0) + 1)
  for (const s of (sRes.data ?? []) as Array<{ company_id: number | null }>) if (s.company_id) stores.set(s.company_id, (stores.get(s.company_id) ?? 0) + 1)
  for (const r of (woRes.data ?? []) as Array<{ wo_number: string | null }>) {
    const code = (r.wo_number ?? '').startsWith('WO/') ? r.wo_number!.split('/')[1]?.trim() : ''
    if (code) wos.set(code, (wos.get(code) ?? 0) + 1)
  }
  const rows: TrustRow[] = ((cRes.data ?? []) as Array<{ id: number; name: string; code: string | null; print_name: string | null }>).map(c => ({
    id: c.id, code: c.code ?? String(c.id), name: c.print_name ?? c.name, projects: projects.get(c.id) ?? 0, stores: stores.get(c.id) ?? 0, workOrders: wos.get(c.code ?? '') ?? 0, source: 'IN4 paying company',
  }))
  // Codes seen in WO numbers that IN4's company table does not carry.
  for (const [code, n] of wos) if (!rows.some(r => r.code === code)) rows.push({ id: null, code, name: '(only seen in WO numbers)', projects: 0, stores: 0, workOrders: n, source: 'Read from the WO number' })
  return rows
}

// ── Projects ─────────────────────────────────────────────────────────────────

export interface ProjectMasterRow {
  id: string
  code: string | null
  name: string
  parent: string | null
  builtUpSft: number | null
  startDate: string | null
  targetDate: string | null
  projectType: string | null
  hasPm: boolean
  filled: number
  in4: { subprojects: string[]; exCodes: string[]; areaFt: number | null; budget: number | null } | null
}

export async function loadProjectMaster(): Promise<{ rows: ProjectMasterRow[]; in4Unmapped: Array<{ id: number; name: string; exCode: string | null }> }> {
  const sb = await createClient()
  const [pRes, aRes, spRes] = await Promise.all([
    sb.from('projects').select('id, code, name, parent_project_id, built_up_sft, start_date, target_completion, project_type, pm_user_id').is('archived_at', null).order('code'),
    sb.from('project_aliases').select('alias_norm, project_id').eq('source', 'in4'),
    sb.from('in4_subprojects').select('id, name, ex_code, construction_area_ft, budget, is_active').eq('is_active', true),
  ])
  type SP = { id: number; name: string; ex_code: string | null; construction_area_ft: number | null; budget: number | null }
  const aliasToProject = new Map(((aRes.data ?? []) as Array<{ alias_norm: string; project_id: string | null }>).map(a => [a.alias_norm, a.project_id]))
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const spByProject = new Map<string, SP[]>()
  const unmapped: Array<{ id: number; name: string; exCode: string | null }> = []
  for (const sp of (spRes.data ?? []) as SP[]) {
    const pid = aliasToProject.get(norm(sp.name)) ?? (sp.ex_code ? aliasToProject.get(norm(sp.ex_code)) : undefined)
    if (pid) { const l = spByProject.get(pid); if (l) l.push(sp); else spByProject.set(pid, [sp]) }
    else if (pid === undefined) unmapped.push({ id: sp.id, name: sp.name, exCode: sp.ex_code })
    // pid === null → deliberately not ours (see project_aliases.why)
  }
  const rows = (pRes.data ?? []) as Array<Record<string, unknown>>
  const nameById = new Map(rows.map(r => [r.id as string, r.name as string]))
  const out = rows.map(r => {
    const builtUpSft = r.built_up_sft != null ? Number(r.built_up_sft) : null
    const hasPm = !!r.pm_user_id
    const filled = [r.code, builtUpSft, r.start_date, r.target_completion, r.project_type, hasPm || null].filter(Boolean).length
    const sps = spByProject.get(r.id as string) ?? []
    const areaFt = sps.reduce((s, x) => s + (x.construction_area_ft ?? 0), 0) || null
    const budget = sps.reduce((s, x) => s + (x.budget ?? 0), 0) || null
    return {
      id: r.id as string, code: (r.code as string | null) ?? null, name: r.name as string,
      parent: r.parent_project_id ? nameById.get(r.parent_project_id as string) ?? null : null,
      builtUpSft, startDate: (r.start_date as string | null) ?? null, targetDate: (r.target_completion as string | null) ?? null,
      projectType: (r.project_type as string | null) ?? null, hasPm, filled: Math.round((filled / 6) * 100),
      in4: sps.length ? { subprojects: sps.map(s => s.name), exCodes: sps.map(s => s.ex_code).filter((x): x is string => !!x), areaFt, budget } : null,
    }
  })
  return { rows: out, in4Unmapped: unmapped.sort((a, b) => a.name.localeCompare(b.name)) }
}

// ── Work categories ──────────────────────────────────────────────────────────

export interface CategoryRow { code: string; hubName: string | null; in4Name: string | null; level: 'category' | 'sub-skill'; parentCode: string | null; state: 'both' | 'hub-only' | 'in4-only' | 'name-differs'; in4Duplicates?: string[] }

export async function loadCategories(): Promise<{ rows: CategoryRow[]; synced: boolean }> {
  const sb = await createClient()
  const [dRes, sRes, kRes] = await Promise.all([
    sb.from('cc_disciplines').select('id, code, name, is_archived'),
    sb.from('cc_sub_skills').select('id, discipline_id, code, name, is_archived'),
    sb.from('in4_skills').select('id, name, code, parent_id, is_active'),
  ])
  type K = { id: number; name: string; code: string | null; parent_id: number; is_active: boolean }
  const skills = ((kRes.data ?? []) as K[]).filter(k => k.is_active)
  const skillById = new Map(skills.map(k => [k.id, k]))
  const clean = (name: string) => name.replace(/^\s*\S+\s+/, '').trim()   // drop the numeric prefix
  const rows = new Map<string, CategoryRow>()
  const disc = ((dRes.data ?? []) as Array<{ id: string; code: string; name: string; is_archived: boolean }>).filter(d => !d.is_archived)
  const discById = new Map(disc.map(d => [d.id, d]))
  for (const d of disc) rows.set(`c:${d.code}`, { code: d.code, hubName: d.name, in4Name: null, level: 'category', parentCode: null, state: 'hub-only' })
  for (const s of ((sRes.data ?? []) as Array<{ id: string; discipline_id: string; code: string; name: string; is_archived: boolean }>).filter(s => !s.is_archived)) {
    rows.set(`s:${s.code}`, { code: s.code, hubName: s.name, in4Name: null, level: 'sub-skill', parentCode: discById.get(s.discipline_id)?.code ?? null, state: 'hub-only' })
  }
  for (const k of skills) {
    const level = k.parent_id === 0 ? 'category' : 'sub-skill'
    const code = k.code ?? ''
    if (!code) continue
    const key = `${level === 'category' ? 'c' : 's'}:${code}`
    const parentCode = level === 'sub-skill' ? (skillById.get(k.parent_id)?.code ?? null) : null
    const existing = rows.get(key)
    if (existing) {
      if (existing.in4Name) { (existing.in4Duplicates ??= []).push(k.name); continue }   // IN4 has two categories with the same code
      existing.in4Name = k.name
      existing.state = existing.hubName && nameKey(existing.hubName) === nameKey(clean(k.name)) ? 'both' : 'name-differs'
      existing.parentCode ??= parentCode
    } else {
      rows.set(key, { code, hubName: null, in4Name: k.name, level, parentCode, state: 'in4-only' })
    }
  }
  const out = [...rows.values()].sort((a, b) => (a.level === b.level ? 0 : a.level === 'category' ? -1 : 1) || a.code.localeCompare(b.code, undefined, { numeric: true }))
  return { rows: out, synced: skills.length > 0 }
}

// ── Overview ─────────────────────────────────────────────────────────────────

export interface MasterSummary {
  key: string
  label: string
  hint: string
  href: string
  /** Big number on the card. */
  total: number | null
  lines: Array<{ text: string; tone?: 'ok' | 'warn' | 'muted' }>
}

export async function loadMasterSummaries(): Promise<{ cards: MasterSummary[]; synced: boolean }> {
  const [contacts, items, stores, trusts, projects, categories] = await Promise.all([loadContacts(), loadItems(), loadStores(), loadTrusts(), loadProjectMaster(), loadCategories()])
  const synced = contacts.synced || items.synced
  const cards: MasterSummary[] = [
    { key: 'contacts', label: 'Contacts', href: '/admin/masters/contacts', hint: 'Contractors and suppliers — IN4’s register is the list', total: contacts.rows.length,
      lines: [
        { text: `${contacts.in4Count.toLocaleString('en-IN')} on IN4’s register (with PAN, GSTIN, address)`, tone: 'muted' },
        { text: `${contacts.matched} of the hub’s own entries match an IN4 party`, tone: 'ok' },
        { text: `${contacts.hubOnly} hub entries have no IN4 party behind them`, tone: contacts.hubOnly ? 'warn' : 'ok' },
      ] },
    { key: 'items', label: 'Items', href: '/admin/masters/items', hint: 'Materials — IN4’s catalogue, type → sub-type → item', total: items.in4Count,
      lines: [
        { text: `Warehouse: ${items.hub.warehouseMatched.toLocaleString('en-IN')} of ${items.hub.warehouse.toLocaleString('en-IN')} items match IN4`, tone: items.hub.warehouse - items.hub.warehouseMatched > 0 ? 'warn' : 'ok' },
        { text: `Inventory (old): ${items.hub.inventoryMatched} of ${items.hub.inventory} match IN4`, tone: 'muted' },
        { text: `Established Rates keeps ${items.hub.estSubcategories} sub-categories of its own; JMR ${items.hub.jmrItems} machine/manpower types`, tone: 'muted' },
      ] },
    { key: 'stores', label: 'Stores', href: '/admin/masters/stores', hint: 'Physical stores — IN4’s store list against the Warehouse’s', total: stores.rows.length,
      lines: [
        { text: `${stores.in4Count} stores in IN4`, tone: 'muted' },
        { text: `${stores.rows.filter(s => s.in4Id && s.hubSources.length).length} also set up in the Warehouse`, tone: 'ok' },
        { text: `${stores.rows.filter(s => !s.in4Id).length} Warehouse/Inventory stores IN4 does not know`, tone: stores.rows.some(s => !s.in4Id) ? 'warn' : 'ok' },
      ] },
    { key: 'trusts', label: 'Trusts', href: '/admin/masters/trusts', hint: 'The paying companies — from IN4, nothing typed', total: trusts.filter(t => t.id).length,
      lines: trusts.filter(t => t.id).map(t => ({ text: `${t.code} · ${t.projects} projects · ${t.stores} stores`, tone: 'muted' as const })) },
    { key: 'projects', label: 'Projects', href: '/admin/masters/projects', hint: 'The hub’s registry, with its IN4 sub-projects, area and budget beside it', total: projects.rows.length,
      lines: [
        { text: `${projects.rows.filter(p => p.in4).length} linked to IN4 sub-projects`, tone: 'ok' },
        { text: `${projects.rows.filter(p => !p.builtUpSft && p.in4?.areaFt).length} have no area in the hub but IN4 has it`, tone: projects.rows.some(p => !p.builtUpSft && p.in4?.areaFt) ? 'warn' : 'ok' },
        { text: `${projects.in4Unmapped.length} IN4 sub-projects not yet mapped to any hub project`, tone: projects.in4Unmapped.length ? 'warn' : 'ok' },
      ] },
    { key: 'categories', label: 'Work categories', href: '/admin/masters/categories', hint: 'Disciplines and sub-skills — the hub’s codes against IN4’s', total: categories.rows.length,
      lines: [
        { text: `${categories.rows.filter(r => r.state === 'both').length} agree on code and name`, tone: 'ok' },
        { text: `${categories.rows.filter(r => r.state === 'name-differs').length} same code, different name`, tone: categories.rows.some(r => r.state === 'name-differs') ? 'warn' : 'ok' },
        { text: `${categories.rows.filter(r => r.state === 'in4-only').length} in IN4 only · ${categories.rows.filter(r => r.state === 'hub-only').length} in the hub only`, tone: 'muted' },
      ] },
    { key: 'mapping', label: 'Project name mapping', href: '/admin/masters/mapping', hint: 'What IN4, the budget report, the procurement upload and Zoho call each project', total: null,
      lines: [{ text: 'Every spelling the other systems send, mapped to a hub project or marked not ours', tone: 'muted' }] },
  ]
  return { cards, synced }
}
