import 'server-only'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

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

/** Which roles hear each event. Empty = it goes to named people instead. */
const AUDIENCE: Record<StoresEvent, readonly string[]> = {
  // The person who has to go and count the material in.
  mio_gate_waiting: ['store_manager'],
  // The mind map says MA/KK — Mayank (backoffice) and Kanti, who has no CT
  // Hub account yet — plus the admin running the pilot. NOT 'head': that is
  // Hiten, Yash and Amit, and copying three Atmarpit heads on every request
  // for six bags of cement is how a notification becomes something people
  // learn to ignore.
  mio_request_pending: ['admin', 'backoffice'],
  mio_request_decided: [],
  mio_request_issued: [],
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
  requestId: string; no: string; projectName: string | null; lineCount: number; actorId: string
}): Promise<number> {
  try {
    const ids = (await idsWithRole(AUDIENCE.mio_request_pending)).filter(id => id !== input.actorId)
    return await send(
      ids, 'mio_request_pending',
      `Material request to approve — ${input.no}`,
      `${input.lineCount} item${input.lineCount === 1 ? '' : 's'}${input.projectName ? ` for ${input.projectName}` : ''}.`,
      '/stores/requests?status=pending',
      { requestNo: input.no, project: input.projectName },
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
