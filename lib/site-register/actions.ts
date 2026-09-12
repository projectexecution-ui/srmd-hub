'use server'
// Every write the Site Register makes.
//
// Two rules hold throughout:
//   1. The caller's own client does the write, so row level security decides.
//      Nothing here re-implements permissions; it translates a refusal into a
//      sentence a person can act on.
//   2. Anything that CHANGES the state of an entry also writes an event row.
//      sr_thread_events is the audit trail, and a change that is not in it
//      may as well not have happened.

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getMyUser } from '@/lib/auth'
import { personName, todayISO } from '@/lib/utils'
import { notifyCommentMentions } from '@/lib/mentions/notify'
import type { DecisionStatus, OrgKind, Priority, ThreadKind } from './types'

export interface Result { ok: boolean; error?: string; id?: string; ref?: string }

const DENIED = 'You do not have permission to do that.'
const say = (msg: string): string =>
  /row-level security|permission denied/i.test(msg) ? DENIED : msg

function paths(projectId: string) {
  revalidatePath(`/project/${projectId}/discussions`)
  revalidatePath(`/project/${projectId}/stakeholders`)
  revalidatePath(`/project/${projectId}/decisions`)
}

async function stamp(
  sb: Awaited<ReturnType<typeof createClient>>,
  threadId: string,
  event: string,
  opts: { detail?: string | null; from?: string | null; to?: string | null } = {},
): Promise<void> {
  const me = await getMyUser()
  await sb.from('sr_thread_events').insert({
    thread_id: threadId, actor_id: me?.id ?? null, event,
    detail: opts.detail ?? null, from_value: opts.from ?? null, to_value: opts.to ?? null,
  })
}

/** Tell one person, through the pipeline the whole hub already uses. */
async function notify(
  userId: string | null,
  type: string,
  title: string,
  body: string,
  url: string,
): Promise<void> {
  if (!userId) return
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const url_ = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!key || !url_) return
  const me = await getMyUser()
  if (me?.id === userId) return // never notify someone of their own action
  try {
    const svc = createServiceClient(url_, key, { auth: { persistSession: false } })
    await svc.rpc('notify_user', {
      p_user_id: userId, p_type: type, p_title: title, p_body: body,
      p_url: url, p_module_slug: 'cost-control',
      p_doc_table: 'sr_threads', p_doc_id: null, p_data: {},
    })
  } catch { /* a notification that fails never fails the write */ }
}

/* ══════════════════════ The register ══════════════════════════════════════ */

export interface RaiseInput {
  projectId: string
  kind: ThreadKind
  title: string
  body: string
  disciplineId?: string | null
  categoryId?: string | null
  subCategoryId?: string | null
  location?: string | null
  priority?: Priority
  assignedTo?: string | null
  assignedStakeholderId?: string | null
  dueOn?: string | null
  costImpact?: number | null
  costNote?: string | null
  watchers?: string[]
  mentionIds?: string[]
}

/**
 * Raise an entry. One round trip: the entry, its first post, the audit line
 * and the watcher rows are written together by sr_create_thread, so a failure
 * half way leaves nothing behind and the reference number cannot be taken
 * twice.
 */
export async function raiseEntry(input: RaiseInput): Promise<Result> {
  const sb = await createClient()
  const title = input.title.trim()
  const body = input.body.trim()
  if (title.length < 3) return { ok: false, error: 'Give it a subject line first.' }
  if (title.length > 200) return { ok: false, error: 'Keep the subject under 200 characters.' }
  if (body.length < 1) return { ok: false, error: 'Describe what this is about.' }
  if (body.length > 8000) return { ok: false, error: 'Keep the description under 8,000 characters.' }
  if (!input.assignedTo && !input.assignedStakeholderId) {
    return { ok: false, error: 'Choose who this is assigned to. An entry always has someone responsible.' }
  }

  const { data, error } = await sb.rpc('sr_create_thread', {
    p_project: input.projectId,
    p_kind: input.kind,
    p_title: title,
    p_body: body,
    p_discipline: input.disciplineId ?? null,
    p_category: input.categoryId ?? null,
    p_sub_category: input.subCategoryId ?? null,
    p_location: input.location ?? null,
    p_priority: input.priority ?? 'normal',
    p_assigned_to: input.assignedTo ?? null,
    p_assigned_stake: input.assignedStakeholderId ?? null,
    p_due: input.dueOn ?? null,
    p_cost: input.costImpact ?? null,
    p_cost_note: input.costNote ?? null,
    p_watchers: input.watchers ?? [],
    p_attachments: [],
  })
  if (error) return { ok: false, error: say(error.message) }

  const row = (Array.isArray(data) ? data[0] : data) as { id: string; ref: string } | null
  if (!row) return { ok: false, error: 'The entry was not created. Try again.' }

  const me = await getMyUser()
  const { data: mine } = me ? await sb.from('profiles').select('full_name, name, email').eq('id', me.id).maybeSingle() : { data: null }
  const who = personName(
    (mine as Record<string, unknown> | null)?.full_name as string,
    (mine as Record<string, unknown> | null)?.name as string,
    (mine as Record<string, unknown> | null)?.email as string,
  )
  const link = `/project/${input.projectId}/discussions?entry=${row.id}`
  await notify(input.assignedTo ?? null, 'sr_assigned',
    `${row.ref} assigned to you`, `${who}: ${title}`, link)

  if (input.mentionIds?.length) {
    try {
      await notifyCommentMentions({
        recipientIds: input.mentionIds, authorId: me?.id ?? '', authorName: who,
        body, moduleSlug: 'cost-control', moduleLabel: 'Site Register',
        contextLabel: row.ref, url: link, docTable: 'sr_threads', docId: row.id,
      })
    } catch { /* best effort */ }
  }

  paths(input.projectId)
  return { ok: true, id: row.id, ref: row.ref }
}

/**
 * Reply. When the person who owes the answer replies, the entry is RESPONDED
 * and goes back to whoever raised it — that is the standard document cycle,
 * and it is what stops an answered query sitting open for a month.
 */
export async function replyToEntry(
  threadId: string,
  body: string,
  mentionIds: string[] = [],
): Promise<Result> {
  const sb = await createClient()
  const me = await getMyUser()
  if (!me) return { ok: false, error: 'You are not signed in.' }
  const text = body.trim()
  if (!text) return { ok: false, error: 'Write something first.' }
  if (text.length > 8000) return { ok: false, error: 'Keep a reply under 8,000 characters.' }

  const { data: t } = await sb.from('sr_threads')
    .select('id, ref, title, project_id, status, assigned_to, raised_by').eq('id', threadId).maybeSingle()
  if (!t) return { ok: false, error: 'That entry no longer exists.' }
  const row = t as Record<string, unknown>

  const { error } = await sb.from('sr_thread_posts').insert({ thread_id: threadId, author_id: me.id, body: text })
  if (error) return { ok: false, error: say(error.message) }

  const patch: Record<string, unknown> = { last_activity_at: new Date().toISOString() }
  const answering = row.assigned_to === me.id && row.raised_by && row.raised_by !== me.id
  if (answering && row.status === 'open') {
    patch.status = 'responded'
    patch.responded_at = new Date().toISOString()
    patch.assigned_to = row.raised_by
    patch.assigned_stakeholder_id = null
    patch.assigned_at = new Date().toISOString()
  }
  await sb.from('sr_threads').update(patch).eq('id', threadId)
  if (answering) await stamp(sb, threadId, 'responded', { detail: 'Returned to the originator for review' })

  const { data: mine } = await sb.from('profiles').select('full_name, name, email').eq('id', me.id).maybeSingle()
  const who = personName(
    (mine as Record<string, unknown> | null)?.full_name as string,
    (mine as Record<string, unknown> | null)?.name as string,
    (mine as Record<string, unknown> | null)?.email as string,
  )
  const link = `/project/${row.project_id}/discussions?entry=${threadId}`
  await notify(
    (answering ? row.raised_by : row.assigned_to) as string | null,
    'sr_replied', `${row.ref} — reply from ${who}`, text.slice(0, 240), link,
  )
  if (mentionIds.length) {
    try {
      await notifyCommentMentions({
        recipientIds: mentionIds, authorId: me.id, authorName: who, body: text,
        moduleSlug: 'cost-control', moduleLabel: 'Site Register',
        contextLabel: String(row.ref), url: link, docTable: 'sr_threads', docId: threadId,
      })
    } catch { /* best effort */ }
  }

  paths(row.project_id as string)
  return { ok: true }
}

export async function reassignEntry(
  threadId: string,
  to: { userId?: string | null; stakeholderId?: string | null },
  note?: string,
): Promise<Result> {
  const sb = await createClient()
  if (!to.userId && !to.stakeholderId) return { ok: false, error: 'Choose who it goes to.' }
  const { data: t } = await sb.from('sr_threads').select('id, ref, project_id, assigned_to, title').eq('id', threadId).maybeSingle()
  if (!t) return { ok: false, error: 'That entry no longer exists.' }
  const row = t as Record<string, unknown>

  const { error } = await sb.from('sr_threads').update({
    assigned_to: to.userId ?? null,
    assigned_stakeholder_id: to.stakeholderId ?? null,
    assigned_at: new Date().toISOString(),
    last_activity_at: new Date().toISOString(),
  }).eq('id', threadId)
  if (error) return { ok: false, error: say(error.message) }

  await stamp(sb, threadId, 'reassigned', { detail: note?.trim() || null, from: (row.assigned_to as string) ?? null, to: to.userId ?? to.stakeholderId ?? null })
  if (to.userId) {
    // Whoever it goes to is kept informed from now on. Upsert, because they
    // may already have been following it.
    await sb.from('sr_thread_watchers').upsert({ thread_id: threadId, user_id: to.userId }, { onConflict: 'thread_id,user_id' })
    await notify(to.userId, 'sr_assigned', `${row.ref} assigned to you`, String(row.title),
      `/project/${row.project_id}/discussions?entry=${threadId}`)
  }
  paths(row.project_id as string)
  return { ok: true }
}

/** A response date may be revised, but never quietly: the reason is required
 *  and both dates stay in the trail. */
export async function reviseDueDate(threadId: string, dueOn: string, reason: string): Promise<Result> {
  const sb = await createClient()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueOn)) return { ok: false, error: 'Pick a date.' }
  if (!reason.trim()) return { ok: false, error: 'Say why the date is being revised.' }
  const { data: t } = await sb.from('sr_threads').select('project_id, due_on').eq('id', threadId).maybeSingle()
  if (!t) return { ok: false, error: 'That entry no longer exists.' }
  const { error } = await sb.from('sr_threads').update({ due_on: dueOn, last_activity_at: new Date().toISOString() }).eq('id', threadId)
  if (error) return { ok: false, error: say(error.message) }
  await stamp(sb, threadId, 'due_date_revised', { detail: reason.trim(), from: (t as Record<string, unknown>).due_on as string | null, to: dueOn })
  paths((t as Record<string, unknown>).project_id as string)
  return { ok: true }
}

export async function setCostImpact(threadId: string, amount: number | null, note: string): Promise<Result> {
  const sb = await createClient()
  if (amount != null && (!Number.isFinite(amount) || amount < 0)) return { ok: false, error: 'Enter a valid amount.' }
  const { data: t } = await sb.from('sr_threads').select('project_id, cost_impact').eq('id', threadId).maybeSingle()
  if (!t) return { ok: false, error: 'That entry no longer exists.' }
  const { error } = await sb.from('sr_threads')
    .update({ cost_impact: amount, cost_impact_note: note.trim() || null, last_activity_at: new Date().toISOString() })
    .eq('id', threadId)
  if (error) return { ok: false, error: say(error.message) }
  await stamp(sb, threadId, 'cost_impact_set', {
    detail: note.trim() || null,
    from: String((t as Record<string, unknown>).cost_impact ?? ''),
    to: amount == null ? '' : String(amount),
  })
  paths((t as Record<string, unknown>).project_id as string)
  return { ok: true }
}

/** Closing belongs to the originator. Anyone else asking for closure leaves a
 *  reply saying so — which is what the button does for them. */
export async function closeEntry(threadId: string, note: string): Promise<Result> {
  const sb = await createClient()
  const me = await getMyUser()
  if (!me) return { ok: false, error: 'You are not signed in.' }
  const { data: t } = await sb.from('sr_threads').select('project_id, ref, raised_by, assigned_to, status').eq('id', threadId).maybeSingle()
  if (!t) return { ok: false, error: 'That entry no longer exists.' }
  const row = t as Record<string, unknown>
  const { data: prof } = await sb.from('profiles').select('role').eq('id', me.id).maybeSingle()
  const isAdmin = (prof as Record<string, unknown> | null)?.role === 'admin'
  if (row.raised_by !== me.id && !isAdmin) {
    return { ok: false, error: 'Only the person who raised this entry can close it. Reply asking them to close it.' }
  }
  if (row.status === 'closed') return { ok: true }

  const { error } = await sb.from('sr_threads').update({
    status: 'closed', closed_by: me.id, closed_at: new Date().toISOString(),
    closing_note: note.trim() || null, last_activity_at: new Date().toISOString(),
  }).eq('id', threadId)
  if (error) return { ok: false, error: say(error.message) }
  await stamp(sb, threadId, 'closed', { detail: note.trim() || null })
  await notify(row.assigned_to as string | null, 'sr_closed', `${row.ref} closed`,
    note.trim() || 'The entry has been closed.', `/project/${row.project_id}/discussions?entry=${threadId}`)
  paths(row.project_id as string)
  return { ok: true }
}

export async function reopenEntry(threadId: string, reason: string): Promise<Result> {
  const sb = await createClient()
  const me = await getMyUser()
  if (!reason.trim()) return { ok: false, error: 'Say why it is being reopened.' }
  const { data: t } = await sb.from('sr_threads').select('project_id, raised_by, assigned_to').eq('id', threadId).maybeSingle()
  if (!t) return { ok: false, error: 'That entry no longer exists.' }
  const row = t as Record<string, unknown>
  // An open entry must have someone responsible — the database says so. Where
  // nobody is left (a profile removed), it comes back to whoever reopened it.
  const owner = (row.assigned_to as string) ?? (row.raised_by as string) ?? me?.id ?? null
  if (!owner) return { ok: false, error: 'Reopening needs someone to assign it to.' }
  const { error } = await sb.from('sr_threads').update({
    status: 'open', closed_at: null, closed_by: null,
    assigned_to: owner,
    assigned_at: new Date().toISOString(), last_activity_at: new Date().toISOString(),
  }).eq('id', threadId)
  if (error) return { ok: false, error: say(error.message) }
  await stamp(sb, threadId, 'reopened', { detail: reason.trim() })
  paths(row.project_id as string)
  return { ok: true }
}

export async function setWatching(threadId: string, on: boolean): Promise<Result> {
  const sb = await createClient()
  const me = await getMyUser()
  if (!me) return { ok: false, error: 'You are not signed in.' }
  const { error } = on
    ? await sb.from('sr_thread_watchers').upsert({ thread_id: threadId, user_id: me.id }, { onConflict: 'thread_id,user_id' })
    : await sb.from('sr_thread_watchers').delete().eq('thread_id', threadId).eq('user_id', me.id)
  if (error) return { ok: false, error: say(error.message) }
  return { ok: true }
}

/* ══════════════════════ Stakeholders ══════════════════════════════════════ */

/** Which disciplines this project uses. Configuration — admin, head, founder.
 *  Rows are kept rather than deleted so switching one back on remembers who
 *  turned it off and when. */
export async function setProjectDisciplines(projectId: string, enabledIds: string[]): Promise<Result> {
  const sb = await createClient()
  const me = await getMyUser()
  const { data: all } = await sb.from('sr_disciplines').select('id').eq('is_active', true)
  const want = new Set(enabledIds)
  const rows = ((all ?? []) as Array<{ id: string }>).map(d => ({
    project_id: projectId, discipline_id: d.id, is_enabled: want.has(d.id),
    enabled_by: me?.id ?? null, enabled_at: new Date().toISOString(),
  }))
  if (!rows.length) return { ok: true }
  const { error } = await sb.from('sr_project_disciplines').upsert(rows, { onConflict: 'project_id,discipline_id' })
  if (error) return { ok: false, error: say(error.message) }
  paths(projectId)
  return { ok: true }
}

export interface StakeholderInput {
  id?: string | null
  projectId: string
  disciplineId: string | null
  orgKind: OrgKind
  userId?: string | null
  in4PartyKind?: string | null
  in4PartyId?: number | null
  name: string
  roleOnProject?: string | null
  email?: string | null
  phone?: string | null
  isLead?: boolean
  notes?: string | null
}

export async function saveStakeholder(input: StakeholderInput): Promise<Result> {
  const sb = await createClient()
  const me = await getMyUser()
  const name = input.name.trim()
  if (name.length < 2) return { ok: false, error: 'Enter a name.' }
  if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) {
    return { ok: false, error: 'That e-mail address does not look right.' }
  }

  // At most one lead per discipline — clear the old one first, so naming a new
  // lead never fails on the unique index with a message nobody can read.
  if (input.isLead && input.disciplineId) {
    await sb.from('sr_stakeholders').update({ is_lead: false })
      .eq('project_id', input.projectId).eq('discipline_id', input.disciplineId).eq('is_lead', true)
      .neq('id', input.id ?? '00000000-0000-0000-0000-000000000000')
  }

  const payload = {
    project_id: input.projectId,
    discipline_id: input.disciplineId,
    org_kind: input.orgKind,
    user_id: input.userId ?? null,
    in4_party_kind: input.in4PartyKind ?? null,
    in4_party_id: input.in4PartyId ?? null,
    display_name: name,
    role_on_project: input.roleOnProject?.trim() || null,
    email: input.email?.trim() || null,
    phone: input.phone?.trim() || null,
    is_lead: !!input.isLead,
    notes: input.notes?.trim() || null,
  }
  const { error } = input.id
    ? await sb.from('sr_stakeholders').update(payload).eq('id', input.id)
    : await sb.from('sr_stakeholders').insert({ ...payload, created_by: me?.id ?? null })
  if (error) return { ok: false, error: say(error.message) }
  paths(input.projectId)
  return { ok: true }
}

/** Taken off the project, not deleted — an entry they answered in March still
 *  has to say who answered it. */
export async function removeStakeholder(id: string, projectId: string): Promise<Result> {
  const sb = await createClient()
  const { error } = await sb.from('sr_stakeholders')
    .update({ is_active: false, is_lead: false, ended_on: todayISO() }).eq('id', id)
  if (error) return { ok: false, error: say(error.message) }
  paths(projectId)
  return { ok: true }
}

export async function restoreStakeholder(id: string, projectId: string): Promise<Result> {
  const sb = await createClient()
  const { error } = await sb.from('sr_stakeholders').update({ is_active: true, ended_on: null }).eq('id', id)
  if (error) return { ok: false, error: say(error.message) }
  paths(projectId)
  return { ok: true }
}

/* ── Copying a project's setup to others ────────────────────────────────── */

export interface CopyPlanLine {
  projectId: string
  projectName: string
  disciplinesAdded: number
  peopleAdded: number
  alreadyThere: number
  conflicts: string[]
}

export interface CopyOptions {
  disciplines: boolean
  people: boolean
  /** 'add' leaves everything already there alone; 'match' also switches off
   *  disciplines the source does not use. People are never removed. */
  mode: 'add' | 'match'
}

/**
 * What copying WOULD do, before it does it. Shown to the person and confirmed
 * — a silent bulk write across ten projects is how a register loses trust.
 */
export async function planCopy(
  fromProjectId: string,
  toProjectIds: string[],
  opts: CopyOptions,
): Promise<{ ok: boolean; error?: string; lines: CopyPlanLine[] }> {
  const sb = await createClient()
  if (!toProjectIds.length) return { ok: false, error: 'Choose at least one project.', lines: [] }

  const [{ data: srcDisc }, { data: srcPeople }, { data: projects }] = await Promise.all([
    sb.from('sr_project_disciplines').select('discipline_id').eq('project_id', fromProjectId).eq('is_enabled', true),
    sb.from('sr_stakeholders').select('discipline_id, org_kind, user_id, in4_party_kind, in4_party_id, display_name, role_on_project, email, phone, is_lead, notes').eq('project_id', fromProjectId).eq('is_active', true),
    sb.from('projects').select('id, name, short_name').in('id', toProjectIds),
  ])
  const wantDisc = ((srcDisc ?? []) as Array<{ discipline_id: string }>).map(r => r.discipline_id)
  const people = (srcPeople ?? []) as Array<Record<string, unknown>>
  const projName = new Map(((projects ?? []) as Array<Record<string, unknown>>).map(p =>
    [p.id as string, (p.short_name as string) || (p.name as string) || 'Project']))

  const [{ data: theirDisc }, { data: theirPeople }] = await Promise.all([
    sb.from('sr_project_disciplines').select('project_id, discipline_id, is_enabled').in('project_id', toProjectIds),
    sb.from('sr_stakeholders').select('project_id, discipline_id, display_name, is_lead').in('project_id', toProjectIds).eq('is_active', true),
  ])

  const lines: CopyPlanLine[] = toProjectIds.map(pid => {
    const have = new Set(((theirDisc ?? []) as Array<Record<string, unknown>>)
      .filter(r => r.project_id === pid && r.is_enabled).map(r => r.discipline_id as string))
    const theirs = ((theirPeople ?? []) as Array<Record<string, unknown>>).filter(r => r.project_id === pid)
    const byName = new Set(theirs.map(r => String(r.display_name).trim().toLowerCase()))
    const leadOf = new Map(theirs.filter(r => r.is_lead).map(r => [r.discipline_id as string, String(r.display_name)]))

    const conflicts: string[] = []
    let peopleAdded = 0, alreadyThere = 0
    if (opts.people) {
      for (const p of people) {
        if (byName.has(String(p.display_name).trim().toLowerCase())) { alreadyThere++; continue }
        const existingLead = p.is_lead && p.discipline_id ? leadOf.get(p.discipline_id as string) : undefined
        if (existingLead) {
          conflicts.push(`already names ${existingLead} as the lead for that discipline, so ${p.display_name} is added without the lead mark`)
        }
        peopleAdded++
      }
    }
    return {
      projectId: pid,
      projectName: projName.get(pid) ?? 'Project',
      disciplinesAdded: opts.disciplines ? wantDisc.filter(d => !have.has(d)).length : 0,
      peopleAdded,
      alreadyThere,
      conflicts,
    }
  })
  return { ok: true, lines }
}

export async function applyCopy(
  fromProjectId: string,
  toProjectIds: string[],
  opts: CopyOptions,
): Promise<Result> {
  const sb = await createClient()
  const me = await getMyUser()
  if (!toProjectIds.length) return { ok: false, error: 'Choose at least one project.' }

  const [{ data: srcDisc }, { data: srcPeople }, { data: allDisc }] = await Promise.all([
    sb.from('sr_project_disciplines').select('discipline_id').eq('project_id', fromProjectId).eq('is_enabled', true),
    sb.from('sr_stakeholders').select('discipline_id, org_kind, user_id, in4_party_kind, in4_party_id, display_name, role_on_project, email, phone, is_lead, notes').eq('project_id', fromProjectId).eq('is_active', true),
    sb.from('sr_disciplines').select('id').eq('is_active', true),
  ])
  const want = new Set(((srcDisc ?? []) as Array<{ discipline_id: string }>).map(r => r.discipline_id))
  const people = (srcPeople ?? []) as Array<Record<string, unknown>>

  for (const pid of toProjectIds) {
    if (opts.disciplines) {
      const rows = ((allDisc ?? []) as Array<{ id: string }>)
        .filter(d => opts.mode === 'match' || want.has(d.id))
        .map(d => ({
          project_id: pid, discipline_id: d.id, is_enabled: want.has(d.id),
          enabled_by: me?.id ?? null, enabled_at: new Date().toISOString(),
        }))
      if (rows.length) {
        const { error } = await sb.from('sr_project_disciplines').upsert(rows, { onConflict: 'project_id,discipline_id' })
        if (error) return { ok: false, error: say(error.message) }
      }
    }

    if (opts.people && people.length) {
      const { data: theirs } = await sb.from('sr_stakeholders').select('display_name, discipline_id, is_lead').eq('project_id', pid).eq('is_active', true)
      const byName = new Set(((theirs ?? []) as Array<Record<string, unknown>>).map(r => String(r.display_name).trim().toLowerCase()))
      const leadTaken = new Set(((theirs ?? []) as Array<Record<string, unknown>>).filter(r => r.is_lead).map(r => r.discipline_id as string))
      const rows = people
        .filter(p => !byName.has(String(p.display_name).trim().toLowerCase()))
        .map(p => ({
          project_id: pid,
          discipline_id: p.discipline_id ?? null,
          org_kind: p.org_kind,
          user_id: p.user_id ?? null,
          in4_party_kind: p.in4_party_kind ?? null,
          in4_party_id: p.in4_party_id ?? null,
          display_name: p.display_name,
          role_on_project: p.role_on_project ?? null,
          email: p.email ?? null,
          phone: p.phone ?? null,
          // Never overwrite a lead the target project already named.
          is_lead: !!p.is_lead && !!p.discipline_id && !leadTaken.has(p.discipline_id as string),
          notes: p.notes ?? null,
          created_by: me?.id ?? null,
        }))
      if (rows.length) {
        const { error } = await sb.from('sr_stakeholders').insert(rows)
        if (error) return { ok: false, error: say(error.message) }
      }
    }
    paths(pid)
  }
  paths(fromProjectId)
  return { ok: true }
}

/* ══════════════════════ Decisions & specifications ════════════════════════ */

/** Which sub-categories need a specification decided. Configuration, so it
 *  lives behind "Manage applicability" and not on the reading screen. */
export async function setApplicability(
  projectId: string,
  subCategoryIds: string[],
  applicable: boolean,
): Promise<Result> {
  const sb = await createClient()
  const me = await getMyUser()
  if (!subCategoryIds.length) return { ok: true }

  const { data: subs } = await sb.from('cc_sub_skills').select('id, discipline_id').in('id', subCategoryIds)
  const rows = ((subs ?? []) as Array<Record<string, unknown>>).map(s => ({
    project_id: projectId,
    category_id: s.discipline_id as string,
    sub_category_id: s.id as string,
    is_applicable: applicable,
    created_by: me?.id ?? null,
  }))
  if (!rows.length) return { ok: true }

  // Upsert on the partial unique index: the row may not exist yet (the tree
  // shows every sub-category, whether or not anyone has touched it).
  const { error } = await sb.from('sr_decision_items')
    .upsert(rows, { onConflict: 'project_id,sub_category_id', ignoreDuplicates: false })
  if (error) return { ok: false, error: say(error.message) }
  paths(projectId)
  return { ok: true }
}

export async function recordDecision(
  itemId: string,
  projectId: string,
  spec: string,
  note: string,
  decidedOn?: string | null,
): Promise<Result> {
  const sb = await createClient()
  const text = spec.trim()
  if (text.length < 3) return { ok: false, error: 'Write the specification that has been agreed.' }
  if (text.length > 4000) return { ok: false, error: 'Keep the specification under 4,000 characters.' }
  const { error } = await sb.rpc('sr_record_decision', {
    p_item: itemId, p_spec: text, p_note: note.trim() || null, p_on: decidedOn || null,
  })
  if (error) return { ok: false, error: say(error.message) }
  paths(projectId)
  return { ok: true }
}

export async function setDecisionState(
  itemId: string,
  projectId: string,
  patch: { status?: DecisionStatus; requiredBy?: string | null; ownerId?: string | null; disciplineId?: string | null; notes?: string | null },
): Promise<Result> {
  const sb = await createClient()
  const update: Record<string, unknown> = {}
  if (patch.status) update.status = patch.status
  if (patch.requiredBy !== undefined) update.required_by = patch.requiredBy || null
  if (patch.ownerId !== undefined) update.owner_id = patch.ownerId || null
  if (patch.disciplineId !== undefined) update.discipline_id = patch.disciplineId || null
  if (patch.notes !== undefined) update.notes = patch.notes?.trim() || null
  if (!Object.keys(update).length) return { ok: true }
  const { error } = await sb.from('sr_decision_items').update(update).eq('id', itemId)
  if (error) return { ok: false, error: say(error.message) }
  paths(projectId)
  return { ok: true }
}

/** The applicability ticks of one project, copied to others. The decisions
 *  themselves are never copied — a specification belongs to its own project. */
export async function copyApplicability(
  fromProjectId: string,
  toProjectIds: string[],
): Promise<{ ok: boolean; error?: string; copied: number; skipped: number }> {
  const sb = await createClient()
  const me = await getMyUser()
  if (!toProjectIds.length) return { ok: false, error: 'Choose at least one project.', copied: 0, skipped: 0 }

  const { data: src } = await sb.from('sr_decision_items')
    .select('category_id, sub_category_id').eq('project_id', fromProjectId).eq('is_applicable', true)
  const wanted = (src ?? []) as Array<{ category_id: string; sub_category_id: string | null }>
  if (!wanted.length) return { ok: true, copied: 0, skipped: 0 }

  let copied = 0, skipped = 0
  for (const pid of toProjectIds) {
    // Only where the target project actually has that sub-category switched on
    // in its own budget — otherwise a tick would appear against work the
    // project does not do.
    const { data: theirSubs } = await sb.from('cc_project_sub_skills')
      .select('sub_skill_id').eq('project_id', pid).eq('is_enabled', true)
    const have = new Set(((theirSubs ?? []) as Array<{ sub_skill_id: string }>).map(r => r.sub_skill_id))
    const rows = wanted
      .filter(w => w.sub_category_id && have.has(w.sub_category_id))
      .map(w => ({
        project_id: pid, category_id: w.category_id, sub_category_id: w.sub_category_id,
        is_applicable: true, created_by: me?.id ?? null,
      }))
    skipped += wanted.length - rows.length
    if (rows.length) {
      const { error } = await sb.from('sr_decision_items').upsert(rows, { onConflict: 'project_id,sub_category_id' })
      if (error) return { ok: false, error: say(error.message), copied, skipped }
      copied += rows.length
    }
    paths(pid)
  }
  return { ok: true, copied, skipped }
}

/* ══════════════════════ Reads the drawer needs ════════════════════════════ */

/** One entry with its posts, trail and watchers — fetched when the drawer
 *  opens rather than shipped with every row of the register. */
export async function fetchEntry(threadId: string) {
  const { loadThread } = await import('./queries')
  return loadThread(threadId)
}

/** The history behind a recorded specification. */
export async function fetchDecisionHistory(itemId: string) {
  const { loadDecisionHistory } = await import('./queries')
  return loadDecisionHistory(itemId)
}
