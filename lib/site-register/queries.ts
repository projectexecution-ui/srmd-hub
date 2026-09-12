// Server-side reads for the Site Register.
//
// Everything here goes through the caller's own Supabase client, so row level
// security applies and a loader can never show more than the person may see.
// Names are resolved with small lookups rather than FK embeds, because the
// same pattern is used across the hub and it survives a renamed constraint.

import { createClient } from '@/lib/supabase/server'
import { getMyUser } from '@/lib/auth'
import { personName } from '@/lib/utils'
import {
  ORG_ORDER, coverageGaps, daysBetween,
  type Discipline, type DecisionCategory, type DecisionRow, type DecisionStatus,
  type OrgKind, type Priority, type RegisterRow, type Stakeholder, type ThreadKind, type ThreadStatus,
} from './types'

type Row = Record<string, unknown>
const s = (v: unknown): string | null => (typeof v === 'string' && v.length ? v : null)
const n = (v: unknown): number | null => (v == null ? null : Number(v))

/** Display names for a set of user ids, in one query. */
async function nameMap(sb: Awaited<ReturnType<typeof createClient>>, ids: Array<string | null>): Promise<Map<string, string>> {
  const want = [...new Set(ids.filter((x): x is string => !!x))]
  if (!want.length) return new Map()
  const { data } = await sb.from('profiles').select('id, full_name, name, email').in('id', want)
  return new Map((data ?? []).map((p: Row) => [
    p.id as string,
    personName(p.full_name as string, p.name as string, p.email as string),
  ]))
}

/* ── The register ───────────────────────────────────────────────────────── */

export interface RegisterData {
  rows: RegisterRow[]
  myId: string | null
  /** Calendar days from raised to closed, for everything closed in 90 days —
   *  the input to the average response figure. */
  closedDurations: number[]
  escalationDays: number
}

/**
 * Every entry on one project, or across every project the reader can see when
 * `projectId` is null — the same register, one scope wider, which is how a
 * person who works on four sites finds what is assigned to them.
 */
export async function loadRegister(projectId: string | null, limit = 400): Promise<RegisterData> {
  const sb = await createClient()
  const me = await getMyUser()

  let q = sb.from('sr_threads')
    .select('id, ref, kind, title, status, priority, project_id, category_id, sub_category_id, discipline_id, location, assigned_to, assigned_stakeholder_id, assigned_at, due_on, cost_impact, raised_by, created_at, last_activity_at, closed_at, escalated_at')
    .order('last_activity_at', { ascending: false })
    .limit(limit)
  if (projectId) q = q.eq('project_id', projectId)

  const [{ data: threads }, { data: setting }] = await Promise.all([
    q,
    sb.from('app_settings').select('value').eq('key', 'sr_escalation_days').maybeSingle(),
  ])
  const list = (threads ?? []) as Row[]
  const empty: RegisterData = { rows: [], myId: me?.id ?? null, closedDurations: [], escalationDays: Number(setting?.value) || 3 }
  if (!list.length) return empty

  const ids = list.map(t => t.id as string)
  const [names, cats, subs, discs, projects, posts, stakes] = await Promise.all([
    nameMap(sb, list.flatMap(t => [t.assigned_to as string | null, t.raised_by as string | null])),
    sb.from('cc_disciplines').select('id, name').in('id', [...new Set(list.map(t => t.category_id).filter(Boolean))] as string[]),
    sb.from('cc_sub_skills').select('id, name').in('id', [...new Set(list.map(t => t.sub_category_id).filter(Boolean))] as string[]),
    sb.from('sr_disciplines').select('id, name'),
    sb.from('projects').select('id, name, short_name, code').in('id', [...new Set(list.map(t => t.project_id))] as string[]),
    sb.from('sr_thread_posts').select('thread_id').in('thread_id', ids).limit(4000),
    sb.from('sr_stakeholders').select('id, display_name').in('id', [...new Set(list.map(t => t.assigned_stakeholder_id).filter(Boolean))] as string[]),
  ])

  const catName = new Map((cats.data ?? []).map((r: Row) => [r.id as string, r.name as string]))
  const subName = new Map((subs.data ?? []).map((r: Row) => [r.id as string, r.name as string]))
  const discName = new Map((discs.data ?? []).map((r: Row) => [r.id as string, r.name as string]))
  const stakeName = new Map((stakes.data ?? []).map((r: Row) => [r.id as string, r.display_name as string]))
  const projName = new Map((projects.data ?? []).map((r: Row) =>
    [r.id as string, (s(r.short_name) ?? s(r.name) ?? s(r.code) ?? 'Project')]))
  const postCount = new Map<string, number>()
  for (const p of (posts.data ?? []) as Row[]) {
    const k = p.thread_id as string
    postCount.set(k, (postCount.get(k) ?? 0) + 1)
  }

  const rows: RegisterRow[] = list.map(t => ({
    id: t.id as string,
    ref: t.ref as string,
    kind: t.kind as ThreadKind,
    title: t.title as string,
    status: t.status as ThreadStatus,
    priority: (t.priority as Priority) ?? 'normal',
    projectId: t.project_id as string,
    projectName: projName.get(t.project_id as string) ?? 'Project',
    categoryName: catName.get(t.category_id as string) ?? null,
    subCategoryName: subName.get(t.sub_category_id as string) ?? null,
    disciplineName: discName.get(t.discipline_id as string) ?? null,
    location: s(t.location),
    assignedToId: s(t.assigned_to),
    // A CT Hub user where there is one; otherwise the firm the entry sits
    // with, which is how a query addressed to a consultant reads.
    assignedToName: names.get(t.assigned_to as string)
      ?? stakeName.get(t.assigned_stakeholder_id as string) ?? null,
    assignedAt: s(t.assigned_at),
    dueOn: s(t.due_on),
    costImpact: n(t.cost_impact),
    raisedById: s(t.raised_by),
    raisedByName: names.get(t.raised_by as string) ?? null,
    createdAt: t.created_at as string,
    lastActivityAt: (t.last_activity_at as string) ?? (t.created_at as string),
    posts: postCount.get(t.id as string) ?? 0,
    escalated: !!t.escalated_at,
  }))

  const closedDurations = list
    .filter(t => t.closed_at && t.created_at)
    .map(t => daysBetween(String(t.created_at).slice(0, 10), String(t.closed_at).slice(0, 10)))
    .filter(d => d >= 0)

  return { ...empty, rows, closedDurations }
}

/* ── One entry ──────────────────────────────────────────────────────────── */

export interface ThreadPost {
  id: string
  author: string
  authorId: string | null
  body: string
  createdAt: string
  editedAt: string | null
  isSystem: boolean
  attachments: Array<{ name: string; url?: string }>
}

export interface ThreadEvent {
  id: string
  actor: string
  event: string
  detail: string | null
  from: string | null
  to: string | null
  createdAt: string
}

export interface ThreadDetail {
  row: RegisterRow
  closingNote: string | null
  costNote: string | null
  posts: ThreadPost[]
  events: ThreadEvent[]
  watchers: Array<{ id: string; name: string }>
  canClose: boolean
  myId: string | null
}

export async function loadThread(threadId: string): Promise<ThreadDetail | null> {
  const sb = await createClient()
  const me = await getMyUser()
  const { data: t } = await sb.from('sr_threads').select('*').eq('id', threadId).maybeSingle()
  if (!t) return null
  const row = t as Row

  const [{ data: posts }, { data: events }, { data: watchers }, cat, sub, disc, proj, stake] = await Promise.all([
    sb.from('sr_thread_posts').select('id, author_id, body, attachments, is_system, created_at, edited_at').eq('thread_id', threadId).order('created_at'),
    sb.from('sr_thread_events').select('id, actor_id, event, detail, from_value, to_value, created_at').eq('thread_id', threadId).order('created_at'),
    sb.from('sr_thread_watchers').select('user_id').eq('thread_id', threadId),
    row.category_id ? sb.from('cc_disciplines').select('name').eq('id', row.category_id).maybeSingle() : Promise.resolve({ data: null }),
    row.sub_category_id ? sb.from('cc_sub_skills').select('name').eq('id', row.sub_category_id).maybeSingle() : Promise.resolve({ data: null }),
    row.discipline_id ? sb.from('sr_disciplines').select('name').eq('id', row.discipline_id).maybeSingle() : Promise.resolve({ data: null }),
    sb.from('projects').select('name, short_name, code').eq('id', row.project_id).maybeSingle(),
    row.assigned_stakeholder_id ? sb.from('sr_stakeholders').select('display_name').eq('id', row.assigned_stakeholder_id).maybeSingle() : Promise.resolve({ data: null }),
  ])

  const people = await nameMap(sb, [
    row.assigned_to as string | null, row.raised_by as string | null, row.closed_by as string | null,
    ...((posts ?? []) as Row[]).map(p => p.author_id as string | null),
    ...((events ?? []) as Row[]).map(e => e.actor_id as string | null),
    ...((watchers ?? []) as Row[]).map(w => w.user_id as string),
  ])

  const p = proj.data as Row | null
  const detail: ThreadDetail = {
    row: {
      id: row.id as string,
      ref: row.ref as string,
      kind: row.kind as ThreadKind,
      title: row.title as string,
      status: row.status as ThreadStatus,
      priority: (row.priority as Priority) ?? 'normal',
      projectId: row.project_id as string,
      projectName: (s(p?.short_name) ?? s(p?.name) ?? s(p?.code) ?? 'Project'),
      categoryName: s((cat.data as Row | null)?.name),
      subCategoryName: s((sub.data as Row | null)?.name),
      disciplineName: s((disc.data as Row | null)?.name),
      location: s(row.location),
      assignedToId: s(row.assigned_to),
      assignedToName: people.get(row.assigned_to as string)
        ?? s((stake.data as Row | null)?.display_name) ?? null,
      assignedAt: s(row.assigned_at),
      dueOn: s(row.due_on),
      costImpact: n(row.cost_impact),
      raisedById: s(row.raised_by),
      raisedByName: people.get(row.raised_by as string) ?? null,
      createdAt: row.created_at as string,
      lastActivityAt: (row.last_activity_at as string) ?? (row.created_at as string),
      posts: (posts ?? []).length,
      escalated: !!row.escalated_at,
    },
    closingNote: s(row.closing_note),
    costNote: s(row.cost_impact_note),
    posts: ((posts ?? []) as Row[]).map(x => ({
      id: x.id as string,
      authorId: s(x.author_id),
      author: people.get(x.author_id as string) ?? 'Someone',
      body: x.body as string,
      createdAt: x.created_at as string,
      editedAt: s(x.edited_at),
      isSystem: !!x.is_system,
      attachments: Array.isArray(x.attachments) ? (x.attachments as Array<{ name: string; url?: string }>) : [],
    })),
    events: ((events ?? []) as Row[]).map(x => ({
      id: x.id as string,
      actor: people.get(x.actor_id as string) ?? 'Someone',
      event: x.event as string,
      detail: s(x.detail),
      from: s(x.from_value),
      to: s(x.to_value),
      createdAt: x.created_at as string,
    })),
    watchers: ((watchers ?? []) as Row[]).map(w => ({
      id: w.user_id as string,
      name: people.get(w.user_id as string) ?? 'Someone',
    })),
    // Industry rule, and the reason the closed count can be trusted: an entry
    // is closed by the person who raised it, not by the person answering.
    // An admin may close anything, for the cases where the raiser has left.
    canClose: false,
    myId: me?.id ?? null,
  }

  const { data: myProfile } = me
    ? await sb.from('profiles').select('role').eq('id', me.id).maybeSingle()
    : { data: null }
  const role = (myProfile as Row | null)?.role as string | undefined
  detail.canClose = !!me && (row.raised_by === me.id || role === 'admin')
  return detail
}

/* ── Stakeholders ───────────────────────────────────────────────────────── */

export interface StakeholderData {
  all: Discipline[]
  enabled: Discipline[]
  people: Stakeholder[]
  gaps: Discipline[]
  /**
   * Has anyone narrowed this project's disciplines yet?
   *
   * Until they have, every discipline is available — the same "inherit until
   * set" rule the permission matrix uses for tabs. A project nobody has
   * configured must not be a dead end where an engineer can raise nothing;
   * and the coverage check stays quiet, because 24 disciplines with nobody
   * named is not a finding, it is an unconfigured project.
   */
  configured: boolean
  projectName: string
}

export async function loadStakeholders(projectId: string): Promise<StakeholderData> {
  const sb = await createClient()
  const [{ data: discs }, { data: picked }, { data: people }, { data: proj }] = await Promise.all([
    sb.from('sr_disciplines').select('id, name, short_name, display_order').eq('is_active', true).order('display_order'),
    sb.from('sr_project_disciplines').select('discipline_id, is_enabled').eq('project_id', projectId),
    sb.from('sr_stakeholders').select('*').eq('project_id', projectId).order('is_lead', { ascending: false }).order('display_name'),
    sb.from('projects').select('name, short_name').eq('id', projectId).maybeSingle(),
  ])

  const all: Discipline[] = ((discs ?? []) as Row[]).map(d => ({
    id: d.id as string, name: d.name as string,
    shortName: s(d.short_name), order: Number(d.display_order) || 0,
  }))
  const configured = ((picked ?? []) as Row[]).length > 0
  const on = new Set(((picked ?? []) as Row[]).filter(r => r.is_enabled).map(r => r.discipline_id as string))
  const enabled = configured ? all.filter(d => on.has(d.id)) : all

  const list = (people ?? []) as Row[]
  // IN4 figures by the party pin. One query for every party on the project,
  // then attached — the numbers are never typed and never stored here.
  const partyIds = [...new Set(list.map(r => n(r.in4_party_id)).filter((x): x is number => x != null))]
  const money = new Map<number, { value: number; paid: number; orders: number }>()
  if (partyIds.length) {
    const { data: subprojects } = await sb.from('in4_subproject_links').select('subproject_id').eq('bph_project_id', projectId)
    const spIds = ((subprojects ?? []) as Row[]).map(r => r.subproject_id as number)
    if (spIds.length) {
      const { data: wos } = await sb.from('in4_work_orders')
        .select('contractor_id, wo_value, wo_paid_amt')
        .in('contractor_id', partyIds).in('subproject_id', spIds)
      for (const w of (wos ?? []) as Row[]) {
        const key = Number(w.contractor_id)
        const cur = money.get(key) ?? { value: 0, paid: 0, orders: 0 }
        cur.value += Number(w.wo_value) || 0
        cur.paid += Number(w.wo_paid_amt) || 0
        cur.orders += 1
        money.set(key, cur)
      }
    }
  }

  const discName = new Map(all.map(d => [d.id, d.name]))
  const stakeholders: Stakeholder[] = list.map(r => {
    const pid = n(r.in4_party_id)
    const m = pid != null ? money.get(pid) : undefined
    return {
      id: r.id as string,
      projectId: r.project_id as string,
      disciplineId: s(r.discipline_id),
      disciplineName: discName.get(r.discipline_id as string) ?? null,
      orgKind: (r.org_kind as OrgKind) ?? 'consultant',
      userId: s(r.user_id),
      in4PartyKind: s(r.in4_party_kind),
      in4PartyId: pid,
      name: r.display_name as string,
      roleOnProject: s(r.role_on_project),
      email: s(r.email),
      phone: s(r.phone),
      isLead: !!r.is_lead,
      isActive: !!r.is_active,
      notes: s(r.notes),
      orderValue: m ? m.value : null,
      paid: m ? m.paid : null,
      orders: m ? m.orders : 0,
    }
  }).sort((a, b) =>
    ORG_ORDER.indexOf(a.orgKind) - ORG_ORDER.indexOf(b.orgKind) ||
    Number(b.isLead) - Number(a.isLead) ||
    a.name.localeCompare(b.name))

  const p = proj as Row | null
  return {
    all, enabled, people: stakeholders, configured,
    gaps: configured ? coverageGaps(enabled, stakeholders) : [],
    projectName: (s(p?.short_name) ?? s(p?.name) ?? 'Project'),
  }
}

/* ── Decisions & specifications ─────────────────────────────────────────── */

/**
 * The project's own category tree with each row's decision state attached.
 *
 * The tree is the BUDGET's categories and sub-categories — the ones already
 * switched on for this project — so there is no second list to maintain and a
 * decision always sits where its money sits. A sub-category with no
 * sr_decision_items row yet appears with `id: null` and is not applicable
 * until someone says it is.
 */
export async function loadDecisions(projectId: string): Promise<DecisionCategory[]> {
  const sb = await createClient()
  const [{ data: pcats }, { data: psubs }, { data: items }] = await Promise.all([
    sb.from('cc_project_disciplines').select('discipline_id, is_enabled').eq('project_id', projectId),
    sb.from('cc_project_sub_skills').select('sub_skill_id, is_enabled').eq('project_id', projectId),
    sb.from('sr_decision_items').select('*').eq('project_id', projectId),
  ])

  const catIds = ((pcats ?? []) as Row[]).filter(r => r.is_enabled).map(r => r.discipline_id as string)
  const subIds = ((psubs ?? []) as Row[]).filter(r => r.is_enabled).map(r => r.sub_skill_id as string)
  if (!catIds.length) return []

  const [{ data: cats }, { data: subs }] = await Promise.all([
    sb.from('cc_disciplines').select('id, name, code, display_order').in('id', catIds).eq('is_archived', false),
    subIds.length
      ? sb.from('cc_sub_skills').select('id, name, discipline_id').in('id', subIds).eq('is_archived', false)
      : Promise.resolve({ data: [] as Row[] }),
  ])

  const rows = (items ?? []) as Row[]
  const bySub = new Map(rows.filter(r => r.sub_category_id).map(r => [r.sub_category_id as string, r]))
  const names = await nameMap(sb, rows.flatMap(r => [r.decided_by as string | null, r.owner_id as string | null]))

  // Open entries in the register that quote a sub-category, so a pending
  // specification shows the query that is holding it up.
  const { data: openThreads } = await sb.from('sr_threads')
    .select('ref, sub_category_id')
    .eq('project_id', projectId).in('status', ['open', 'responded'])
    .not('sub_category_id', 'is', null)
  const refsBySub = new Map<string, string[]>()
  for (const t of (openThreads ?? []) as Row[]) {
    const k = t.sub_category_id as string
    const arr = refsBySub.get(k) ?? []
    arr.push(t.ref as string)
    refsBySub.set(k, arr)
  }

  const subsByCat = new Map<string, Row[]>()
  for (const sub of (subs ?? []) as Row[]) {
    const k = sub.discipline_id as string
    const arr = subsByCat.get(k) ?? []
    arr.push(sub)
    subsByCat.set(k, arr)
  }

  return ((cats ?? []) as Row[])
    .map(c => {
      const catId = c.id as string
      const mine = (subsByCat.get(catId) ?? []).sort((a, b) => String(a.name).localeCompare(String(b.name)))
      const list: DecisionRow[] = mine.map(sub => {
        const item = bySub.get(sub.id as string)
        return {
          id: item ? (item.id as string) : null,
          projectId,
          categoryId: catId,
          categoryName: c.name as string,
          categoryCode: s(c.code),
          subCategoryId: sub.id as string,
          subCategoryName: sub.name as string,
          isApplicable: item ? !!item.is_applicable : false,
          status: (item?.status as DecisionStatus) ?? 'pending',
          spec: item ? s(item.spec) : null,
          decidedByName: item ? (names.get(item.decided_by as string) ?? null) : null,
          decidedOn: item ? s(item.decided_on) : null,
          requiredBy: item ? s(item.required_by) : null,
          ownerName: item ? (names.get(item.owner_id as string) ?? null) : null,
          revision: item ? Number(item.revision) || 0 : 0,
          openRefs: refsBySub.get(sub.id as string) ?? [],
        }
      })
      return {
        categoryId: catId,
        name: c.name as string,
        code: s(c.code),
        order: Number(c.display_order) || 0,
        rows: list,
      }
    })
    .filter(c => c.rows.length > 0)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
}

/** Every specification this row has carried, newest first. */
export async function loadDecisionHistory(itemId: string): Promise<Array<{ revision: number; spec: string | null; by: string | null; on: string | null; note: string | null }>> {
  const sb = await createClient()
  const { data } = await sb.from('sr_decision_revisions')
    .select('revision, spec, decided_by, decided_on, note').eq('item_id', itemId).order('revision', { ascending: false })
  const rows = (data ?? []) as Row[]
  const names = await nameMap(sb, rows.map(r => r.decided_by as string | null))
  return rows.map(r => ({
    revision: Number(r.revision) || 0,
    spec: s(r.spec),
    by: names.get(r.decided_by as string) ?? null,
    on: s(r.decided_on),
    note: s(r.note),
  }))
}

/* ── Pickers ────────────────────────────────────────────────────────────── */

export interface PersonOption { id: string; name: string; role: string }

/** Who an entry may be assigned to: every active CT Hub user, so an
 *  instruction can reach anyone, plus the project's own stakeholders. */
export interface AssigneeOption {
  id: string
  name: string
  discipline: string | null
  disciplineId: string | null
  userId: string | null
  isLead: boolean
}

export async function loadAssignees(projectId: string): Promise<{
  people: PersonOption[]
  stakeholders: AssigneeOption[]
}> {
  const sb = await createClient()
  const [{ data: users }, { data: stakes }, { data: discs }] = await Promise.all([
    sb.from('profiles').select('id, full_name, name, email, role').eq('is_active', true).order('full_name'),
    sb.from('sr_stakeholders').select('id, display_name, discipline_id, user_id, is_lead').eq('project_id', projectId).eq('is_active', true).order('display_name'),
    sb.from('sr_disciplines').select('id, name'),
  ])
  const dn = new Map(((discs ?? []) as Row[]).map(d => [d.id as string, d.name as string]))
  return {
    people: ((users ?? []) as Row[]).map(u => ({
      id: u.id as string,
      name: personName(u.full_name as string, u.name as string, u.email as string),
      role: (u.role as string) ?? 'viewer',
    })),
    stakeholders: ((stakes ?? []) as Row[]).map(r => ({
      id: r.id as string,
      name: r.display_name as string,
      discipline: dn.get(r.discipline_id as string) ?? null,
      disciplineId: s(r.discipline_id),
      userId: s(r.user_id),
      isLead: !!r.is_lead,
    })),
  }
}

/** The project's categories and sub-categories, for the "where" fields. */
export async function loadCategoryOptions(projectId: string): Promise<Array<{ id: string; name: string; subs: Array<{ id: string; name: string }> }>> {
  const cats = await loadDecisions(projectId)
  return cats.map(c => ({
    id: c.categoryId,
    name: c.name,
    subs: c.rows.map(r => ({ id: r.subCategoryId as string, name: r.subCategoryName as string })),
  }))
}
