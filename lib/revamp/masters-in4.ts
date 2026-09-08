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
//     columns of the database — and the screen says so in words.
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
//     that is what is shown, named as such: 1,388 BOQ names, 7,286
//     descriptions, with how often and at what rate each was used.
//
// Live IN4 where the mirror lacks the field (addresses, dates, GST, BOQ);
// the mirror where it has it. Every IN4 read is a SELECT. Nothing writes.
// [[feedback_dont_guess_follow_the_source]]

import { createClient } from '@/lib/supabase/server'
import { in4Query, in4Config } from '@/lib/in4/db'
import { fetchAll } from '@/lib/revamp/orders-tree'
import { getRoleLabels } from '@/lib/role-labels'
import type { Role } from '@/lib/types'

export type In4State = 'live' | 'not-configured' | 'unavailable'
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

export async function loadTrustMaster(): Promise<{ trusts: Trust[] } & In4Read> {
  const [r, wo] = await Promise.all([
    live(async () => {
      const [companies, gst, projects] = await Promise.all([
        in4Query<Record<string, unknown>>(`
          SELECT co.CompanyID, co.CompanyCode, co.CompanyName, co.Address, co.PrintAddress,
                 co.CompanyPinCode, co.PrintPinCode, co.CompanyEmail, co.CompanyContactNo, co.PANNumber,
                 cl.NAME city, cst.NAME state
          FROM COMMON.TBLCOMMONCOMPANY co
          LEFT JOIN COMMON_LOCATION_LOOKUP cl ON cl.ID = co.LocationID
          LEFT JOIN COMMON_STATE_LOOKUP cst ON cst.ID = co.StateID
          WHERE co.Active = 1
          ORDER BY co.CompanyID`),
        in4Query<Record<string, unknown>>(`SELECT COMPANY_ID, GSTIN_NO, Address, Pincode FROM FIN_COMPANY_GSTIN_LOOKUP ORDER BY ID`),
        in4Query<Record<string, unknown>>(`
          SELECT p.ID, p.NAME, p.EX_CODE, p.CERT_COMPANY_ID, st.NAME status, a.ADDR, a.PIN, l.NAME city
          FROM ENGG_PROJECT p
          LEFT JOIN COMMON_ADDRESS a ON a.ID = TRY_CAST(p.ADDR_ID AS int)
          LEFT JOIN COMMON_LOCATION_LOOKUP l ON l.ID = a.LOCATION_ID
          LEFT JOIN COMMON_STATUS_LOOKUP st ON st.ID = p.STATUS
          ORDER BY p.NAME`),
      ])
      return { companies, gst, projects }
    }),
    loadWoIndex(),
  ])

  if (r.data) {
    const { companies, gst, projects } = r.data
    const trusts: Trust[] = companies.map(c => {
      const id = n(c.CompanyID)
      const projs: TrustProject[] = projects.filter(p => n(p.CERT_COMPANY_ID) === id).map(p => ({
        id: n(p.ID), name: s(p.NAME) ?? `Project ${p.ID}`, code: s(p.EX_CODE),
        address: oneLine(p.ADDR), pin: s(p.PIN), city: s(p.city), status: s(p.status),
        workOrders: wo.byProject.get(n(p.ID)) ?? 0,
      }))
      return {
        id, code: s(c.CompanyCode) ?? String(id), name: s(c.CompanyName) ?? '',
        address: oneLine(c.Address), printAddress: oneLine(c.PrintAddress),
        pin: s(c.CompanyPinCode) ?? s(c.PrintPinCode), city: s(c.city), state: s(c.state),
        email: s(c.CompanyEmail), phone: s(c.CompanyContactNo), pan: s(c.PANNumber),
        gst: gst.filter(g => n(g.COMPANY_ID) === id).map(g => ({ gstin: s(g.GSTIN_NO) ?? '', address: oneLine(g.Address), pin: s(g.Pincode) })).filter(g => g.gstin),
        projects: projs,
        workOrders: projs.reduce((t, p) => t + p.workOrders, 0),
      }
    })
    return { trusts, in4: 'live' }
  }

  // IN4 not reachable: the mirror knows the trusts and their projects by name.
  const supabase = await createClient()
  const [co, pr] = await Promise.all([
    supabase.from('in4_companies').select('id, name, code').order('id'),
    supabase.from('in4_projects').select('id, name, ex_code, cert_company_id').order('name'),
  ])
  const trusts: Trust[] = ((co.data ?? []) as Array<{ id: number; name: string; code: string | null }>).map(c => {
    const projs = ((pr.data ?? []) as Array<{ id: number; name: string; ex_code: string | null; cert_company_id: number | null }>)
      .filter(p => p.cert_company_id === c.id)
      .map(p => ({ id: p.id, name: p.name, code: p.ex_code, address: null, pin: null, city: null, status: null, workOrders: wo.byProject.get(p.id) ?? 0 }))
    return {
      id: c.id, code: c.code ?? String(c.id), name: c.name, address: null, printAddress: null, pin: null, city: null, state: null,
      email: null, phone: null, pan: null, gst: [], projects: projs, workOrders: projs.reduce((t, p) => t + p.workOrders, 0),
    }
  })
  return { trusts, in4: r.in4, in4Error: r.in4Error }
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

export async function loadProjectMaster(): Promise<{ projects: MainProject[] } & In4Read> {
  const [r, wo, links] = await Promise.all([
    live(async () => {
      const [projects, subs] = await Promise.all([
        in4Query<Record<string, unknown>>(`
          SELECT p.ID, p.NAME, p.EX_CODE, p.ESTIMATED_START_DT, p.ESTIMATED_END_DT, st.NAME status,
                 co.CompanyCode trust_code, co.CompanyName trust_name, a.ADDR, a.PIN, l.NAME city
          FROM ENGG_PROJECT p
          LEFT JOIN COMMON.TBLCOMMONCOMPANY co ON co.CompanyID = p.CERT_COMPANY_ID
          LEFT JOIN COMMON_ADDRESS a ON a.ID = TRY_CAST(p.ADDR_ID AS int)
          LEFT JOIN COMMON_LOCATION_LOOKUP l ON l.ID = a.LOCATION_ID
          LEFT JOIN COMMON_STATUS_LOOKUP st ON st.ID = p.STATUS
          ORDER BY p.NAME`),
        in4Query<Record<string, unknown>>(`
          SELECT sp.ID, sp.PROJECT_ID, sp.SUBPROJECT_NAME, sp.EX_CODE, sp.ESTIMATED_START_DT, sp.ESTIMATED_END_DT,
                 sp.ISACTIVE, st.NAME status
          FROM ENGG_SUBPROJECT sp
          LEFT JOIN COMMON_STATUS_LOOKUP st ON st.ID = sp.STATUS
          ORDER BY sp.SUBPROJECT_NAME`),
      ])
      return { projects, subs }
    }),
    loadWoIndex(),
    loadHubLinks(),
  ])

  const subOf = (subs: Array<Record<string, unknown>>, projectId: number): SubProject[] =>
    subs.filter(x => n(x.PROJECT_ID ?? x.project_id) === projectId).map(x => ({
      id: n(x.ID ?? x.id), name: s(x.SUBPROJECT_NAME ?? x.name) ?? '', code: s(x.EX_CODE ?? x.ex_code),
      start: iso(x.ESTIMATED_START_DT), end: iso(x.ESTIMATED_END_DT),
      status: s(x.status), isActive: x.ISACTIVE == null ? (x.is_active as boolean ?? true) : Boolean(x.ISACTIVE),
      workOrders: wo.bySubproject.get(n(x.ID ?? x.id)) ?? 0,
      hubProjects: links.get(n(x.ID ?? x.id)) ?? [],
    }))

  if (r.data) {
    const projects: MainProject[] = r.data.projects.map(p => {
      const subs = subOf(r.data!.subs, n(p.ID))
      return {
        id: n(p.ID), name: s(p.NAME) ?? '', code: s(p.EX_CODE),
        trustCode: s(p.trust_code), trustName: s(p.trust_name),
        address: oneLine(p.ADDR), pin: s(p.PIN), city: s(p.city),
        start: iso(p.ESTIMATED_START_DT), end: iso(p.ESTIMATED_END_DT), status: s(p.status),
        workOrders: wo.byProject.get(n(p.ID)) ?? 0,
        subs, hubProjects: [...new Set(subs.flatMap(x => x.hubProjects))],
      }
    })
    return { projects, in4: 'live' }
  }

  const supabase = await createClient()
  const [pr, sp, co] = await Promise.all([
    supabase.from('in4_projects').select('id, name, ex_code, cert_company_id').order('name'),
    supabase.from('in4_subprojects').select('id, project_id, name, ex_code, is_active').order('name'),
    supabase.from('in4_companies').select('id, name, code'),
  ])
  const trust = new Map(((co.data ?? []) as Array<{ id: number; name: string; code: string | null }>).map(c => [c.id, c]))
  const projects: MainProject[] = ((pr.data ?? []) as Array<Record<string, unknown>>).map(p => {
    const subs = subOf((sp.data ?? []) as Array<Record<string, unknown>>, n(p.id))
    const t = trust.get(n(p.cert_company_id))
    return {
      id: n(p.id), name: s(p.name) ?? '', code: s(p.ex_code), trustCode: t?.code ?? null, trustName: t?.name ?? null,
      address: null, pin: null, city: null, start: null, end: null, status: null,
      workOrders: wo.byProject.get(n(p.id)) ?? 0, subs, hubProjects: [...new Set(subs.flatMap(x => x.hubProjects))],
    }
  })
  return { projects, in4: r.in4, in4Error: r.in4Error }
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
}
export interface TeamMember { id: string; name: string; email: string | null; role: string; roleLabel: string }

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
  const rows: Party[] = parties.rows.map(p => ({
    kind: p.kind === 'supplier' ? 'supplier' : 'contractor',
    id: n(p.id), name: s(p.name) ?? '', code: s(p.code), pan: s(p.pan), gstin: s(p.gstin),
    address: oneLine(p.address), city: s(p.city), state: s(p.state), pin: s(p.pin),
    phone: s(p.phone), email: s(p.email), contactPerson: s(p.contact_person),
    isActive: p.is_active !== false, skills: Array.isArray(p.skills) ? (p.skills as string[]) : [],
  }))
  const team: TeamMember[] = ((profiles.data ?? []) as Array<Record<string, unknown>>).map(u => {
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

/* ── 6. BOQ Master (derived — IN4 has no BOQ master table) ─────────────── */

export interface BoqCategory { id: number; name: string; code: string | null; names: number; items: number; workOrders: number }
export interface BoqItem {
  subname: string | null; description: string | null; uom: string | null; subcategory: string | null
  workOrders: number; minRate: number | null; maxRate: number | null; lastUsed: string | null
}
export interface BoqGroup { name: string; items: BoqItem[]; workOrders: number }

async function skillNames(): Promise<Map<number, { name: string; code: string | null }>> {
  const supabase = await createClient()
  const { data } = await supabase.from('in4_skills').select('id, name, code')
  return new Map(((data ?? []) as Array<{ id: number; name: string; code: string | null }>).map(k => [k.id, { name: k.name, code: k.code }]))
}

const NO_CATEGORY = { name: '(no category on the work order)', code: null }

export async function loadBoqOverview(): Promise<{ categories: BoqCategory[]; totals: { names: number; items: number; workOrders: number } } & In4Read> {
  const [r, names] = await Promise.all([
    live(() => in4Query<Record<string, unknown>>(`
      SELECT d.WORK_CATEGORY_ID cat,
             COUNT(DISTINCT d.BOQ_NAME) names,
             COUNT(DISTINCT CONCAT(d.BOQ_NAME, '|', d.BOQ_SUBNAME, '|', d.BOQ_DESCRIPTION)) items,
             COUNT(DISTINCT d.WO_ID) wos
      FROM BI.DIM_ENGG_WORK_ORDER_BOQ d
      GROUP BY d.WORK_CATEGORY_ID`)),
    skillNames(),
  ])
  if (!r.data) return { categories: [], totals: { names: 0, items: 0, workOrders: 0 }, in4: r.in4, in4Error: r.in4Error }
  const categories: BoqCategory[] = r.data.map(x => {
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
    in4: 'live',
  }
}

export async function loadBoqCategory(categoryId: number): Promise<{ category: BoqCategory | null; groups: BoqGroup[] } & In4Read> {
  if (!Number.isInteger(categoryId) || categoryId < 0) return { category: null, groups: [], in4: 'live' }
  const [r, names] = await Promise.all([
    live(() => in4Query<Record<string, unknown>>(`
      SELECT d.BOQ_NAME, d.BOQ_SUBNAME, d.BOQ_DESCRIPTION, d.UOM, d.WORK_SUBCATEGORY_ID,
             COUNT(DISTINCT d.WO_ID) wos, MIN(f.RATE) min_rate, MAX(f.RATE) max_rate, MAX(w.CREATION_DT) last_used
      FROM BI.DIM_ENGG_WORK_ORDER_BOQ d
      LEFT JOIN BI.FACT_ENGG_WORK_ORDER_BOQ f ON f.ITEM_ID = d.ITEM_ID
      LEFT JOIN ENGG_WORK_ORDER w ON w.ID = d.WO_ID
      WHERE d.WORK_CATEGORY_ID = ${categoryId}
      GROUP BY d.BOQ_NAME, d.BOQ_SUBNAME, d.BOQ_DESCRIPTION, d.UOM, d.WORK_SUBCATEGORY_ID
      ORDER BY d.BOQ_NAME, d.BOQ_SUBNAME, d.BOQ_DESCRIPTION`)),
    skillNames(),
  ])
  if (!r.data) return { category: null, groups: [], in4: r.in4, in4Error: r.in4Error }
  const k = names.get(categoryId) ?? NO_CATEGORY
  const groups = new Map<string, BoqGroup>()
  const wosInGroup = new Map<string, Set<number>>()
  for (const x of r.data) {
    const name = s(x.BOQ_NAME) ?? '(no BOQ name)'
    const g = groups.get(name) ?? { name, items: [], workOrders: 0 }
    g.items.push({
      subname: s(x.BOQ_SUBNAME), description: s(x.BOQ_DESCRIPTION), uom: s(x.UOM),
      subcategory: names.get(n(x.WORK_SUBCATEGORY_ID))?.name ?? null,
      workOrders: n(x.wos),
      minRate: x.min_rate == null ? null : Number(x.min_rate), maxRate: x.max_rate == null ? null : Number(x.max_rate),
      lastUsed: iso(x.last_used),
    })
    g.workOrders = Math.max(g.workOrders, n(x.wos))
    groups.set(name, g)
    void wosInGroup
  }
  const list = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  const items = list.reduce((t, g) => t + g.items.length, 0)
  return {
    category: { id: categoryId, name: k.name, code: k.code, names: list.length, items, workOrders: Math.max(0, ...list.map(g => g.workOrders)) },
    groups: list,
    in4: 'live',
  }
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
    count('in4_companies'),
    count('in4_projects'),
    count('in4_subprojects'),
    count('in4_materials'),
    supabase.from('in4_materials').select('id', { count: 'exact', head: true }).not('hsn_code', 'is', null),
    count('in4_skills'),
    supabase.from('in4_skills').select('id', { count: 'exact', head: true }).eq('is_active', false),
    count('profiles'),
    loadContactMaster(),
    live(() => in4Query<{ names: number; items: number }>(`
      SELECT COUNT(DISTINCT BOQ_NAME) names, COUNT(DISTINCT CONCAT(BOQ_NAME, '|', BOQ_SUBNAME, '|', BOQ_DESCRIPTION)) items
      FROM BI.DIM_ENGG_WORK_ORDER_BOQ`)),
  ])
  const skillsTotal = (sk.count ?? 0) - 1 // minus IN4's "-1 Sub Project Milestone" pseudo-skill
  const boqRow = boq.data?.[0]
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
      facts: boqRow ? [`${n(boqRow.names).toLocaleString('en-IN')} BOQ names`, 'Built from IN4’s work orders — IN4 keeps no separate BOQ master'] : ['Read live from IN4'] },
  ]
  return { cards, in4: boq.in4, in4Error: boq.in4Error }
}
