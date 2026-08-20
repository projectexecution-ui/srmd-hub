/** Server-only: actually send the request notifications.
 *
 *  Splits from notify-plan.ts on purpose — the deciding is pure and tested
 *  there, this only fetches and posts. Uses the SERVICE ROLE client because
 *  telling somebody else about a request means writing a row they own, which
 *  RLS rightly refuses to the acting user.
 *
 *  Nothing here may ever break the business action. A request that saved but
 *  failed to notify is a nuisance; a request that failed to save because an
 *  email queue hiccuped is a bug. Every path swallows its own errors and
 *  returns a count.
 */

import { createClient as createServiceClient } from '@supabase/supabase-js'
import { formatINR, formatDate } from '@/lib/utils'
import {
  planRaised, planMoved, planIssued, planReturnWaived,
} from './notify-plan'
import type { Notice, Person, RequestFacts } from './notify-plan'
import type { Rule } from './approval-matrix'

const MODULE = 'warehouse'

function service() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!key || !url) return null
  return createServiceClient(url, key, { auth: { persistSession: false } })
}

type Svc = NonNullable<ReturnType<typeof service>>

/** Everyone who might need telling, with their EFFECTIVE warehouse role.
 *
 *  Reproduces effective_user_role(id, 'warehouse') — the per-module override if
 *  there is one, else the base role — because that function answers for one user
 *  at a time and this needs the whole list. */
async function peopleOf(svc: Svc): Promise<Person[]> {
  const [profiles, overrides, blocks] = await Promise.all([
    svc.from('profiles').select('id, full_name, email, role'),
    svc.from('user_module_roles').select('user_id, role').eq('module_slug', MODULE),
    svc.from('user_module_blocks').select('user_id').eq('module_slug', MODULE),
  ])
  const override = new Map((overrides.data ?? []).map(r => [r.user_id, r.role as string]))
  const blocked = new Set((blocks.data ?? []).map(r => r.user_id))
  return (profiles.data ?? []).map(p => ({
    id: p.id as string,
    name: (p.full_name as string | null) || (p.email as string | null) || null,
    role: override.get(p.id as string) ?? (p.role as string | null),
    blocked: blocked.has(p.id as string),
  }))
}

async function rulesOf(svc: Svc): Promise<Rule[]> {
  const { data } = await svc.from('approval_rules')
    .select('from_stage, to_stage, approver_role, override_role, amount_cap_max, requires_remarks, notes')
    .eq('module_slug', MODULE).eq('doc_type', 'wh_request').eq('is_active', true)
  return (data ?? []).map(r => ({
    fromStage: r.from_stage as string,
    toStage: r.to_stage as string,
    approverRole: r.approver_role as string,
    overrideRole: (r.override_role as string | null) ?? null,
    amountCapMax: r.amount_cap_max == null ? null : Number(r.amount_cap_max),
    requiresRemarks: !!r.requires_remarks,
    notes: (r.notes as string | null) ?? null,
  }))
}

/** The request, as the messages need to describe it. */
async function factsOf(svc: Svc, requestId: string): Promise<RequestFacts | null> {
  const { data: r } = await svc.from('wh_requests')
    .select(`id, req_no, status, requested_by, project_id, purpose, need_by, est_value,
             requester:profiles!wh_requests_requested_by_fkey(full_name, email),
             store:wh_locations!wh_requests_from_location_id_fkey(id, name, keeper_id),
             projects(name),
             wh_request_lines(id, is_returnable, return_waived_at)`)
    .eq('id', requestId).is('deleted_at', null).maybeSingle()
  if (!r) return null

  const one = <T>(v: T | T[] | null | undefined): T | null =>
    v == null ? null : (Array.isArray(v) ? (v[0] ?? null) : v)
  const req = one(r.requester as { full_name?: string | null; email?: string | null } | null)
  const store = one(r.store as { id?: string; name?: string; keeper_id?: string | null } | null)
  const lines = (r.wh_request_lines ?? []) as Array<{ is_returnable: boolean; return_waived_at: string | null }>

  return {
    id: r.id as string,
    reqNo: r.req_no as string,
    status: r.status as string,
    requestedById: (r.requested_by as string | null) ?? null,
    requesterName: req ? (req.full_name || req.email || null) : null,
    storeName: store?.name ?? null,
    storeId: store?.id ?? null,
    keeperId: store?.keeper_id ?? null,
    projectName: one(r.projects as { name?: string } | null)?.name ?? null,
    purpose: (r.purpose as string | null) ?? null,
    needBy: r.need_by ? formatDate(r.need_by as string) : null,
    estValue: r.est_value == null ? null : Number(r.est_value),
    itemCount: lines.length,
    anyReturnable: lines.some(l => l.is_returnable && !l.return_waived_at),
  }
}

/** Post the notices. One bad recipient never stops the rest. */
async function send(svc: Svc, notices: Notice[]): Promise<number> {
  let sent = 0
  for (const n of notices) {
    try {
      const { error } = await svc.rpc('notify_user', {
        p_user_id: n.userId,
        p_type: n.type,
        p_title: n.title,
        p_body: n.body,
        p_url: n.url,
        p_module_slug: MODULE,
        p_doc_table: 'wh_requests',
        p_doc_id: n.data.requestId ?? null,
        p_data: n.data,
      })
      if (!error) sent++
    } catch { /* keep going */ }
  }
  return sent
}

/** Shared prologue. Returns null when notifications cannot run at all, so each
 *  entry point degrades to a no-op rather than throwing into a server action. */
async function prepare(requestId: string) {
  const svc = service()
  if (!svc) return null
  const [facts, people, rules] = await Promise.all([
    factsOf(svc, requestId), peopleOf(svc), rulesOf(svc),
  ])
  if (!facts) return null
  return { svc, facts, people, rules }
}

function stamp(notices: Notice[], requestId: string): Notice[] {
  return notices.map(n => ({ ...n, data: { ...n.data, requestId } }))
}

/** A request was raised and somebody has to approve it. */
export async function notifyRequestRaised(requestId: string): Promise<number> {
  try {
    const ctx = await prepare(requestId)
    if (!ctx) return 0
    return await send(ctx.svc, stamp(
      planRaised(ctx.facts, ctx.people, ctx.rules, formatINR), requestId))
  } catch { return 0 }
}

/** A request moved on: the requester hears, and so does whoever is next. */
export async function notifyRequestMoved(
  requestId: string,
  toStage: string,
  actorName: string | null,
  reason: string | null,
): Promise<number> {
  try {
    const ctx = await prepare(requestId)
    if (!ctx) return 0
    return await send(ctx.svc, stamp(
      planMoved(ctx.facts, toStage, actorName, reason, ctx.people, ctx.rules, formatINR), requestId))
  } catch { return 0 }
}

/** Material actually went out against the request. */
export async function notifyRequestIssued(
  requestId: string,
  entryNo: string,
  fullyIssued: boolean,
): Promise<number> {
  try {
    const ctx = await prepare(requestId)
    if (!ctx) return 0
    return await send(ctx.svc, stamp(planIssued(ctx.facts, entryNo, fullyIssued), requestId))
  } catch { return 0 }
}

/** The Atm Head released it from having to come back. */
export async function notifyReturnWaived(
  requestId: string,
  actorName: string | null,
  reason: string,
): Promise<number> {
  try {
    const ctx = await prepare(requestId)
    if (!ctx) return 0
    return await send(ctx.svc, stamp(planReturnWaived(ctx.facts, actorName, reason), requestId))
  } catch { return 0 }
}
