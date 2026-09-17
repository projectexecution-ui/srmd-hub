import 'server-only'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { approverLabel, type ApproverKey } from './core'

/** The service role, the same way every other notifier in the hub gets it:
 *  resolving who holds a role and writing a notification both need to see past
 *  the caller's own RLS. Returns null when the key is absent — a preview build
 *  should go quiet, not crash a gate entry. */
function svcClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createSupabaseClient(url, key, { auth: { persistSession: false } })
}

/**
 * Telling people things.
 *
 * This is the gap that killed the previous warehouse module: everything was
 * recorded correctly and NOBODY WAS EVER TOLD, so the screens were only ever
 * looked at by whoever already knew to look. A lorry stood at the gate until
 * the storekeeper happened to walk past a laptop.
 *
 * Four moments, which are the four hand-offs in the mind map's process:
 *
 *   gate_waiting     Security saved a vehicle  → the storekeeper
 *   request_pending  an engineer asked         → whoever approves
 *   request_decided  approved or rejected      → the engineer who asked
 *   request_issued   the material went out     → the engineer who asked
 *
 * Recipients are resolved by ROLE, not by a list somebody has to maintain. If
 * nobody holds the role, nobody is told — and that is the honest answer rather
 * than a fallback that quietly copies an admin on a message meant for a
 * storekeeper. Today that means the gate messages go nowhere, because the
 * storekeeper accounts exist but nobody has signed in as one yet; they start
 * working the day somebody does, with no code change.
 *
 * Nothing here ever throws. A delivery that cannot be announced must not undo
 * the delivery — the register is the record, the message is a courtesy.
 */

export type StoresEvent =
  | 'mio_gate_waiting'
  | 'mio_request_pending'
  | 'mio_request_decided'
  | 'mio_request_issued'
  | 'mio_borrowed_out'
  | 'mio_borrowed_back'

/** Which roles hear each event. Empty = it goes to named people instead. */
const AUDIENCE: Record<StoresEvent, readonly string[]> = {
  // The person who has to go and count the material in.
  mio_gate_waiting: ['store_manager'],
  // Fallback only — see APPROVER_EMAIL. Used when a request's disciplines do
  // not resolve to a named approver, so a request is never left unannounced.
  // NOT 'head': that is Hiten, Yash and Amit, and copying three Atmarpit heads
  // on every request for six bags of cement is how a notification becomes
  // something people learn to ignore.
  mio_request_pending: ['admin', 'backoffice'],
  mio_request_decided: [],
  mio_request_issued: [],
  // Both of these go to NAMED Atm Heads, resolved per project from
  // cc_project_approvers — see atmHeadsOf. No role audience, because "every
  // head" is exactly the blanket copy the comment above warns about.
  mio_borrowed_out: [],
  mio_borrowed_back: [],
}

async function idsWithRole(roles: readonly string[]): Promise<string[]> {
  if (roles.length === 0) return []
  const svc = svcClient()
  if (!svc) return []
  const { data } = await svc
    .from('profiles')
    .select('id')
    .in('role', roles)
    .eq('is_active', true)
  return (data ?? []).map(r => r.id as string)
}

async function send(
  userIds: readonly string[],
  type: StoresEvent,
  title: string,
  body: string,
  url: string,
  data?: Record<string, unknown>,
): Promise<number> {
  const unique = [...new Set(userIds)].filter(Boolean)
  if (unique.length === 0) return 0

  const svc = svcClient()
  if (!svc) return 0
  let sent = 0
  for (const id of unique) {
    try {
      const { error } = await svc.rpc('notify_user', {
        p_user_id: id,
        p_type: type,
        p_title: title,
        p_body: body,
        p_url: url,
        p_module_slug: 'stores',
        p_doc_table: null,
        p_doc_id: null,
        p_data: data ?? {},
      })
      if (!error) sent++
    } catch { /* one bad recipient never blocks the rest, nor the entry */ }
  }
  return sent
}

/**
 * MA and KK, as people.
 *
 * Aksha, 15 Sep 2026: "Civil & finishes items - approval goes to MA", "MEP
 * related goes to KK". WHICH discipline maps to which is data — it is the code
 * on the discipline row, editable in Masters. WHO MA and KK are is here,
 * because it is two people and it has not changed since the mind map was drawn.
 *
 * Kanti has no CT Hub account. Rather than drop his half of the queue on the
 * floor, anything routed to KK also reaches the admins until he has one, and
 * the message says whose it really is.
 */
const APPROVER_EMAIL: Record<ApproverKey, string | null> = {
  MA: 'mayank.srmd@gmail.com',
  KK: null, // no account yet
}

async function idsForApprovers(keys: readonly ApproverKey[]): Promise<{ ids: string[]; unreachable: ApproverKey[] }> {
  const emails = keys.map(k => APPROVER_EMAIL[k]).filter(Boolean) as string[]
  const unreachable = keys.filter(k => !APPROVER_EMAIL[k])
  const svc = svcClient()
  if (!svc) return { ids: [], unreachable }

  let ids: string[] = []
  if (emails.length) {
    const { data } = await svc.from('profiles').select('id').in('email', emails).eq('is_active', true)
    ids = (data ?? []).map(r => r.id as string)
  }
  // Whoever we could not reach, the admins cover — a request nobody is told
  // about is the failure this whole file exists to prevent.
  if (unreachable.length || ids.length === 0) {
    ids = [...ids, ...(await idsWithRole(AUDIENCE.mio_request_pending))]
  }
  return { ids, unreachable }
}

/** Security has recorded a vehicle. Somebody has to go and count it in. */
export async function notifyGateWaiting(input: {
  entryId: string; no: string; party: string | null; actorId: string
}): Promise<number> {
  try {
    const ids = (await idsWithRole(AUDIENCE.mio_gate_waiting)).filter(id => id !== input.actorId)
    return await send(
      ids, 'mio_gate_waiting',
      `Vehicle at the gate — ${input.no}`,
      input.party
        ? `${input.party} has arrived. Count the material in and take it into stock.`
        : 'A vehicle has been recorded at the gate. Count the material in.',
      `/stores/gate/${input.entryId}`,
      { entryNo: input.no, party: input.party },
    )
  } catch { return 0 }
}

/** An engineer has asked for material. */
export async function notifyRequestPending(input: {
  requestId: string; no: string; projectName: string | null; lineCount: number
  approvers: readonly ApproverKey[]; actorId: string
}): Promise<number> {
  try {
    const { ids, unreachable } = await idsForApprovers(input.approvers)
    const who = approverLabel(input.approvers)
    const note = unreachable.length
      ? ` This one is ${approverLabel(unreachable)}'s — who has no CT Hub account yet, so it is with you.`
      : ''
    return await send(
      ids.filter(id => id !== input.actorId), 'mio_request_pending',
      `Material request for ${who} — ${input.no}`,
      `${input.lineCount} item${input.lineCount === 1 ? '' : 's'}${input.projectName ? ` for ${input.projectName}` : ''}.${note}`,
      '/stores/requests?status=pending',
      { requestNo: input.no, project: input.projectName, approvers: input.approvers },
    )
  } catch { return 0 }
}

/** It was approved or rejected — tell whoever asked. */
export async function notifyRequestDecided(input: {
  requestId: string; no: string; approved: boolean; note: string | null; raisedBy: string | null; actorId: string
}): Promise<number> {
  try {
    if (!input.raisedBy || input.raisedBy === input.actorId) return 0
    return await send(
      [input.raisedBy], 'mio_request_decided',
      input.approved ? `${input.no} approved` : `${input.no} rejected`,
      input.approved
        ? 'The storekeeper can issue it now.'
        : input.note?.trim() || 'No reason was given.',
      '/stores/requests?status=',
      { requestNo: input.no, approved: input.approved },
    )
  } catch { return 0 }
}

/** The material has left the store. */
export async function notifyRequestIssued(input: {
  no: string; entryNo: string; raisedBy: string | null; actorId: string; complete: boolean
}): Promise<number> {
  try {
    if (!input.raisedBy || input.raisedBy === input.actorId) return 0
    return await send(
      [input.raisedBy], 'mio_request_issued',
      `Material issued — ${input.no}`,
      input.complete
        ? `It is on its way, as ${input.entryNo}.`
        : `Part of it is on its way, as ${input.entryNo}. The rest stays open.`,
      '/stores/requests?status=',
      { requestNo: input.no, entryNo: input.entryNo },
    )
  } catch { return 0 }
}

/* ── Borrowing between projects ─────────────────────────────────────────── */

/**
 * The Atm Head of a project, from `cc_project_approvers`.
 *
 * Aksha, 16 Sep 2026: "when the Cross Project is enabled then the data should
 * come to Atm Heads of that particular project that the Items are yet to
 * recieve from the other project".
 *
 * That table is the hub's one answer to "who is the Atm Head of this project"
 * — 68 rows on role `head` across 42 of the 45 projects — so this section asks
 * it rather than growing a second list somebody has to keep in step. Founder
 * and project_head rows are deliberately left out: the Atm Head is the `head`.
 *
 * Walks UP the project tree when a sub-project has nobody of its own, because
 * the heads are generally set on the parent — the Atm Head of Admin Block is
 * the Atm Head of Admin Block Ground Floor, and telling nobody would be worse
 * than telling the parent.
 */
async function atmHeadsOf(projectId: string | null): Promise<string[]> {
  if (!projectId) return []
  const svc = svcClient()
  if (!svc) return []

  const walked = new Set<string>()
  let at = projectId

  // Bounded, and it refuses to revisit — a project that is its own ancestor is
  // bad data, not a reason to loop for ever.
  for (let hop = 0; hop < 6; hop++) {
    const here: string = at
    if (walked.has(here)) break
    walked.add(here)

    const { data } = await svc
      .from('cc_project_approvers').select('user_id').eq('project_id', here).eq('role', 'head')
    const ids = (data ?? []).map(r => r.user_id as string).filter(Boolean)
    if (ids.length) return [...new Set(ids)]

    const up = await svc.from('projects').select('parent_project_id').eq('id', here).maybeSingle()
    const next = (up.data?.parent_project_id ?? null) as string | null
    if (!next) break
    at = next
  }

  /**
   * Nothing above — so look BELOW.
   *
   * Checked against the live table: 42 of the 45 projects carry an Atm Head,
   * and the three that do not are NGH, P2 and VV — the PARENTS. Their heads
   * are set on the children. So a loan out of "NGH" itself would reach nobody
   * by walking up, and NGH holds real stock.
   *
   * The Atm Heads of a family's children are the Atm Heads of that family, so
   * they are the right people to tell. One hop down is enough for the shape
   * this hub actually has.
   */
  const { data: kids } = await svc
    .from('projects').select('id').eq('parent_project_id', projectId)
  const kidIds = (kids ?? []).map(k => k.id as string)
  if (kidIds.length === 0) return []

  const { data: below } = await svc
    .from('cc_project_approvers').select('user_id').in('project_id', kidIds).eq('role', 'head')
  return [...new Set((below ?? []).map(r => r.user_id as string).filter(Boolean))]
}

/** A few item names, for a message that says what actually moved. */
function itemLine(lines: ReadonlyArray<{ name: string; qty: number; unit: string }>): string {
  const first = lines[0]
  if (!first) return 'material'
  const one = `${first.name} ${first.qty} ${first.unit}`.trim()
  return lines.length === 1 ? one : `${one} and ${lines.length - 1} more`
}

/**
 * Material has left THIS project's stock for somebody else's site.
 *
 * Goes to the LENDING project's Atm Head — the one now owed it back. Nobody on
 * the borrowing side needs telling: they asked for it and they are about to
 * sign for it.
 */
export async function notifyBorrowedOut(input: {
  lendingProjectId: string | null
  lendingProjectName: string | null
  toProjectName: string | null
  entryNo: string
  requestNo: string
  lines: ReadonlyArray<{ name: string; qty: number; unit: string }>
  actorId: string
}): Promise<number> {
  try {
    const ids = (await atmHeadsOf(input.lendingProjectId)).filter(id => id !== input.actorId)
    return await send(
      ids, 'mio_borrowed_out',
      `Lent to ${input.toProjectName ?? 'another project'} — ${input.requestNo}`,
      `${itemLine(input.lines)} has gone out of ${input.lendingProjectName ?? 'your project'}'s stock on ${input.entryNo}. It is owed back.`,
      '/stores/returnables',
      { entryNo: input.entryNo, requestNo: input.requestNo, to: input.toProjectName },
    )
  } catch { return 0 }
}

/**
 * It came back, and the storekeeper has booked it in.
 *
 * Aksha: "the same to be notifies to Atm head once this entry is passed SRM
 * IN". A debt that is chased and never closed out loud is one people stop
 * believing, so the settlement is announced as loudly as the loan.
 */
export async function notifyBorrowedBack(input: {
  lendingProjectId: string | null
  lendingProjectName: string | null
  fromProjectName: string | null
  entryNo: string
  lines: ReadonlyArray<{ name: string; qty: number; unit: string }>
  actorId: string
}): Promise<number> {
  try {
    const ids = (await atmHeadsOf(input.lendingProjectId)).filter(id => id !== input.actorId)
    return await send(
      ids, 'mio_borrowed_back',
      `Returned by ${input.fromProjectName ?? 'another project'} — ${input.entryNo}`,
      `${itemLine(input.lines)} is back in ${input.lendingProjectName ?? 'your project'}'s stock.`,
      '/stores/returnables',
      { entryNo: input.entryNo, from: input.fromProjectName },
    )
  } catch { return 0 }
}
