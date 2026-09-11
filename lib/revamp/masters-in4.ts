// The six Masters of Aksha's mind map — Trust, Project, Contact, Budget
// Categories, Item, BOQ — read from the system that already holds them.
//
// Aksha's rule for these screens: "don't build any blank". So every field the
// map names was first found in IN4 (9 Sep 2026, live) before a screen was
// drawn for it:
//   · Trust — COMMON.TBLCOMMONCOMPANY holds the four trusts with name, code,
//     PAN, e-mail, phone and the address in `Address` / `PrintAddress` (the
//     `CompanyAddress1/2` columns the print templates use are the empty
//     ones). GST registrations live in FIN_COMPANY_GSTIN_LOOKUP, each with
//     its registered address. SRASSK has none — checked in all 105 GSTIN
//     columns of the database — and the screen says so in words. Read from
//     the mirror since 11 Sep 2026.
//   · Project — ENGG_PROJECT (36) with site address, dates, certifying trust
//     and IN4's own status name; ENGG_SUBPROJECT (123) underneath.
//   · Contact — the mirror's in4_parties (423 contractors, 178 suppliers with
//     PAN, GSTIN, address, phone, e-mail, contact person, skills). IN4 has no
//     consultant master: a consultant is a contractor carrying a skill under
//     "18 Consultants Cost". The SRMD team is CT Hub's own users — IN4 holds
//     no staff list this login can read.
//   · Budget Categories — ENGG_SKILLS_LOOKUP (92 main, 369 sub), mirrored.
//   · Item — PURCH_MATERIAL_LOOKUP (4,041 with type, sub-type, unit; HSN on
//     7), mirrored.
//   · BOQ — IN4 has NO BOQ master table; BOQ items exist only inside work
//     orders. What it does hold is every item ever ordered, per category, so
//     that is what is shown, named as such: 1,415 BOQ names, 9,551
//     descriptions, with how often and at what rate each was used. Read from
//     the mirror since 11 Sep 2026 — see the in4_boq_items note below.
//
// Served from the mirror, which is in Mumbai with the app. The one read still
// going to IN4 live is the last purchase order behind an item, which the
// mirror has no copy of. Every IN4 read is a SELECT. Nothing writes.
// [[feedback_dont_guess_follow_the_source]]

import { createClient } from '@/lib/supabase/server'
import { in4QueryCached, in4Config } from '@/lib/in4/db'
import { fetchAll } from '@/lib/revamp/orders-tree'
import { getRoleLabels } from '@/lib/role-labels'
import type { Role } from '@/lib/types'

/** 'mirror' is not a failure. A screen served from the Supabase copy on
 *  purpose — because reaching us-east-1 on every page load cost half a second
 *  a query — says how fresh it is rather than warning about itself. */
export type In4State = 'live' | 'mirror' | 'not-configured' | 'unavailable'
export interface In4Read { in4: In4State; in4Error?: string }

const s = (v: unknown) => (v == null || String(v).trim() === '' ? null : String(v).trim())
const n = (v: unknown) => (v == null ? 0 : Number(v))
const iso = (v: unknown): string | null => {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(String(v))
  if (Number.isNaN(d.getTime())) return null
  const t = d.toISOString().slice(0, 10)
  // IN4 writes 1900-01-01 for "never set".
  return t.startsWith('1900-01-01') ? null : t
}
/** IN4 addresses carry line breaks and doubled commas; one tidy line. */
export function oneLine(v: unknown): string | null {
  const t = s(v)
  if (!t) return null
  return t.replace(/\s*[\r\n]+\s*/g, ', ').replace(/\s*,(\s*,)+/g, ',').replace(/\s+/g, ' ').replace(/[,\s]+$/, '').trim() || null
}

async function live<T>(fn: () => Promise<T>): Promise<{ data: T | null } & In4Read> {
  if (!in4Config()) return { data: null, in4: 'not-configured' }
  try {
    return { data: await fn(), in4: 'live' }
  } catch (e) {
    return { data: null, in4: 'unavailable', in4Error: e instanceof Error ? e.message : String(e) }
  }
}

/* ── Work-order counts from the mirror, shared by three masters ─────────── */

interface WoIndex {
  bySubproject: Map<number, number>
  byProject: Map<number, number>
  byCategory: Map<number, number>
  bySubcategory: Map<number, number>
  total: number
}

async function loadWoIndex(): Promise<WoIndex> {
  const supabase = await createClient()
  const [wos, subs] = await Promise.all([
    fetchAll<{ wo_id: number; subproject_id: number; category_id: number | null; subcategory_id: number | null }>(
      (f, t) => supabase.from('in4_work_orders').select('wo_id, subproject_id, category_id, subcategory_id').range(f, t)),
    fetchAll<{ id: number; project_id: number }>((f, t) => supabase.from('in4_subprojects').select('id, project_id').range(f, t)),
  ])
  const projectOf = new Map(subs.rows.map(r => [r.id, r.project_id]))
  const idx: WoIndex = { bySubproject: new Map(), byProject: new Map(), byCategory: new Map(), bySubcategory: new Map(), total: wos.rows.length }
  const bump = (m: Map<number, number>, k: number | null | undefined) => { if (k != null) m.set(k, (m.get(k) ?? 0) + 1) }
  for (const w of wos.rows) {
    bump(idx.bySubproject, w.subproject_id)
    bump(idx.byProject, projectOf.get(w.subproject_id))
    bump(idx.byCategory, w.category_id)
    bump(idx.bySubcategory, w.subcategory_id)
  }
  return idx
}

/* ── 1. Trust Master ────────────────────────────────────────────────────── */

export interface TrustGst { gstin: string; address: string | null; pin: string | null }
export interface TrustProject {
  id: number; name: string; code: string | null
  address: string | null; pin: string | null; city: string | null
  status: string | null; workOrders: number
}
export interface Trust {
  id: number; code: string; name: string
  address: string | null; printAddress: string | null
  pin: string | null; city: string | null; state: string | null
  email: string | null; phone: string | null; pan: string | null
  /** Every GST registration IN4 holds, with its registered address. Empty =
   *  IN4 holds none (SRASSK, SRMD Fixed Assets). */
  gst: TrustGst[]
  projects: TrustProject[]
  workOrders: number
}

/** The trusts, from the Supabase mirror.
 *
 * It used to make three live reads on every load — TBLCOMMONCOMPANY,
 * FIN_COMPANY_GSTIN_LOOKUP and ENGG_PROJECT — for 4 trusts, 2 GST
 * registrations and 36 projects. IN4 is an RDS in us-east-1 and this app runs
 * in Mumbai, so that was roughly half a second of ocean per query for 42 rows.
 *
 * The mirror already knew the trusts by name; what it lacked was the address,
 * PAN, contact details and the GST registrations, which is why the fallback
 * showed blanks and the live path stayed primary. It carries all of them now.
 */
export async function loadTrustMaster(): Promise<{ trusts: Trust[] } & In4Read> {
  const supabase = await createClient()
  const [wo, co, gst, pr] = await Promise.all([
    loadWoIndex(),
    supabase.from('in4_companies')
      .select('id, name, code, address, print_address, pin, print_pin, email, phone, pan, city, state')
      .eq('is_active', true).order('id'),
    supabase.from('in4_company_gstins').select('company_id, gstin, address, pincode').order('id'),
    supabase.from('in4_projects')
      .select('id, name, ex_code, cert_company_id, status_name, addr, pin, city')
      .order('name'),
  ])

  type CoRow = Record<string, unknown>
  const projects = (pr.data ?? []) as CoRow[]
  const gstins = (gst.data ?? []) as CoRow[]
  const trusts: Trust[] = ((co.data ?? []) as CoRow[]).map(c => {
    const id = n(c.id)
    // Buildings first: IN4 also files three placeholder "projects" named
    // after the trusts themselves, each with no work orders.
    const projs: TrustProject[] = projects.filter(p => n(p.cert_company_id) === id).map(p => ({
      id: n(p.id), name: s(p.name) ?? `Project ${p.id}`, code: s(p.ex_code),
      address: oneLine(p.addr), pin: s(p.pin), city: s(p.city), status: s(p.status_name),
      workOrders: wo.byProject.get(n(p.id)) ?? 0,
    })).sort((a, b) => b.workOrders - a.workOrders || a.name.localeCompare(b.name))
    return {
      id, code: s(c.code) ?? String(id), name: s(c.name) ?? '',
      address: oneLine(c.address), printAddress: oneLine(c.print_address),
      pin: s(c.pin) ?? s(c.print_pin), city: s(c.city), state: s(c.state),
      email: s(c.email), phone: s(c.phone), pan: s(c.pan),
      gst: gstins.filter(g => n(g.company_id) === id).map(g => ({ gstin: s(g.gstin) ?? '', address: oneLine(g.address), pin: s(g.pincode) })).filter(g => g.gstin),
      projects: projs,
      workOrders: projs.reduce((t, p) => t + p.workOrders, 0),
    }
  })
  return { trusts, in4: 'mirror' }
}

/* ── 2. Project Master ──────────────────────────────────────────────────── */

export interface SubProject {
  id: number; name: string; code: string | null
  start: string | null; end: string | null
  status: string | null; isActive: boolean
  workOrders: number
  /** CT Hub project(s) this IN4 sub-project feeds (via the BPH link). */
  hubProjects: string[]
}
export interface MainProject {
  id: number; name: string; code: string | null
  trustCode: string | null; trustName: string | null
  address: string | null; pin: string | null; city: string | null
  start: string | null; end: string | null; status: string | null
  workOrders: number
  subs: SubProject[]
  hubProjects: string[]
}

/** IN4 sub-project → CT Hub project names, through the two link tables the
 *  Budget tab already uses (in4_subproject_links → cc_bph_project_links →
 *  projects). */
async function loadHubLinks(): Promise<Map<number, string[]>> {
  const supabase = await createClient()
  const [sl, cl, pr] = await Promise.all([
    supabase.from('in4_subproject_links').select('subproject_id, bph_project_id'),
    supabase.from('cc_bph_project_links').select('bph_project_id, cc_project_id'),
    supabase.from('projects').select('id, name').is('archived_at', null),
  ])
  const name = new Map(((pr.data ?? []) as Array<{ id: string; name: string }>).map(p => [p.id, p.name]))
  const ccByBph = new Map<string, string[]>()
  for (const r of (cl.data ?? []) as Array<{ bph_project_id: string; cc_project_id: string }>) {
    const nm = name.get(r.cc_project_id)
    if (nm) ccByBph.set(r.bph_project_id, [...(ccByBph.get(r.bph_project_id) ?? []), nm])
  }
  const out = new Map<number, string[]>()
  for (const r of (sl.data ?? []) as Array<{ subproject_id: number; bph_project_id: string }>) {
    const names = ccByBph.get(r.bph_project_id) ?? []
    if (names.length) out.set(r.subproject_id, [...new Set([...(out.get(r.subproject_id) ?? []), ...names])])
  }
  return out
}

/**
 * Project Master, served entirely from the Supabase mirror.
 *
 * It used to read ENGG_PROJECT and ENGG_SUBPROJECT live, with this same
 * mirror as a fallback for when IN4 was unreachable. IN4 is an RDS in
 * us-east-1 and the app runs in Mumbai, so those two reads crossed the ocean
 * on every page load — measured at roughly half a second each of pure
 * network, with the query itself taking no time at all. Supabase is in
 * ap-south-1, the same city as the app.
 *
 * The fallback was only ever a fallback because the mirror lacked the plan
 * dates, the readable status and the site address — it showed those as blank.
 * The masters feed carries them now, so the fallback became the whole thing
 * and the live path is gone.
 */
export async function loadProjectMaster(): Promise<{ projects: MainProject[] } & In4Read> {
  const [wo, links] = await Promise.all([loadWoIndex(), loadHubLinks()])

  const subOf = (subs: Array<Record<string, unknown>>, projectId: number): SubProject[] =>
    subs.filter(x => n(x.PROJECT_ID ?? x.project_id) === projectId).map(x => ({
      id: n(x.ID ?? x.id), name: s(x.SUBPROJECT_NAME ?? x.name) ?? '', code: s(x.EX_CODE ?? x.ex_code),
      start: iso(x.ESTIMATED_START_DT ?? x.estimated_start_dt), end: iso(x.ESTIMATED_END_DT ?? x.estimated_end_dt),
      status: s(x.status ?? x.status_name), isActive: x.ISACTIVE == null ? (x.is_active as boolean ?? true) : Boolean(x.ISACTIVE),
      workOrders: wo.bySubproject.get(n(x.ID ?? x.id)) ?? 0,
      hubProjects: links.get(n(x.ID ?? x.id)) ?? [],
    }))

  const supabase = await createClient()
  const [pr, sp, co] = await Promise.all([
    supabase.from('in4_projects')
      .select('id, name, ex_code, cert_company_id, estimated_start_dt, estimated_end_dt, status_name, addr, pin, city')
      .order('name'),
    supabase.from('in4_subprojects')
      .select('id, project_id, name, ex_code, is_active, estimated_start_dt, estimated_end_dt, status_name')
      .order('name'),
    supabase.from('in4_companies').select('id, name, code'),
  ])
  const trust = new Map(((co.data ?? []) as Array<{ id: number; name: string; code: string | null }>).map(c => [c.id, c]))
  const projects: MainProject[] = ((pr.data ?? []) as Array<Record<string, unknown>>).map(p => {
    const subs = subOf((sp.data ?? []) as Array<Record<string, unknown>>, n(p.id))
    const t = trust.get(n(p.cert_company_id))
    return {
      id: n(p.id), name: s(p.name) ?? '', code: s(p.ex_code), trustCode: t?.code ?? null, trustName: t?.name ?? null,
      address: oneLine(p.addr), pin: s(p.pin), city: s(p.city),
      start: iso(p.estimated_start_dt), end: iso(p.estimated_end_dt), status: s(p.status_name),
      workOrders: wo.byProject.get(n(p.id)) ?? 0, subs, hubProjects: [...new Set(subs.flatMap(x => x.hubProjects))],
    }
  })
  return { projects, in4: 'mirror' }
}

/* ── 3. Contact Master ──────────────────────────────────────────────────── */

export interface Party {
  kind: 'contractor' | 'supplier'
  id: number; name: string; code: string | null
  pan: string | null; gstin: string | null
  address: string | null; city: string | null; state: string | null; pin: string | null
  phone: string | null; email: string | null; contactPerson: string | null
  isActive: boolean
  skills: string[]
  /** Other IN4 ids of the same kind carrying the same name — IN4 holds JANAK
   *  BHAVSAR as #223 and #225, UTTARA ADVANCE ENGINEERING as #162 and #163. */
  duplicateOf: number[]
  /** A GSTIN/PAN that is present but cannot be right (wrong shape). */
  gstinLooksWrong: boolean
  panLooksWrong: boolean
}
export interface TeamMember { id: string; name: string; email: string | null; role: string; roleLabel: string }

const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/
const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/
export const looksLikeGstin = (v: string | null) => v == null || GSTIN_RE.test(v.toUpperCase())
export const looksLikePan = (v: string | null) => v == null || PAN_RE.test(v.toUpperCase())
const nameKey = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Mark duplicates (same name, same kind) and malformed tax ids. Pure. */
export function flagParties<T extends Pick<Party, 'kind' | 'id' | 'name' | 'gstin' | 'pan'>>(parties: readonly T[]): Array<T & Pick<Party, 'duplicateOf' | 'gstinLooksWrong' | 'panLooksWrong'>> {
  const byKey = new Map<string, number[]>()
  for (const p of parties) { const k = `${p.kind}|${nameKey(p.name)}`; if (nameKey(p.name)) byKey.set(k, [...(byKey.get(k) ?? []), p.id]) }
  return parties.map(p => ({
    ...p,
    duplicateOf: (byKey.get(`${p.kind}|${nameKey(p.name)}`) ?? []).filter(id => id !== p.id),
    gstinLooksWrong: !looksLikeGstin(p.gstin),
    panLooksWrong: !looksLikePan(p.pan),
  }))
}

interface SkillRow { id: number; name: string; parent_id: number; is_active?: boolean; code?: string | null; short_name?: string | null }

/** The skill names that make a contractor a consultant: every main category
 *  whose name says "consultant" (IN4: "18 Consultants Cost") and everything
 *  under it. Pure. */
export function consultantSkillNames(skills: readonly SkillRow[]): Set<string> {
  const mains = skills.filter(k => k.parent_id === 0 && /consultant/i.test(k.name))
  const ids = new Set(mains.map(m => m.id))
  return new Set(skills.filter(k => ids.has(k.id) || ids.has(k.parent_id)).map(k => k.name))
}

/** Split IN4's two party lists into the map's three. A contractor with any
 *  consultant skill is a consultant and is NOT repeated under Contractors. */
export function splitParties(parties: readonly Party[], consultantSkills: Set<string>): { consultants: Party[]; contractors: Party[]; vendors: Party[] } {
  const byName = (a: Party, b: Party) => a.name.localeCompare(b.name)
  const isConsultant = (p: Party) => p.kind === 'contractor' && p.skills.some(k => consultantSkills.has(k))
  return {
    consultants: parties.filter(isConsultant).sort(byName),
    contractors: parties.filter(p => p.kind === 'contractor' && !isConsultant(p)).sort(byName),
    vendors: parties.filter(p => p.kind === 'supplier').sort(byName),
  }
}

export async function loadContactMaster(): Promise<{ team: TeamMember[]; consultants: Party[]; contractors: Party[]; vendors: Party[] }> {
  const supabase = await createClient()
  const [parties, skills, profiles, labels] = await Promise.all([
    fetchAll<Record<string, unknown>>((f, t) => supabase.from('in4_parties')
      .select('kind, id, name, code, pan, gstin, address, city, state, pin, phone, email, contact_person, is_active, skills').range(f, t)),
    supabase.from('in4_skills').select('id, name, parent_id'),
    supabase.from('profiles').select('id, full_name, name, email, role').order('full_name'),
    getRoleLabels(),
  ])
  const rows: Party[] = flagParties(parties.rows.map(p => ({
    kind: (p.kind === 'supplier' ? 'supplier' : 'contractor') as Party['kind'],
    id: n(p.id), name: s(p.name) ?? '', code: s(p.code), pan: s(p.pan), gstin: s(p.gstin),
    address: oneLine(p.address), city: s(p.city), state: s(p.state), pin: s(p.pin),
    phone: s(p.phone), email: s(p.email), contactPerson: s(p.contact_person),
    isActive: p.is_active !== false, skills: Array.isArray(p.skills) ? (p.skills as string[]) : [],
  })))
  // The SRMD team is CT Hub's users — minus contractor logins, who are not
  // the team and already appear under Contractors from IN4.
  const team: TeamMember[] = ((profiles.data ?? []) as Array<Record<string, unknown>>)
    .filter(u => s(u.role) !== 'contractor')
    .map(u => {
      const role = s(u.role) ?? 'viewer'
      return {
        id: String(u.id), name: s(u.full_name) ?? s(u.name) ?? s(u.email) ?? '—', email: s(u.email),
        role, roleLabel: labels[role as Role]?.label ?? role,
      }
    }).sort((a, b) => a.name.localeCompare(b.name))
  return { team, ...splitParties(rows, consultantSkillNames((skills.data ?? []) as SkillRow[])) }
}

/* ── 4. Budget Categories ───────────────────────────────────────────────── */

export interface Category {
  id: number; name: string; code: string | null; shortName: string | null
  isActive: boolean; workOrders: number; subs: Category[]
}

/** IN4's skills as a two-level tree: main (parent 0) → sub. Ordered by the
 *  numeric code IN4 puts in the name ("03 Civil"), then name. Pure. */
export function buildCategoryTree(skills: readonly SkillRow[], woByCategory: Map<number, number>, woBySub: Map<number, number>): Category[] {
  const codeNum = (k: SkillRow) => { const m = (k.code ?? k.name).match(/^\s*(\d+)/); return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER }
  const order = (a: SkillRow, b: SkillRow) => codeNum(a) - codeNum(b) || a.name.localeCompare(b.name)
  const toCat = (k: SkillRow, subs: Category[], wos: number): Category => ({
    id: k.id, name: k.name, code: k.code ?? null, shortName: k.short_name ?? null, isActive: k.is_active !== false, workOrders: wos, subs,
  })
  const real = skills.filter(k => k.id > 0)
  return real.filter(k => k.parent_id === 0).sort(order).map(m => toCat(
    m,
    real.filter(k => k.parent_id === m.id).sort(order).map(k => toCat(k, [], woBySub.get(k.id) ?? 0)),
    woByCategory.get(m.id) ?? 0,
  ))
}

export async function loadCategoryMaster(): Promise<{ mains: Category[]; counts: { mains: number; subs: number; active: number; inactive: number } }> {
  const supabase = await createClient()
  const [sk, wo] = await Promise.all([
    supabase.from('in4_skills').select('id, name, code, parent_id, short_name, is_active'),
    loadWoIndex(),
  ])
  const skills = (sk.data ?? []) as SkillRow[]
  const mains = buildCategoryTree(skills, wo.byCategory, wo.bySubcategory)
  const all = mains.flatMap(m => [m, ...m.subs])
  return {
    mains,
    counts: { mains: mains.length, subs: all.length - mains.length, active: all.filter(c => c.isActive).length, inactive: all.filter(c => !c.isActive).length },
  }
}

/* ── 5. Item Master ─────────────────────────────────────────────────────── */

export interface Item {
  id: number; name: string; code: string | null
  type: string | null; subtype: string | null; uom: string | null
  hsn: string | null; rate: number | null; isActive: boolean
}

export async function loadItemMaster(): Promise<{ items: Item[]; types: number; subtypes: number; withHsn: number; active: number }> {
  const supabase = await createClient()
  const { rows } = await fetchAll<Record<string, unknown>>((f, t) => supabase.from('in4_materials')
    .select('id, name, code, type_name, subtype_name, uom, hsn_code, rate, is_active').order('name').range(f, t))
  const items: Item[] = rows.map(m => ({
    id: n(m.id), name: s(m.name) ?? '', code: s(m.code), type: s(m.type_name), subtype: s(m.subtype_name),
    uom: s(m.uom), hsn: s(m.hsn_code), rate: m.rate == null ? null : Number(m.rate), isActive: m.is_active !== false,
  }))
  return {
    items,
    types: new Set(items.map(i => i.type).filter(Boolean)).size,
    subtypes: new Set(items.map(i => i.subtype).filter(Boolean)).size,
    withHsn: items.filter(i => i.hsn).length,
    active: items.filter(i => i.isActive).length,
  }
}

/* ── Where an item was last used — the order behind the master row ──────── */

/** The last WO (a BOQ item) or PO (a material) the thing appeared on — with what it cost and where, so a master row leads to a real document. Aksha, 10 Sep 2026: "linking to the last used WO or PO". */
export interface LastOrder {
  kind: 'wo' | 'po'
  id: number
  ref: string | null
  date: string | null
  /** Contractor (WO) or supplier (PO). */
  party: string | null
  rate: number | null
  qty: number | null
  /** IN4 project and sub-project; the CT Hub project when the sub-project is linked. */
  project: string | null
  subprojectId: number | null
  hubProjectId: string | null
}

/** IN4 sub-project → the CT Hub project id it is linked to (first when several). */
export async function loadHubProjectBySubproject(): Promise<Map<number, string>> {
  const supabase = await createClient()
  const [sl, cl] = await Promise.all([
    supabase.from('in4_subproject_links').select('subproject_id, bph_project_id'),
    supabase.from('cc_bph_project_links').select('bph_project_id, cc_project_id'),
  ])
  const ccByBph = new Map<string, string>()
  for (const r of (cl.data ?? []) as Array<{ bph_project_id: string; cc_project_id: string }>) if (!ccByBph.has(r.bph_project_id)) ccByBph.set(r.bph_project_id, r.cc_project_id)
  const out = new Map<number, string>()
  for (const r of (sl.data ?? []) as Array<{ subproject_id: number; bph_project_id: string }>) {
    const cc = ccByBph.get(r.bph_project_id)
    if (cc && !out.has(r.subproject_id)) out.set(r.subproject_id, cc)
  }
  return out
}

/** The links a LastOrder offers: the document in IN4's own format, the ledger (PO), and the project's WO / PO tab when linked. Pure. */
export function lastOrderLinks(o: LastOrder | null): Array<{ label: string; href: string; external?: boolean }> {
  if (!o) return []
  const links: Array<{ label: string; href: string; external?: boolean }> = o.kind === 'wo'
    ? [{ label: `WO ${shortDoc(o.ref)}`, href: `/api/in4/work-order/${o.id}/print`, external: true }]
    : [{ label: `PO ${shortDoc(o.ref)}`, href: `/api/in4/purchase-order/${o.id}/print`, external: true }, { label: 'Ledger', href: `/api/in4/purchase-order/${o.id}/ledger`, external: true }]
  if (o.hubProjectId) links.push({ label: 'In project', href: `/project/${o.hubProjectId}/wo-po?q=${encodeURIComponent(o.ref ?? '')}` })
  return links
}
const shortDoc = (ref: string | null) => String(ref ?? '').replace(/^(IND|PO|GRN|WO|DRAFT-PO)\/[A-Z0-9]+\//, '')

/** Last approved PO per material, one live query (ROW_NUMBER over IN4's PO facts). */
export async function loadLastPoByMaterial(): Promise<{ byMaterial: Map<number, LastOrder> } & In4Read> {
  const [r, hub] = await Promise.all([
    live(() => in4QueryCached<Record<string, unknown>>(`
      SELECT x.MATERIAL_ID, x.PO_ID, x.PO_NO, x.PO_DT, x.supplier, x.rate, x.qty, x.project, x.SUBPROJECT_ID
      FROM (
        SELECT f.MATERIAL_ID, f.PO_ID, h.PO_NO, h.PO_DT, COALESCE(sp.PrintName, sp.NAME) supplier, f.NET_RATE rate, f.BASE_PO_QTY qty, pr.NAME project, p.SUBPROJECT_ID,
               ROW_NUMBER() OVER (PARTITION BY f.MATERIAL_ID ORDER BY h.PO_DT DESC, f.PO_ID DESC) rn
        FROM BI.FACT_PURCHASE_ORDER_DETAILS f
        JOIN BI.PURCHASE_ORDER_HEADER h ON h.PO_ID = f.PO_ID
        LEFT JOIN PURCH_PURCHASE_ORDER p ON p.ID = f.PO_ID
        LEFT JOIN PURCH_SUPPLIER sp ON sp.ID = f.SUPPLIER_ID
        LEFT JOIN ENGG_PROJECT pr ON pr.ID = f.PROJECT_ID
        WHERE h.STATUS_ID = 2
      ) x WHERE x.rn = 1`)),
    loadHubProjectBySubproject(),
  ])
  if (!r.data) return { byMaterial: new Map(), in4: r.in4, in4Error: r.in4Error }
  const byMaterial = new Map<number, LastOrder>()
  for (const x of r.data) {
    const sub = x.SUBPROJECT_ID == null ? null : n(x.SUBPROJECT_ID)
    byMaterial.set(n(x.MATERIAL_ID), {
      kind: 'po', id: n(x.PO_ID), ref: s(x.PO_NO), date: iso(x.PO_DT), party: s(x.supplier),
      rate: x.rate == null ? null : Number(x.rate), qty: x.qty == null ? null : Number(x.qty),
      project: s(x.project), subprojectId: sub, hubProjectId: sub == null ? null : hub.get(sub) ?? null,
    })
  }
  return { byMaterial, in4: 'live' }
}

/* ── 6. BOQ Master (derived — IN4 has no BOQ master table) ─────────────── */

export interface BoqCategory { id: number; name: string; code: string | null; names: number; items: number; workOrders: number }
export interface BoqItem {
  subname: string | null; description: string | null; uom: string | null; subcategory: string | null
  workOrders: number; minRate: number | null; maxRate: number | null; lastUsed: string | null
  /** The last work order the item was on. */
  last: LastOrder | null
  /** On a search across categories: which category the item sits under. */
  category?: string | null
  name?: string | null
}

/** One row of the in4_boq_items RPC: an item's aggregate with, folded into the
 *  same row, the last work order it appeared on. IN4 needed two queries for
 *  that — a GROUP BY and a ROW_NUMBER() window — which the app stitched back
 *  together on a composite key. Postgres does both in one pass, so the key is
 *  gone, and so is the second crossing of the Atlantic. */
interface BoqRow {
  cat: number | null; name: string | null; subname: string | null; description: string | null
  uom: string | null; subcategory_id: number | null
  wos: number; min_rate: string | null; max_rate: string | null; last_used: string | null
  last_wo_id: number | null; last_ref: string | null; last_date: string | null; last_party: string | null
  last_rate: string | null; last_qty: string | null; last_project: string | null; last_subproject_id: number | null
}

/** Paged, always. Category 149 alone holds 1,807 items and PostgREST stops at
 *  1,000 without reporting anything. */
async function boqRows(args: Record<string, unknown>): Promise<{ rows: BoqRow[] } & In4Read> {
  const supabase = await createClient()
  const { rows, error } = await fetchAll<BoqRow>((from, to) => supabase.rpc('in4_boq_items', args).range(from, to))
  if (error) return { rows: [], in4: 'unavailable', in4Error: error }
  return { rows, in4: 'mirror' }
}

/** Postgres hands numerics back as strings; the screen wants a number or null. */
const num = (v: unknown) => (v == null ? null : Number(v))

function boqItem(x: BoqRow, names: Map<number, { name: string; code: string | null }>, hub: Map<number, string>): BoqItem {
  const sub = x.last_subproject_id
  return {
    subname: s(x.subname), description: s(x.description), uom: s(x.uom),
    subcategory: names.get(n(x.subcategory_id))?.name ?? null,
    workOrders: n(x.wos), minRate: num(x.min_rate), maxRate: num(x.max_rate),
    lastUsed: iso(x.last_used),
    last: x.last_wo_id == null ? null : {
      kind: 'wo', id: x.last_wo_id, ref: s(x.last_ref), date: iso(x.last_date), party: s(x.last_party),
      rate: num(x.last_rate), qty: num(x.last_qty),
      project: s(x.last_project), subprojectId: sub, hubProjectId: sub == null ? null : hub.get(sub) ?? null,
    },
  }
}

/** BOQ items across every category whose name, sub-name or description contains the words — each with its last work order. */
export async function loadBoqSearch(q: string): Promise<{ items: BoqItem[]; capped: boolean } & In4Read> {
  const needle = q.trim()
  if (!needle) return { items: [], capped: false, in4: 'mirror' }
  const [r, names, hub] = await Promise.all([
    boqRows({ p_q: needle, p_limit: 300 }),
    skillNames(),
    loadHubProjectBySubproject(),
  ])
  if (r.in4 !== 'mirror') return { items: [], capped: false, in4: r.in4, in4Error: r.in4Error }
  const items: BoqItem[] = r.rows.map(x => ({
    ...boqItem(x, names, hub),
    name: s(x.name), category: names.get(n(x.cat))?.name ?? null,
  }))
  return { items, capped: items.length >= 300, in4: 'mirror' }
}
export interface BoqGroup { name: string; items: BoqItem[]; workOrders: number }

async function skillNames(): Promise<Map<number, { name: string; code: string | null }>> {
  const supabase = await createClient()
  const { data } = await supabase.from('in4_skills').select('id, name, code')
  return new Map(((data ?? []) as Array<{ id: number; name: string; code: string | null }>).map(k => [k.id, { name: k.name, code: k.code }]))
}

const NO_CATEGORY = { name: '(no category on the work order)', code: null }

export async function loadBoqOverview(): Promise<{ categories: BoqCategory[]; totals: { names: number; items: number; workOrders: number } } & In4Read> {
  const supabase = await createClient()
  const [r, names] = await Promise.all([supabase.rpc('in4_boq_overview'), skillNames()])
  if (r.error) return { categories: [], totals: { names: 0, items: 0, workOrders: 0 }, in4: 'unavailable', in4Error: r.error.message }
  const categories: BoqCategory[] = ((r.data ?? []) as Array<Record<string, unknown>>).map(x => {
    const id = n(x.cat)
    const k = names.get(id) ?? NO_CATEGORY
    return { id, name: k.name, code: k.code, names: n(x.names), items: n(x.items), workOrders: n(x.wos) }
  }).sort((a, b) => b.items - a.items)
  return {
    categories,
    totals: {
      names: categories.reduce((t, c) => t + c.names, 0),
      items: categories.reduce((t, c) => t + c.items, 0),
      workOrders: categories.reduce((t, c) => t + c.workOrders, 0),
    },
    in4: 'mirror',
  }
}

export async function loadBoqCategory(categoryId: number): Promise<{ category: BoqCategory | null; groups: BoqGroup[] } & In4Read> {
  if (!Number.isInteger(categoryId) || categoryId < 0) return { category: null, groups: [], in4: 'mirror' }
  const [r, names, hub] = await Promise.all([
    boqRows({ p_category_id: categoryId }),
    skillNames(),
    loadHubProjectBySubproject(),
  ])
  if (r.in4 !== 'mirror') return { category: null, groups: [], in4: r.in4, in4Error: r.in4Error }
  const k = names.get(categoryId) ?? NO_CATEGORY
  const groups = new Map<string, BoqGroup>()
  for (const x of r.rows) {
    const name = s(x.name) ?? '(no BOQ name)'
    const g = groups.get(name) ?? { name, items: [], workOrders: 0 }
    g.items.push(boqItem(x, names, hub))
    g.workOrders = Math.max(g.workOrders, n(x.wos))
    groups.set(name, g)
  }
  const list = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  const items = list.reduce((t, g) => t + g.items.length, 0)
  return {
    category: { id: categoryId, name: k.name, code: k.code, names: list.length, items, workOrders: Math.max(0, ...list.map(g => g.workOrders)) },
    groups: list,
    in4: 'mirror',
  }
}

/* ── Search across all six ──────────────────────────────────────────────── */

export interface SearchHit { master: string; label: string; sub: string | null; href: string }
export interface SearchResult { q: string; groups: Array<{ master: string; hits: SearchHit[]; more: number }> }

/** Case- and punctuation-insensitive "contains". Pure. */
export function matchesQuery(q: string, ...fields: Array<string | null | undefined>): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return false
  return fields.some(f => f != null && f.toLowerCase().includes(needle))
}

const LIMIT = 15

/** One search over trusts, projects, contacts, categories, items and BOQ
 *  names, each hit linking to its screen with the search already typed. */
export async function loadMasterSearch(q: string): Promise<SearchResult & In4Read> {
  const needle = q.trim()
  if (!needle) return { q: needle, groups: [], in4: 'mirror' }
  const enc = encodeURIComponent(needle)
  const supabase = await createClient()
  const [co, pr, sp, sk, mat, contacts, boq] = await Promise.all([
    supabase.from('in4_companies').select('id, name, code'),
    supabase.from('in4_projects').select('id, name, ex_code'),
    supabase.from('in4_subprojects').select('id, name, ex_code, project_id'),
    supabase.from('in4_skills').select('id, name, code, parent_id'),
    supabase.from('in4_materials').select('id, name, code, type_name').or(`name.ilike.%${needle.replace(/[%,()]/g, '')}%,code.ilike.%${needle.replace(/[%,()]/g, '')}%`).limit(LIMIT + 1),
    loadContactMaster(),
    supabase.rpc('in4_boq_name_search', { p_q: needle, p_limit: LIMIT + 1 }),
  ])
  const group = (master: string, all: SearchHit[]) => ({ master, hits: all.slice(0, LIMIT), more: Math.max(0, all.length - LIMIT) })
  const trusts = ((co.data ?? []) as Array<{ id: number; name: string; code: string | null }>)
    .filter(c => matchesQuery(needle, c.name, c.code))
    .map(c => ({ master: 'Trusts', label: c.name, sub: c.code, href: '/masters/trusts' }))
  const projName = new Map(((pr.data ?? []) as Array<{ id: number; name: string }>).map(p => [p.id, p.name]))
  const projects = [
    ...((pr.data ?? []) as Array<{ id: number; name: string; ex_code: string | null }>).filter(p => matchesQuery(needle, p.name, p.ex_code))
      .map(p => ({ master: 'Projects', label: p.name, sub: p.ex_code, href: `/masters/projects?q=${enc}#p-${p.id}` })),
    ...((sp.data ?? []) as Array<{ id: number; name: string; ex_code: string | null; project_id: number }>).filter(x => matchesQuery(needle, x.name, x.ex_code))
      .map(x => ({ master: 'Projects', label: x.name, sub: `sub-project of ${projName.get(x.project_id) ?? '?'}${x.ex_code ? ` · ${x.ex_code}` : ''}`, href: `/masters/projects?q=${enc}` })),
  ]
  const people: SearchHit[] = [
    ...contacts.team.filter(u => matchesQuery(needle, u.name, u.email)).map(u => ({ master: 'Contacts', label: u.name, sub: `SRMD team · ${u.roleLabel}`, href: `/masters/contacts?q=${enc}` })),
    ...(['consultants', 'vendors', 'contractors'] as const).flatMap(g => contacts[g]
      .filter(p => matchesQuery(needle, p.name, p.pan, p.gstin, p.phone, p.email, p.contactPerson, p.city))
      .map(p => ({ master: 'Contacts', label: p.name, sub: `${g === 'vendors' ? 'Vendor' : g === 'consultants' ? 'Consultant' : 'Contractor'}${p.city ? ` · ${p.city}` : ''}${p.gstin ? ` · ${p.gstin}` : ''}`, href: `/masters/contacts?group=${g}&q=${enc}` }))),
  ]
  const skills = (sk.data ?? []) as Array<{ id: number; name: string; code: string | null; parent_id: number }>
  const skillName = new Map(skills.map(k => [k.id, k.name]))
  const categories = skills.filter(k => k.id > 0 && matchesQuery(needle, k.name, k.code))
    .map(k => ({ master: 'Budget categories', label: k.name, sub: k.parent_id ? `under ${skillName.get(k.parent_id) ?? '?'}` : 'main category', href: `/masters/categories?q=${enc}` }))
  const items = ((mat.data ?? []) as Array<{ id: number; name: string; code: string | null; type_name: string | null }>)
    .map(m => ({ master: 'Items', label: m.name, sub: [m.code, m.type_name].filter(Boolean).join(' · ') || null, href: `/masters/items?q=${enc}` }))
  const boqHits = ((boq.data ?? []) as Array<Record<string, unknown>>).map(b => ({ master: 'BOQ', label: s(b.boq_name) ?? '', sub: `${skillName.get(n(b.cat)) ?? 'no category'} · used in ${n(b.n)} WO${n(b.n) === 1 ? '' : 's'}`, href: `/masters/boq?cat=${n(b.cat)}&q=${enc}` }))
  const groups = [
    group('Trusts', trusts), group('Projects', projects), group('Contacts', people),
    group('Budget categories', categories), group('Items', items), group('BOQ', boqHits),
  ].filter(g => g.hits.length > 0)
  return { q: needle, groups, in4: boq.error ? 'unavailable' : 'mirror', in4Error: boq.error?.message }
}

/** When the IN4 mirror last finished a sync — the freshness of every mirror-fed
 *  number on these screens. */
export async function lastMirrorSync(): Promise<string | null> {
  const supabase = await createClient()
  const { data } = await supabase.from('in4_sync_runs').select('finished_at').eq('ok', true).order('finished_at', { ascending: false }).limit(1)
  const v = (data?.[0] as { finished_at: string | null } | undefined)?.finished_at
  return v ?? null
}

/* ── The landing page: one card per master, with real counts ───────────── */

export interface MasterCard {
  key: string; label: string; href: string; hint: string
  total: number | null
  /** Two or three facts under the number, each already a sentence fragment. */
  facts: string[]
}

export async function loadMasterOverview(): Promise<{ cards: MasterCard[] } & In4Read> {
  const supabase = await createClient()
  const count = (table: string, filter?: (q: ReturnType<ReturnType<typeof supabase.from>['select']>) => unknown) => {
    const q = supabase.from(table).select('id', { count: 'exact', head: true })
    if (filter) filter(q as never)
    return q
  }
  const [co, pr, sp, mat, hsn, sk, skIn, team, contacts, boq] = await Promise.all([
    supabase.from('in4_companies').select('id', { count: 'exact', head: true }).eq('is_active', true),
    count('in4_projects'),
    count('in4_subprojects'),
    count('in4_materials'),
    supabase.from('in4_materials').select('id', { count: 'exact', head: true }).not('hsn_code', 'is', null),
    count('in4_skills'),
    supabase.from('in4_skills').select('id', { count: 'exact', head: true }).eq('is_active', false),
    count('profiles'),
    loadContactMaster(),
    supabase.rpc('in4_boq_totals'),
  ])
  const skillsTotal = (sk.count ?? 0) - 1 // minus IN4's "-1 Sub Project Milestone" pseudo-skill
  const boqRow = ((boq.data ?? []) as Array<Record<string, unknown>>)[0]
  const cards: MasterCard[] = [
    { key: 'trusts', label: 'Trust Master', href: '/masters/trusts', hint: 'Name, address, GST and PAN of each trust, and the projects it pays for',
      total: co.count ?? 0, facts: ['From IN4’s company register', 'GST registrations with their registered address'] },
    { key: 'projects', label: 'Project Master', href: '/masters/projects', hint: 'Main projects and their sub-projects, with start and end dates',
      total: pr.count ?? 0, facts: [`${(sp.count ?? 0).toLocaleString('en-IN')} sub-projects`, 'Site address and paying trust on each'] },
    { key: 'contacts', label: 'Contact Master', href: '/masters/contacts', hint: 'SRMD team, consultants, vendors and contractors',
      total: (team.count ?? 0) + contacts.consultants.length + contacts.vendors.length + contacts.contractors.length,
      facts: [`${team.count ?? 0} team · ${contacts.consultants.length} consultants · ${contacts.vendors.length} vendors · ${contacts.contractors.length} contractors`, 'PAN, GST, address, phone and e-mail from IN4'] },
    { key: 'categories', label: 'Budget Categories', href: '/masters/categories', hint: 'Main categories and their sub-categories, as IN4 budgets and orders use them',
      total: skillsTotal, facts: [`${(skIn.count ?? 0).toLocaleString('en-IN')} marked inactive in IN4`, 'Work orders counted against each'] },
    { key: 'items', label: 'Item Master', href: '/masters/items', hint: 'Every material, with its type, sub-type and unit',
      total: mat.count ?? 0, facts: [`HSN code on ${hsn.count ?? 0}`, 'From IN4’s material register'] },
    { key: 'boq', label: 'BOQ Master', href: '/masters/boq', hint: 'Every BOQ item ever ordered, by category, with how often and at what rate',
      total: boqRow ? n(boqRow.items) : null,
      facts: boqRow ? [`${n(boqRow.names).toLocaleString('en-IN')} BOQ names`, 'Built from IN4’s work orders — IN4 keeps no separate BOQ master'] : ['Counted from the IN4 mirror'] },
  ]
  return { cards, in4: boq.error ? 'unavailable' : 'mirror', in4Error: boq.error?.message }
}
