/** Reads for the request screens. */

import { createClient } from '@/lib/supabase/server'
import { getMyUser, getMyPermissions, can } from '@/lib/auth'
import { one } from './data'
import { outstanding, fulfilledPct, ageDays, isStale, isOpen } from './requests'
import { todayIST } from './ledger'
import type { RequestStatus } from './requests'
import { MODULE, DOC_TYPE, movesFor } from './approval-matrix'
import type { Rule } from './approval-matrix'

export type RequestRow = {
  id: string
  reqNo: string
  day: string
  status: RequestStatus
  storeName: string
  storeId: string
  /** Where it should end up: a project, or another store. */
  destination: string
  purpose: string
  needBy: string | null
  requestedBy: string | null
  requestedById: string | null
  lines: number
  qty: number
  pct: number
  age: number
  stale: boolean
  stagesNeeded: number
  stagesDone: number
  estValue: number | null
  rejectReason: string | null
}

const SELECT = `id, req_no, request_date, status, purpose, need_by, requested_by,
  rule_at_raise, est_value, stages_needed, stages_done, reject_reason,
  store:wh_locations!wh_requests_from_location_id_fkey(id, name),
  dest:wh_locations!wh_requests_to_location_id_fkey(name),
  projects(name),
  requester:profiles!wh_requests_requested_by_fkey(full_name, email),
  wh_request_lines(id, qty, issued_qty)`

function toRow(r: Record<string, unknown>, today: string): RequestRow {
  const lines = (r.wh_request_lines ?? []) as Array<{ qty: string; issued_qty: string }>
  const fulfil = lines.map(l => ({ qty: Number(l.qty), issuedQty: Number(l.issued_qty) }))
  const store = one(r.store as never) as { id: string; name: string } | null
  const dest = one(r.dest as never) as { name: string } | null
  const proj = one(r.projects as never) as { name: string } | null
  const who = one(r.requester as never) as { full_name?: string | null; email?: string | null } | null
  const status = r.status as RequestStatus
  const day = r.request_date as string

  return {
    id: r.id as string,
    reqNo: r.req_no as string,
    day,
    status,
    storeId: store?.id ?? '',
    storeName: store?.name ?? '—',
    // A request either goes to a site (named by its project) or across to
    // another store. Saying which is the first thing the keeper needs.
    destination: dest?.name ?? proj?.name ?? 'the requester’s site',
    purpose: r.purpose as string,
    needBy: (r.need_by as string | null) ?? null,
    requestedBy: who ? (who.full_name || who.email?.split('@')[0] || null) : null,
    requestedById: (r.requested_by as string | null) ?? null,
    lines: lines.length,
    qty: fulfil.reduce((s, l) => s + l.qty, 0),
    pct: fulfilledPct(fulfil),
    age: ageDays(day, today),
    stale: isStale(day, today, status),
    stagesNeeded: Number(r.stages_needed ?? 0),
    stagesDone: Number(r.stages_done ?? 0),
    estValue: r.est_value == null ? null : Number(r.est_value),
    rejectReason: (r.reject_reason as string | null) ?? null,
  }
}

export type RequestLanes = {
  /** Waiting on ME to approve. */
  toApprove: RequestRow[]
  /** Approved, waiting on a keeper to issue — scoped to the stores I keep
   *  unless I am an admin, in which case all of them. */
  toIssue: RequestRow[]
  /** Raised by me, still open. */
  mine: RequestRow[]
  /** Everything else recent, so the screen is never empty. */
  recent: RequestRow[]
  canApprove: boolean
  error?: string
}

/** The request screen, organised by whose problem each one is.
 *
 *  Lanes rather than one list, because "what needs me" is the only question
 *  anybody opens this screen with. V1 showed one org-wide list and a keeper had
 *  to read every site's requests to find his own. */
export async function getRequestLanes(limit = 120): Promise<RequestLanes> {
  const sb = await createClient()
  const today = todayIST()
  const [me, perms, { rules }, role] = await Promise.all([
    getMyUser(), getMyPermissions(), getApprovalRules(), myWarehouseRole(),
  ])
  const isAdmin = can(perms, 'warehouse', 'admin')

  const [reqRes, keptRes] = await Promise.all([
    sb.from('wh_requests').select(SELECT)
      .is('deleted_at', null)
      .order('request_date', { ascending: false })
      .order('req_no', { ascending: false })
      .limit(limit),
    // Which stores am I the keeper of?
    me?.id
      ? sb.from('wh_locations').select('id').eq('keeper_id', me.id).is('deleted_at', null)
      : Promise.resolve({ data: [] as Array<{ id: string }> }),
  ])
  if (reqRes.error) {
    return {
      toApprove: [], toIssue: [], mine: [], recent: [],
      canApprove: false, error: reqRes.error.message,
    }
  }

  const rows = (reqRes.data ?? []).map(r => toRow(r as never, today))
  const myStores = new Set((keptRes.data ?? []).map(l => l.id))

  // Read from the MATRIX, at whatever stage each request is actually sitting.
  // Two bugs lived in the old version of this: it only looked at 'pending', so a
  // two-stage request in 'checked' fell out of every queue; and it keyed on
  // warehouse-admin, so the Trustee named as the second approver — view-only on
  // this module — never saw a lane.
  const canMoveOn = (r: RequestRow) =>
    movesFor(rules, r.status, role, r.estValue)
      .some(m => m.toStage !== 'rejected' && m.toStage !== 'cancelled')

  const toApprove = rows.filter(r =>
    (r.status === 'pending' || r.status === 'checked')
    && r.requestedById !== me?.id
    && canMoveOn(r))

  const toIssue = rows.filter(r =>
    (r.status === 'approved' || r.status === 'part_issued')
    && (isAdmin || myStores.size === 0 || myStores.has(r.storeId)))

  const mine = rows.filter(r => r.requestedById === me?.id && isOpen(r.status))

  const claimed = new Set([...toApprove, ...toIssue, ...mine].map(r => r.id))
  const recent = rows.filter(r => !claimed.has(r.id))

  // "Can this person approve anything at all", for the footnote on the screen.
  const canApprove = rows.some(canMoveOn)
    || rules.some(x => role === 'admin' || role === x.approverRole || role === x.overrideRole)

  return { toApprove, toIssue, mine, recent, canApprove }
}

export type RequestDetail = RequestRow & {
  remarks: string | null
  approvals: Array<{ stage: number; by: string; at: string }>
  /** Who has already stamped it, for the "not twice by one person" rule. */
  approverIds: Array<string>
  rejectedBy: string | null
  cancelledBy: string | null
  ruleAtRaise: string
  items: Array<{
    lineId: string
    itemId: string
    itemName: string
    itemCode: string | null
    unit: string
    category: string | null
    qty: number
    issuedQty: number
    outstanding: number
    /** What the asked store holds right now. */
    available: number
    note: string | null
    isReturnable: boolean
  }>
  /** Issues recorded against this request. */
  issues: Array<{ id: string; entryNo: string; day: string; voided: boolean }>
}

export async function getRequestDetail(
  id: string,
): Promise<{ request: RequestDetail | null; error?: string }> {
  const sb = await createClient()
  const today = todayIST()

  const { data: r, error } = await sb.from('wh_requests')
    .select(`${SELECT}, remarks, rule_at_raise, from_location_id,
             approved1_at, approved2_at, approved1_by, approved2_by,
             a1:profiles!wh_requests_approved1_by_fkey(full_name, email),
             a2:profiles!wh_requests_approved2_by_fkey(full_name, email),
             rej:profiles!wh_requests_rejected_by_fkey(full_name, email),
             can:profiles!wh_requests_cancelled_by_fkey(full_name, email),
             wh_request_lines(id, item_id, qty, issued_qty, note, is_returnable,
               wh_items(id, name, code, unit, category))`)
    .eq('id', id).is('deleted_at', null).maybeSingle()
  if (error) return { request: null, error: error.message }
  if (!r) return { request: null }

  const base = toRow(r as never, today)
  const lines = (r.wh_request_lines ?? []) as Array<Record<string, unknown>>

  // What the asked store actually holds, so the keeper is not guessing.
  const itemIds = lines.map(l => l.item_id as string)
  const stock = new Map<string, number>()
  if (itemIds.length > 0) {
    const { data: st } = await sb.from('wh_stock')
      .select('item_id, qty')
      .eq('location_id', r.from_location_id as string)
      .in('item_id', itemIds)
    for (const s of st ?? []) stock.set(s.item_id, Number(s.qty))
  }

  const { data: outs } = await sb.from('wh_gate_out')
    .select('id, entry_no, entry_date, deleted_at')
    .eq('request_id', id)
    .order('entry_date', { ascending: false })

  const name = (p: unknown) => {
    const o = one(p as never) as { full_name?: string | null; email?: string | null } | null
    return o ? (o.full_name || o.email?.split('@')[0] || null) : null
  }

  const approvals: RequestDetail['approvals'] = []
  if (r.approved1_at) approvals.push({ stage: 1, by: name(r.a1) ?? '—', at: r.approved1_at as string })
  if (r.approved2_at) approvals.push({ stage: 2, by: name(r.a2) ?? '—', at: r.approved2_at as string })

  return {
    request: {
      ...base,
      remarks: (r.remarks as string | null) ?? null,
      ruleAtRaise: (r.rule_at_raise as string) ?? 'off',
      approvals,
      approverIds: [r.approved1_by, r.approved2_by].filter(Boolean) as string[],
      rejectedBy: name(r.rej),
      cancelledBy: name(r.can),
      items: lines.map(l => {
        const item = one(l.wh_items as never) as
          { id: string; name: string; code: string | null; unit: string; category: string | null } | null
        const qty = Number(l.qty)
        const issuedQty = Number(l.issued_qty)
        return {
          lineId: l.id as string,
          itemId: (l.item_id as string),
          itemName: item?.name ?? '—',
          itemCode: item?.code ?? null,
          unit: item?.unit ?? '',
          category: item?.category ?? null,
          qty,
          issuedQty,
          outstanding: outstanding({ qty, issuedQty }),
          available: stock.get(l.item_id as string) ?? 0,
          note: (l.note as string | null) ?? null,
          isReturnable: (l.is_returnable as boolean) ?? false,
        }
      }),
      issues: (outs ?? []).map(o => ({
        id: o.id, entryNo: o.entry_no, day: o.entry_date, voided: o.deleted_at != null,
      })),
    },
  }
}

/** Approved requests the keeper can issue against, for the Gate OUT picker. */
export async function getIssuableRequests(
  locationId: string | null,
): Promise<Array<{ id: string; reqNo: string; label: string }>> {
  if (!locationId) return []
  const sb = await createClient()
  const { data } = await sb.from('wh_requests')
    .select(`id, req_no, purpose, request_date, projects(name),
             requester:profiles!wh_requests_requested_by_fkey(full_name, email)`)
    .eq('from_location_id', locationId)
    .in('status', ['approved', 'part_issued'])
    .is('deleted_at', null)
    .order('request_date')
  return (data ?? []).map(r => {
    const who = one(r.requester as never) as { full_name?: string | null; email?: string | null } | null
    const bits = [
      one(r.projects)?.name,
      who ? (who.full_name || who.email?.split('@')[0]) : null,
      r.purpose,
    ].filter(Boolean)
    return { id: r.id, reqNo: r.req_no, label: bits.join(' · ') }
  })
}

// ===========================================================================
// The approval chain, as configured
// ===========================================================================

/** The warehouse request rules from the shared matrix.
 *
 *  Read live, not frozen onto the request. Every other module in the hub works
 *  that way, and consistency matters more here than my earlier instinct to
 *  freeze: the matrix IS the authority, and two modules disagreeing about
 *  whether a rule change applies to work in flight would be worse. What stays
 *  frozen is `est_value` — the value the caps are compared against — because
 *  that is data about the request, not configuration. */
export async function getApprovalRules(): Promise<{ rules: Rule[]; error?: string }> {
  const sb = await createClient()
  const { data, error } = await sb.from('approval_rules')
    .select('from_stage, to_stage, approver_role, override_role, amount_cap_max, requires_remarks, notes')
    .eq('module_slug', MODULE).eq('doc_type', DOC_TYPE).eq('is_active', true)
  if (error) return { rules: [], error: error.message }
  return {
    rules: (data ?? []).map(r => ({
      fromStage: r.from_stage,
      toStage: r.to_stage,
      approverRole: r.approver_role,
      overrideRole: r.override_role,
      amountCapMax: r.amount_cap_max == null ? null : Number(r.amount_cap_max),
      requiresRemarks: r.requires_remarks,
      notes: r.notes,
    })),
  }
}

/** This person's effective role in the warehouse, which is what the matrix
 *  compares against. Uses the hub's own resolver so a per-user override set on
 *  /admin/users is honoured here exactly as it is everywhere else. */
export async function myWarehouseRole(): Promise<string | null> {
  const sb = await createClient()
  const me = await getMyUser()
  if (!me?.id) return null

  // effective_user_role takes (p_user_id, p_module_slug) — BOTH. Calling it with
  // only the slug failed silently, the role came back null, and movesFor() then
  // offered nobody any move at all: the approval screen would have had no
  // buttons and no explanation for anyone.
  const { data, error } = await sb.rpc('effective_user_role', {
    p_user_id: me.id,
    p_module_slug: MODULE,
  })
  if (!error && typeof data === 'string' && data) return data

  // Fall back to the base role rather than to null, so a broken RPC degrades to
  // "your plain role" instead of "you may do nothing".
  const { data: prof } = await sb.from('profiles').select('role').eq('id', me.id).maybeSingle()
  return prof?.role ?? null
}
