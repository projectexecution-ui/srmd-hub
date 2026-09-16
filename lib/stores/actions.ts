'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getMyProfile } from '@/lib/auth'
import {
  entryNo, checkIssue, checkReturn, createsStock, approversForRequest, disciplineFromIn4Type,
  canCorrectEntry, canVoidEntry, routeRequest, approverLabel, type Register,
} from './core'
import { isCorrectable } from './desk'
import { crossProjectOn, CROSS_PROJECT_KEY } from './settings'
import { loadStock, loadReturnables } from './queries'
import { formatINR } from '@/lib/utils'
import {
  notifyGateWaiting, notifyRequestPending, notifyRequestDecided, notifyRequestIssued,
} from './notify'

/**
 * Every write in the Stores section.
 *
 * Two rules hold throughout:
 *   1. The ledger (`mio_movements`) is append-only and signed. Nothing ever
 *      updates a stock total, because no stock total is stored.
 *   2. A refusal always carries a reason the person can act on. A greyed
 *      button that will not say why is the thing Aksha keeps asking me not
 *      to ship.
 */

export interface Result<T = void> { ok: boolean; message: string; data?: T }

const fail = (message: string): Result<never> => ({ ok: false, message })
const done = <T>(message: string, data?: T): Result<T> => ({ ok: true, message, data })

/** Turn a Supabase error into something a storekeeper can read. */
function explain(error: { code?: string; message?: string } | null, doing: string): string {
  if (!error) return `Could not ${doing}.`
  if (error.code === 'DEMO_READ_ONLY') return 'This is the trial site — nothing is saved here.'
  if (error.code === '42501') return `You do not have permission to ${doing}. Ask Aksha to grant it.`
  if (error.code === '23505') return 'That already exists.'
  if (error.code === '23503') return 'Something this refers to no longer exists — reload and try again.'
  return error.message ?? `Could not ${doing}.`
}

async function me() {
  const profile = await getMyProfile()
  if (!profile) throw new Error('Not signed in.')
  return profile
}

/* ── Step 1 · Security records the vehicle ──────────────────────────────── */

export interface GateInput {
  register: Register
  partyName: string
  /** IN4's supplier id when the gate picked from the list. Null when the name
   *  was typed, which stays allowed — a shop IN4 has never heard of must still
   *  be recordable at the gate. */
  in4PartyId?: number | null
  vehicleNo?: string
  driverName?: string
  driverMobile?: string
  driverLicence?: string
  deliveryModeId?: string | null
  remarks?: string
}

/**
 * The guard's half. Deliberately small: nine things and the papers.
 *
 * It asks for nothing the guard cannot know — no item, no rate, no project.
 * That is the whole point of the two-man gate, and the reason this can be
 * done on a phone in two minutes.
 */
export async function createGateEntry(input: GateInput): Promise<Result<{ id: string; no: string }>> {
  const profile = await me()
  const supabase = await createClient()

  if (!input.partyName?.trim()) return fail('Say who is delivering before saving.')

  const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  const isoDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

  const { data: seq, error: seqErr } = await supabase.rpc('fn_mio_next_seq', { p_direction: 'in', p_date: isoDate })
  if (seqErr) return fail(explain(seqErr, 'take a gate number'))

  const no = entryNo('in', isoDate, Number(seq) || 1)
  const { data, error } = await supabase
    .from('mio_entries')
    .insert({
      direction: 'in', register: input.register, no, seq: Number(seq) || 1, entry_date: isoDate,
      stage: 'gate',
      party_name: input.partyName.trim(),
      in4_party_id: input.in4PartyId ?? null,
      vehicle_no: input.vehicleNo?.trim() || null,
      driver_name: input.driverName?.trim() || null,
      driver_mobile: input.driverMobile?.trim() || null,
      driver_licence: input.driverLicence?.trim() || null,
      delivery_mode_id: input.deliveryModeId || null,
      remarks: input.remarks?.trim() || null,
      security_by: profile.full_name ?? profile.email,
      security_signed_by: profile.id,
      security_signed_at: new Date().toISOString(),
      created_by: profile.id,
    })
    .select('id, no')
    .single()

  if (error) return fail(explain(error, 'save the gate entry'))

  // Somebody has to go and count it in. The previous warehouse module recorded
  // this perfectly and told nobody, and that is why it was never used.
  await notifyGateWaiting({
    entryId: data.id as string, no, party: input.partyName.trim() || null, actorId: profile.id,
  })
  revalidatePath('/stores')
  return done(`Saved as ${no}. The storekeeper can see it now.`, { id: data.id as string, no: data.no as string })
}

/* ── Step 2 · The storekeeper completes it ──────────────────────────────── */

export interface CompleteInput {
  entryId: string
  entityId: string | null
  projectId: string | null
  poWoNo?: string
  itemCategoryId?: string | null
  locationId: string | null
  inchargeName?: string
  lines: Array<{ itemId: string; unit: string; qty: number; rate: number | null; returnable: boolean; in4PoItemId?: number | null }>
}

/**
 * The storekeeper's half — and the moment stock is created.
 *
 * A VENDOR entry is the deliberate exception: material delivered to a site is
 * not stock, so only its returnable lines are written and no movement is made.
 * Counting vendor deliveries into a stock ledger would create a balance that
 * nobody ever consumes and that every report would then have to explain away.
 */
export async function completeGateEntry(input: CompleteInput): Promise<Result> {
  const profile = await me()
  const supabase = await createClient()

  const { data: entry } = await supabase
    .from('mio_entries').select('id, no, register, stage, direction').eq('id', input.entryId).maybeSingle()
  if (!entry) return fail('That gate entry no longer exists.')
  if (entry.stage === 'void') return fail('That entry was voided. Raise a new one.')

  const register = entry.register as Register
  const makesStock = createsStock(register)

  if (!input.entityId) return fail('Pick which trust is paying for this.')
  if (!input.projectId) return fail('Pick which project this is for.')
  if (makesStock && !input.locationId) return fail('Say where the material was put.')

  const lines = (input.lines ?? []).filter(l => l.itemId && l.qty > 0)
  if (makesStock && lines.length === 0) return fail('Add at least one item line — this is what becomes stock.')

  const { error: upErr } = await supabase
    .from('mio_entries')
    .update({
      entity_id: input.entityId,
      project_id: input.projectId,
      po_wo_no: input.poWoNo?.trim() || null,
      item_category_id: input.itemCategoryId || null,
      location_id: input.locationId || null,
      incharge_name: input.inchargeName?.trim() || profile.full_name || null,
      incharge_signed_by: profile.id,
      incharge_signed_at: new Date().toISOString(),
      stage: 'complete',
      completed_by: profile.id,
      completed_at: new Date().toISOString(),
    })
    .eq('id', input.entryId)
  if (upErr) return fail(explain(upErr, 'complete the entry'))

  // Replace rather than append: completing twice must not double the stock.
  // The movements go with them (mio_movements.entry_id cascades), so the
  // ledger cannot keep a line the entry no longer has.
  await supabase.from('mio_movements').delete().eq('entry_id', input.entryId)
  await supabase.from('mio_entry_lines').delete().eq('entry_id', input.entryId)

  if (lines.length) {
    const { error: lineErr } = await supabase.from('mio_entry_lines').insert(
      lines.map(l => ({
        entry_id: input.entryId, item_id: l.itemId, unit: l.unit, qty: l.qty,
        rate: l.rate, amount: l.rate != null ? Number((l.rate * l.qty).toFixed(2)) : null,
        returnable: l.returnable === true,
        in4_po_item_id: l.in4PoItemId ?? null,
      })),
    )
    if (lineErr) return fail(explain(lineErr, 'save the item lines'))

    if (makesStock) {
      const { error: mvErr } = await supabase.from('mio_movements').insert(
        lines.map(l => ({
          item_id: l.itemId, location_id: input.locationId, project_id: input.projectId,
          kind: 'in', qty: l.qty, rate: l.rate, entry_id: input.entryId,
          note: `${entry.no}`, created_by: profile.id,
        })),
      )
      if (mvErr) return fail(explain(mvErr, 'take the material into stock'))
    }

    // What it last cost, kept current so the next issue values itself.
    for (const l of lines) {
      if (l.rate != null) await supabase.from('mio_items').update({ last_rate: l.rate }).eq('id', l.itemId)
    }
  }

  revalidatePath('/stores')
  return done(makesStock
    ? `${entry.no} completed — ${lines.length} line${lines.length === 1 ? '' : 's'} taken into stock.`
    : `${entry.no} completed. Vendor material goes to site, so nothing was added to stock${
        lines.some(l => l.returnable) ? ' — only the returnable lines are being tracked.' : '.'}`)
}

/* ── Step 3 · The engineer asks ─────────────────────────────────────────── */

export interface RequestInput {
  projectId: string
  fromProjectId?: string | null
  neededBy?: string | null
  remarks?: string
  lines: Array<{ itemId: string; unit: string; qty: number; returnable: boolean }>
}

export async function raiseRequest(input: RequestInput): Promise<Result<{ id: string; no: string }>> {
  const profile = await me()
  const supabase = await createClient()

  const lines = (input.lines ?? []).filter(l => l.itemId && l.qty > 0)
  if (!input.projectId) return fail('Pick a project.')
  if (lines.length === 0) return fail('Add at least one item.')

  /**
   * WHERE IT GOES, decided before it is written.
   *
   * Aksha, 16 Sep 2026, changing the mind map, which put MA/KK on every
   * request: own-family stock needs no approval and lands on the storekeeper;
   * approval is the price of borrowing from ANOTHER family. Asked whether
   * anybody signs off on an own-family request, he chose "Nobody — straight to
   * the storekeeper".
   */
  const borrowing = !!input.fromProjectId
  const crossOn = await crossProjectOn()

  // The disciplines decide WHO approves, when anybody does — Civil and
  // Finishes are Mayank's, MEP is Kanti's, and a request holding both is
  // legitimately for both. The mapping is the code on the discipline row, so
  // it is Aksha's to change in Masters rather than mine to compile in.
  const { data: disc } = await supabase
    .from('mio_items')
    .select('discipline:discipline_id ( code )')
    .in('id', lines.map(l => l.itemId))
  const codes = (disc ?? []).map(r => {
    const d = Array.isArray(r.discipline) ? r.discipline[0] : r.discipline
    return (d as { code?: string } | null)?.code ?? null
  })

  const route = routeRequest({
    crossProjectOn: crossOn, isCrossProject: borrowing, disciplineCodes: codes,
  })
  if (route.status === 'blocked') return fail(route.why)

  const { count } = await supabase.from('mio_requests').select('id', { count: 'exact', head: true })
  const no = `REQ/${String((count ?? 0) + 1).padStart(4, '0')}`

  const { data, error } = await supabase
    .from('mio_requests')
    .insert({
      no, project_id: input.projectId,
      // Borrowing from another project's store is always returnable — carried
      // forward from the retired module, where Aksha set the rule.
      from_project_id: input.fromProjectId || null,
      needed_by: input.neededBy || null,
      remarks: input.remarks?.trim() || null,
      raised_by: profile.id,
      status: route.status,
      // Nobody approved an own-family request, and the card must not imply
      // somebody did. The reason stands in for a name.
      decision_note: route.status === 'approved' ? route.why : null,
      decided_at: route.status === 'approved' ? new Date().toISOString() : null,
    })
    .select('id, no')
    .single()
  if (error) return fail(explain(error, 'raise the request'))
  const { error: lineErr } = await supabase.from('mio_request_lines').insert(
    lines.map(l => ({
      request_id: data.id, item_id: l.itemId, unit: l.unit, qty: l.qty,
      returnable: borrowing ? true : l.returnable === true,
    })),
  )
  if (lineErr) return fail(explain(lineErr, 'save the request lines'))

  // Only a request that is actually WAITING on somebody is announced to them.
  // Telling Mayank about a request that went straight to the storekeeper is
  // how a notification becomes something people learn to ignore.
  if (route.status === 'pending') {
    await notifyRequestPending({
      requestId: data.id as string, no, projectName: null,
      lineCount: lines.length, approvers: route.approvers, actorId: profile.id,
    })
  }

  revalidatePath('/stores')
  return done(
    route.status === 'pending'
      ? `${no} sent to ${approverLabel(route.approvers)} for approval.`
      : `${no} is with the storekeeper. ${route.why}`,
    { id: data.id as string, no },
  )
}

/* ── The one switch an admin owns ───────────────────────────────────────── */

/**
 * Turn borrowing from another project on or off.
 *
 * Aksha, 16 Sep 2026: "i want to know about if i want to make toggle Cross
 * Project request admin should be able to on and off the same whenever
 * requred". One switch, and it changes a whole behaviour rather than storing a
 * value — see lib/stores/settings.ts for what moves with it.
 *
 * Admin, founder and head only: it decides whether material can leave a
 * project's stock for somebody else's site, which is not a storekeeper's call.
 */
export async function setCrossProject(on: boolean): Promise<Result> {
  const profile = await me()
  if (!canVoidEntry(profile.role)) {
    return fail('Only a head or an admin can switch borrowing between projects on or off.')
  }
  const supabase = await createClient()
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key: CROSS_PROJECT_KEY, value: on ? 'on' : 'off' }, { onConflict: 'key' })
  if (error) return fail(explain(error, 'save the setting'))

  revalidatePath('/stores')
  return done(on
    ? 'Borrowing between projects is ON. Those requests now go to Mayank or Kanti first, and what is borrowed has to come back.'
    : 'Borrowing between projects is OFF. Each site asks for its own family’s stock, and it goes straight to the storekeeper.')
}

export async function decideRequest(requestId: string, approve: boolean, note?: string): Promise<Result> {
  const profile = await me()
  const supabase = await createClient()

  const { data: req } = await supabase.from('mio_requests').select('id, no, status, raised_by').eq('id', requestId).maybeSingle()
  if (!req) return fail('That request no longer exists.')
  if (req.status !== 'pending') return fail(`${req.no} has already been ${req.status}.`)

  // A rejection without a reason leaves the engineer with nothing to do next.
  if (!approve && !note?.trim()) return fail('Say why it is being rejected — the engineer needs to know what to do instead.')

  const { error } = await supabase
    .from('mio_requests')
    .update({
      status: approve ? 'approved' : 'rejected',
      decided_by: profile.id, decided_at: new Date().toISOString(),
      decision_note: note?.trim() || null,
    })
    .eq('id', requestId)
  if (error) return fail(explain(error, 'record the decision'))

  // A rejection the engineer never sees is the same as no decision at all —
  // and the reason is the only useful part of it.
  await notifyRequestDecided({
    requestId, no: req.no as string, approved: approve, note: note?.trim() || null,
    raisedBy: (req.raised_by as string | null) ?? null, actorId: profile.id,
  })
  revalidatePath('/stores')
  return done(approve ? `${req.no} approved — the storekeeper can issue it now.` : `${req.no} rejected.`)
}

/* ── Step 4 · Issued out ────────────────────────────────────────────────── */

export interface IssueInput {
  requestId: string
  locationId: string
  deliveryModeId?: string | null
  handedOverTo?: string
  remarks?: string
  lines: Array<{ requestLineId: string; itemId: string; unit: string; qty: number; returnable: boolean }>
}

/**
 * Issue against an approved request — the one place stock leaves.
 *
 * Every line is checked against the folded ledger BEFORE anything is written,
 * and the whole issue is refused if any line fails. A half-written issue would
 * leave the register saying one thing and the stock another.
 */
export async function issueRequest(input: IssueInput): Promise<Result<{ id: string; no: string }>> {
  const profile = await me()
  const supabase = await createClient()

  const { data: req } = await supabase
    .from('mio_requests').select('id, no, status, project_id, from_project_id, raised_by').eq('id', input.requestId).maybeSingle()
  if (!req) return fail('That request no longer exists.')
  if (req.status !== 'approved') {
    return fail(req.status === 'pending'
      ? `${req.no} has not been approved yet.`
      : `${req.no} is ${req.status} — nothing more can be issued against it.`)
  }
  if (!input.locationId) return fail('Pick which store it is going out of.')

  const lines = (input.lines ?? []).filter(l => l.itemId && l.qty > 0)
  if (lines.length === 0) return fail('Nothing to issue — set a quantity on at least one line.')

  // Check EVERY line first. Report all the failures at once so the storekeeper
  // fixes the issue in one pass rather than being told about them one by one.
  const stock = await loadStock()
  const problems: string[] = []
  for (const l of lines) {
    const check = checkIssue(stock, l.itemId, input.locationId, l.qty)
    if (!check.ok) {
      const { data: item } = await supabase.from('mio_items').select('name').eq('id', l.itemId).maybeSingle()
      problems.push(`${item?.name ?? 'Item'}: ${check.reason}`)
    }
  }
  if (problems.length) return fail(problems.join('\n'))

  const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  const isoDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const { data: seq, error: seqErr } = await supabase.rpc('fn_mio_next_seq', { p_direction: 'out', p_date: isoDate })
  if (seqErr) return fail(explain(seqErr, 'take an out number'))

  const no = entryNo('out', isoDate, Number(seq) || 1)
  const { data: entry, error: entryErr } = await supabase
    .from('mio_entries')
    .insert({
      direction: 'out',
      register: req.from_project_id ? 'transfer' : 'srm',
      no, seq: Number(seq) || 1, entry_date: isoDate, stage: 'complete',
      project_id: req.project_id, location_id: input.locationId, request_id: req.id,
      delivery_mode_id: input.deliveryModeId || null,
      handed_over_to: input.handedOverTo?.trim() || null,
      remarks: input.remarks?.trim() || null,
      security_by: profile.full_name ?? profile.email,
      created_by: profile.id, completed_by: profile.id, completed_at: new Date().toISOString(),
    })
    .select('id, no')
    .single()
  if (entryErr) return fail(explain(entryErr, 'record the issue'))

  const { data: items } = await supabase.from('mio_items').select('id, last_rate').in('id', lines.map(l => l.itemId))
  const rateOf = new Map((items ?? []).map(i => [i.id as string, i.last_rate == null ? null : Number(i.last_rate)]))

  const { error: lineErr } = await supabase.from('mio_entry_lines').insert(
    lines.map(l => {
      const rate = rateOf.get(l.itemId) ?? null
      return {
        entry_id: entry.id, item_id: l.itemId, unit: l.unit, qty: l.qty,
        rate, amount: rate != null ? Number((rate * l.qty).toFixed(2)) : null,
        returnable: l.returnable === true,
      }
    }),
  )
  if (lineErr) return fail(explain(lineErr, 'save the issued lines'))

  const { error: mvErr } = await supabase.from('mio_movements').insert(
    lines.map(l => ({
      item_id: l.itemId, location_id: input.locationId, project_id: req.project_id,
      kind: 'out', qty: -Math.abs(l.qty), rate: rateOf.get(l.itemId) ?? null,
      entry_id: entry.id, note: no, created_by: profile.id,
    })),
  )
  if (mvErr) return fail(explain(mvErr, 'take the material out of stock'))

  for (const l of lines) {
    const { data: rl } = await supabase.from('mio_request_lines').select('issued_qty').eq('id', l.requestLineId).maybeSingle()
    await supabase.from('mio_request_lines')
      .update({ issued_qty: Number(rl?.issued_qty ?? 0) + l.qty })
      .eq('id', l.requestLineId)
  }

  // Only close the request when every line has been fully served — a partial
  // issue must leave it open, or the rest is silently forgotten.
  const { data: after } = await supabase.from('mio_request_lines').select('qty, issued_qty').eq('request_id', req.id)
  const fullyServed = (after ?? []).every(l => Number(l.issued_qty) >= Number(l.qty))
  await supabase.from('mio_requests').update({ status: fullyServed ? 'issued' : 'approved' }).eq('id', req.id)

  // The engineer asked for it; they are the one waiting to hear it is coming.
  await notifyRequestIssued({
    no: req.no as string, entryNo: no,
    raisedBy: (req.raised_by as string | null) ?? null,
    actorId: profile.id, complete: fullyServed,
  })
  revalidatePath('/stores')
  return done(fullyServed
    ? `Issued as ${no}. ${req.no} is complete.`
    : `Issued as ${no}. ${req.no} stays open — some quantity is still to go.`,
    { id: entry.id as string, no })
}

/* ── Step 4 · Returned items ─────────────────────────────────────────────── */

export interface ReturnItemsInput {
  /** The IN entry whose returnables are coming back. */
  entryId: string
  lines: Array<{ lineId: string; itemId: string; unit: string; qty: number }>
  handedOverTo?: string
  deliveryModeId?: string | null
  remarks?: string
}

/**
 * Record returnable material going back — the map's Step 4.
 *
 * Until now this was a one-way street: a debt could be created and never
 * cleared, so the "still to come back" list only ever grew and would have
 * stopped being believed within a month.
 *
 * The return is an OUT entry LINKED to the IN it answers, exactly as the map
 * draws it — "Out: 15Aug26 (In: 15Aug26)" — and each returned line points at
 * the original line, so two returnables on one entry settle separately.
 *
 * It does NOT touch stock. A vendor's props were never our stock (vendor
 * material goes to site), and material issued from our store already left it.
 * Writing a movement here would put back something that was never taken.
 */
export async function returnItems(input: ReturnItemsInput): Promise<Result<{ no: string }>> {
  const profile = await me()
  const supabase = await createClient()

  const { data: origin } = await supabase
    .from('mio_entries').select('id, no, register, stage, project_id, party_name')
    .eq('id', input.entryId).maybeSingle()
  if (!origin) return fail('That entry no longer exists.')
  if (origin.stage === 'void') return fail('That entry was voided — there is nothing to return against it.')

  const lines = (input.lines ?? []).filter(l => l.lineId && l.qty > 0)
  if (lines.length === 0) return fail('Set a quantity against at least one line.')

  // Check every line against what is actually still out, and report all the
  // problems at once rather than one per attempt.
  const outstanding = await loadReturnables()
  const problems: string[] = []
  for (const l of lines) {
    const check = checkReturn(outstanding, l.lineId, l.qty)
    if (!check.ok) {
      const row = outstanding.find(r => r.lineId === l.lineId)
      problems.push(`${row?.itemName ?? 'Item'}: ${check.reason}`)
    }
  }
  if (problems.length) return fail(problems.join('\n'))

  const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  const isoDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const { data: seq, error: seqErr } = await supabase.rpc('fn_mio_next_seq', { p_direction: 'out', p_date: isoDate })
  if (seqErr) return fail(explain(seqErr, 'take an out number'))

  const no = entryNo('out', isoDate, Number(seq) || 1)
  const { data: entry, error: entryErr } = await supabase
    .from('mio_entries')
    .insert({
      direction: 'out',
      // A return keeps the register of the entry it answers, so a vendor's
      // props go back on the vendor register and an internal loan on its own.
      register: origin.register,
      no, seq: Number(seq) || 1, entry_date: isoDate, stage: 'complete',
      project_id: origin.project_id,
      linked_entry_id: origin.id,
      party_name: origin.party_name,
      delivery_mode_id: input.deliveryModeId || null,
      handed_over_to: input.handedOverTo?.trim() || null,
      remarks: input.remarks?.trim() || null,
      security_by: profile.full_name ?? profile.email,
      security_signed_by: profile.id, security_signed_at: new Date().toISOString(),
      created_by: profile.id, completed_by: profile.id, completed_at: new Date().toISOString(),
    })
    .select('id, no')
    .single()
  if (entryErr) return fail(explain(entryErr, 'record the return'))

  const { error: lineErr } = await supabase.from('mio_entry_lines').insert(
    lines.map(l => ({
      entry_id: entry.id, item_id: l.itemId, unit: l.unit, qty: l.qty,
      returnable: true, returns_line_id: l.lineId,
    })),
  )
  if (lineErr) return fail(explain(lineErr, 'save the returned lines'))

  const after = await loadReturnables()
  const stillOut = after.filter(r => r.entryId === origin.id).length
  revalidatePath('/stores')
  return done(stillOut === 0
    ? `Returned as ${no}. ${origin.no} is fully settled — nothing more to come back.`
    : `Returned as ${no}. ${stillOut} line${stillOut === 1 ? '' : 's'} on ${origin.no} still to come back.`,
    { no })
}

/* ── The receipt · the engineer signs for what he took ───────────────────── */

/**
 * The map's "SRM Engg receives the materails & checks & Signs", and its
 * "Capture where the materials are being stored".
 *
 * Until now the receiver signature was written by nothing, so every entry
 * showed an empty Receiver box for ever. This is the step that fills it.
 */
export async function confirmReceipt(input: {
  entryId: string
  toLocationId?: string | null
  note?: string
  /** Who actually took delivery, when it was not the person signing. */
  receivedBy?: string
}): Promise<Result> {
  const profile = await me()
  const supabase = await createClient()

  const { data: entry } = await supabase
    .from('mio_entries').select('id, no, direction, stage, receiver_signed_at')
    .eq('id', input.entryId).maybeSingle()
  if (!entry) return fail('That entry no longer exists.')
  if (entry.direction !== 'out') return fail('Only material going out is signed for on receipt.')
  if (entry.stage === 'void') return fail('That entry was voided.')
  if (entry.receiver_signed_at) return fail('This has already been signed for.')

  const { error } = await supabase
    .from('mio_entries')
    .update({
      receiver_signed_by: profile.id,
      receiver_signed_at: new Date().toISOString(),
      handed_over_to: input.receivedBy?.trim() || profile.full_name || profile.email,
      to_location_id: input.toLocationId || null,
      // Only WRITE a note when one was typed. Setting it unconditionally
      // wiped whatever the storekeeper had put in remarks at issue time —
      // signing for a delivery should not delete what was said about it.
      ...(input.note?.trim() ? { remarks: input.note.trim() } : {}),
      stage: 'closed',
    })
    .eq('id', input.entryId)
  if (error) return fail(explain(error, 'sign for this'))

  revalidatePath('/stores')
  return done(`Signed for. ${entry.no} is closed.`)
}

/* ── Corrections — Aksha, 13 Sep 2026: "yes", entries are editable ──────── */

/**
 * Correct a saved entry, keeping what it said before.
 *
 * A register nobody can fix gets abandoned; a register that quietly rewrites
 * itself is worse than none. So the value changes AND the old one is kept,
 * with who and when — and the entry shows a "corrected" marker afterwards.
 */
export async function correctEntry(
  entryId: string, field: string, newValue: string, reason?: string,
): Promise<Result> {
  const profile = await me()
  if (!canCorrectEntry(profile.role)) {
    return fail('Only the people who record entries — Security, the storekeeper, or a head — can correct one.')
  }
  const supabase = await createClient()

  // The direction decides which fields exist and what they are called, so the
  // entry is read first and the field checked against ITS list.
  const { data: head } = await supabase
    .from('mio_entries').select('id, no, direction, stage').eq('id', entryId).maybeSingle()
  if (!head) return fail('That entry no longer exists.')

  const spec = isCorrectable(head.direction as 'in' | 'out', field)
  if (!spec) return fail('That field cannot be corrected here.')

  // The column is chosen at runtime from the list above, so the generated
  // types cannot name it — hence the cast. isCorrectable is what keeps this
  // from being a way to read or write an arbitrary column.
  const { data: entry } = await supabase
    .from('mio_entries').select(`id, ${field}`).eq('id', entryId).maybeSingle()
  if (!entry) return fail('That entry no longer exists.')

  const oldValue = (entry as unknown as Record<string, unknown>)[field]
  const oldText = oldValue == null ? null : String(oldValue)
  const newText = newValue.trim() || null
  if (oldText === newText) return fail('Nothing changed.')

  const { error } = await supabase.from('mio_entries').update({ [field]: newText }).eq('id', entryId)
  if (error) return fail(explain(error, 'save the correction'))

  /**
   * THE LEDGER FOLLOWS THE CORRECTION.
   *
   * `mio_movements` carries its own project_id and location_id, copied from
   * the entry when the stock was created. Correcting the entry alone would
   * leave the entry saying NGH B and the stock screen still showing the
   * material under NGH — two answers to one question, which is exactly what
   * folding stock from the ledger was meant to prevent.
   *
   * A voided entry has no movements and a vendor IN never made any, so this
   * is a no-op on both rather than a special case.
   */
  let moved = 0
  if (spec.movesLedger) {
    const { data: rows, error: mvErr } = await supabase
      .from('mio_movements')
      .update({ [field]: newText })
      .eq('entry_id', entryId)
      .select('id')
    if (mvErr) {
      // The entry is already corrected; say what did not follow rather than
      // pretending the whole thing worked or rolling back a saved fact.
      return fail(`${spec.label} was corrected, but the stock did not move with it: ${explain(mvErr, 'move the stock')}`)
    }
    moved = (rows ?? []).length
  }

  await supabase.from('mio_edits').insert({
    table_name: 'mio_entries', row_id: entryId, field: spec.label,
    old_value: oldText, new_value: newText, reason: reason?.trim() || null, changed_by: profile.id,
  })

  revalidatePath('/stores')
  return done(moved > 0
    ? `${spec.label} corrected, and ${moved} stock line${moved === 1 ? '' : 's'} moved with it. The old value is kept.`
    : `${spec.label} corrected. The old value is kept on the entry.`)
}

/** Recorded in error. Kept and marked, never deleted — and its movements go,
 *  so a mistaken entry cannot leave phantom stock behind. */
export async function voidEntry(entryId: string, reason: string): Promise<Result> {
  const profile = await me()
  if (!canVoidEntry(profile.role)) {
    return fail('Voiding takes the stock back off the ledger, so it is left to a head or an admin. Ask one of them, or correct the entry instead.')
  }
  const supabase = await createClient()
  if (!reason?.trim()) return fail('Say why it is being voided.')

  const { data: entry } = await supabase.from('mio_entries').select('id, no').eq('id', entryId).maybeSingle()
  if (!entry) return fail('That entry no longer exists.')

  await supabase.from('mio_movements').delete().eq('entry_id', entryId)
  const { error } = await supabase.from('mio_entries').update({ stage: 'void' }).eq('id', entryId)
  if (error) return fail(explain(error, 'void the entry'))

  await supabase.from('mio_edits').insert({
    table_name: 'mio_entries', row_id: entryId, field: 'Voided',
    old_value: 'active', new_value: 'void', reason: reason.trim(), changed_by: profile.id,
  })

  revalidatePath('/stores')
  return done(`${entry.no} voided. It stays in the register, marked.`)
}

/* ── Masters ────────────────────────────────────────────────────────────── */

export async function saveListRow(input: {
  id?: string | null
  kind: 'entity' | 'delivery_mode' | 'item_category' | 'discipline' | 'location' | 'unit'
  name: string
  code?: string | null
  parentId?: string | null
  projectId?: string | null
  in4CompanyId?: number | null
  displayOrder?: number
}): Promise<Result> {
  const supabase = await createClient()
  if (!input.name?.trim()) return fail('Give it a name.')

  const row = {
    kind: input.kind, name: input.name.trim(), code: input.code?.trim() || null,
    parent_id: input.parentId || null, project_id: input.projectId || null,
    in4_company_id: input.in4CompanyId ?? null,
    display_order: input.displayOrder ?? 999,
  }
  const { error } = input.id
    ? await supabase.from('mio_lists').update(row).eq('id', input.id)
    : await supabase.from('mio_lists').insert(row)
  if (error) return fail(explain(error, 'save that'))

  revalidatePath('/stores')
  return done(input.id ? 'Saved.' : `${row.name} added.`)
}

/** Deactivate, never delete — an entry from last month still points at it. */
export async function setListActive(id: string, isActive: boolean): Promise<Result> {
  const supabase = await createClient()
  const { error } = await supabase.from('mio_lists').update({ is_active: isActive }).eq('id', id)
  if (error) return fail(explain(error, 'change that'))
  revalidatePath('/stores')
  return done(isActive ? 'Back in use.' : 'Retired — old entries keep it, new ones will not offer it.')
}

/**
 * Add an item, optionally pinned to an IN4 material.
 *
 * A storekeeper must be able to do this at the gate: if something arrives that
 * IN4 has never carried, refusing to record it would stop the lorry.
 */
/** What an item can be changed on, and what to call it in the history. */
const ITEM_FIELDS: Record<string, string> = {
  name: 'Name',
  unit: 'Unit',
  discipline_id: 'Discipline',
  last_rate: 'Rate',
}

/**
 * Add an item, or change one — and keep what it said before.
 *
 * Aksha, 16 Sep 2026: "What about Items rate where can i change if i need also
 * i will need all the data should be recorded and what all changes is done to
 * that item should also come". The action has always accepted a rate; nothing
 * ever offered one, and nothing recorded a change.
 *
 * TWO THINGS IT NO LONGER DOES. It used to write every column on an update,
 * so editing a name would blank the IN4 link, the discipline and the rate of
 * anything that did not re-send them — 14 items are linked to IN4 materials
 * and 667 carry a discipline, all of it silently losable. Only fields actually
 * passed are touched now.
 *
 * And every change is written to `mio_edits` beside the gate entries', so the
 * item card can show who changed a rate and when. A rate that moves with no
 * name against it is a rate nobody can defend in a review.
 */
export async function saveItem(input: {
  id?: string | null
  name: string
  unit?: string
  in4MaterialId?: number | null
  disciplineId?: string | null
  lastRate?: number | null
  /** Why — optional, and the thing that makes the history readable later. */
  reason?: string
}): Promise<Result<{ id: string; changed: string[] }>> {
  const profile = await me()
  if (!canCorrectEntry(profile.role)) {
    return fail('Only the people who keep the store can add or change an item.')
  }
  const supabase = await createClient()
  if (!input.name?.trim()) return fail('Give the item a name.')

  /* ── New item ─────────────────────────────────────────────────────────── */
  if (!input.id) {
    const { data, error } = await supabase
      .from('mio_items')
      .insert({
        name: input.name.trim(),
        unit: input.unit?.trim() || 'Nos',
        in4_material_id: input.in4MaterialId ?? null,
        discipline_id: input.disciplineId || null,
        last_rate: input.lastRate ?? null,
      })
      .select('id').single()
    if (error) return fail(explain(error, 'save the item'))
    revalidatePath('/stores')
    return done(`${input.name.trim()} added.`, { id: data.id as string, changed: [] })
  }

  /* ── Changing one ─────────────────────────────────────────────────────── */
  const { data: before } = await supabase
    .from('mio_items')
    .select('id, name, unit, discipline_id, last_rate')
    .eq('id', input.id).maybeSingle()
  if (!before) return fail('That item no longer exists.')

  // Only what was actually sent, and only where it actually differs.
  const wanted: Record<string, unknown> = { name: input.name.trim() }
  if (input.unit !== undefined) wanted.unit = input.unit?.trim() || 'Nos'
  if (input.disciplineId !== undefined) wanted.discipline_id = input.disciplineId || null
  if (input.lastRate !== undefined) wanted.last_rate = input.lastRate

  const patch: Record<string, unknown> = {}
  const edits: Array<{ field: string; oldValue: string | null; newValue: string | null }> = []
  for (const [col, next] of Object.entries(wanted)) {
    const prev = (before as Record<string, unknown>)[col]
    const same = prev == null && next == null
      ? true
      : String(prev ?? '') === String(next ?? '')
    if (same) continue
    patch[col] = next
    edits.push({
      field: ITEM_FIELDS[col] ?? col,
      oldValue: prev == null ? null : String(prev),
      newValue: next == null ? null : String(next),
    })
  }

  if (edits.length === 0) return fail('Nothing changed.')

  const { error } = await supabase.from('mio_items').update(patch).eq('id', input.id)
  if (error) return fail(explain(error, 'save the item'))

  // Names rather than ids in the history where a name exists — "Discipline:
  // 3f2a… → 91bc…" is not a record anybody can read in six months.
  const ids = edits
    .filter(e => e.field === 'Discipline')
    .flatMap(e => [e.oldValue, e.newValue])
    .filter(Boolean) as string[]
  const names = new Map<string, string>()
  if (ids.length) {
    const { data: rows } = await supabase.from('mio_lists').select('id, name').in('id', ids)
    for (const r of rows ?? []) names.set(r.id as string, r.name as string)
  }

  await supabase.from('mio_edits').insert(edits.map(e => ({
    table_name: 'mio_items',
    row_id: input.id,
    field: e.field,
    old_value: e.oldValue == null ? null : names.get(e.oldValue) ?? e.oldValue,
    new_value: e.newValue == null ? null : names.get(e.newValue) ?? e.newValue,
    reason: input.reason?.trim() || null,
    changed_by: profile.id,
  })))

  revalidatePath('/stores')
  return done(
    `${edits.map(e => e.field).join(' and ')} changed. The old value is kept.`,
    { id: input.id, changed: edits.map(e => e.field) },
  )
}

/**
 * Pull an IN4 material into the item master, with its unit and last purchase
 * rate. Idempotent — importing the same material twice returns the existing
 * row rather than failing, because the storekeeper will do exactly that.
 */
export async function importIn4Material(materialId: number): Promise<Result<{ id: string; name: string }>> {
  const supabase = await createClient()

  const { data: existing } = await supabase
    .from('mio_items').select('id, name').eq('in4_material_id', materialId).maybeSingle()
  if (existing) return done(`${existing.name} is already in the item list.`, { id: existing.id as string, name: existing.name as string })

  const { data: mat } = await supabase
    .from('in4_materials').select('id, name, uom, type_name').eq('id', materialId).maybeSingle()
  if (!mat) return fail('IN4 does not have that material.')

  const [{ data: rate }, { data: discs }] = await Promise.all([
    supabase.from('in4_last_po_by_material').select('rate').eq('material_id', materialId).maybeSingle(),
    supabase.from('mio_lists').select('id, name').eq('kind', 'discipline').eq('is_active', true),
  ])

  // CARRY THE DISCIPLINE ACROSS. It decides whether the item's requests reach
  // Mayank or Kanti, and IN4 already knows: it files every material under a
  // type like "12 (M) Finishes". Importing without it produced nine tiles that
  // were Finishes in IN4 and belonged to nobody here.
  const disciplineId = disciplineFromIn4Type(
    mat.type_name as string | null,
    (discs ?? []).map(d => ({ id: d.id as string, name: d.name as string })),
  )

  const { data, error } = await supabase
    .from('mio_items')
    .insert({
      name: mat.name as string, unit: (mat.uom as string) || 'Nos',
      in4_material_id: materialId,
      discipline_id: disciplineId,
      last_rate: rate?.rate == null ? null : Number(rate.rate),
    })
    .select('id, name')
    .single()
  if (error) return fail(explain(error, 'add the item'))

  revalidatePath('/stores')
  return done(`${mat.name} added${rate?.rate != null ? ` at ${formatINR(rate.rate)}` : ''}.`,
    { id: data.id as string, name: data.name as string })
}

/** Opening stock — one adjustment per item per place, before the gate starts.
 *  This is what the Odoo export will drive; until it arrives it is typed. */
export async function setOpeningStock(input: {
  itemId: string; locationId: string; qty: number; rate?: number | null; note?: string
}): Promise<Result> {
  const profile = await me()
  const supabase = await createClient()
  if (!input.itemId || !input.locationId) return fail('Pick an item and a place.')
  if (!(input.qty > 0)) return fail('Opening quantity must be more than zero.')

  const { error } = await supabase.from('mio_movements').insert({
    item_id: input.itemId, location_id: input.locationId,
    kind: 'opening', qty: input.qty, rate: input.rate ?? null,
    note: input.note?.trim() || 'Opening stock', created_by: profile.id,
  })
  if (error) return fail(explain(error, 'set the opening stock'))

  if (input.rate != null) await supabase.from('mio_items').update({ last_rate: input.rate }).eq('id', input.itemId)
  revalidatePath('/stores')
  return done('Opening stock recorded.')
}

/**
 * Record photographs that are already in the bucket.
 *
 * The bytes go from the browser straight to storage (see upload-photos.ts);
 * only the paths come here, so the rows get the same audit stamping as every
 * other write in this file.
 */
export async function recordPhotos(
  entryId: string,
  photos: ReadonlyArray<{ kind: string; path: string }>,
): Promise<Result<{ count: number }>> {
  if (photos.length === 0) return done('Nothing to record.', { count: 0 })
  const me = await getMyProfile()
  if (!me) return fail('Sign in first.')

  const supabase = await createClient()
  const { error } = await supabase.from('mio_photos').insert(
    photos.map(p => ({ entry_id: entryId, kind: p.kind, path: p.path, created_by: me.id })),
  )
  if (error) return fail(explain(error, 'save the photos'))

  revalidatePath('/stores')
  revalidatePath(`/stores/gate/${entryId}`)
  return done(`${photos.length} photo${photos.length === 1 ? '' : 's'} saved.`, { count: photos.length })
}

/* ── Who works where ────────────────────────────────────────────────────── */

/**
 * Put somebody on a site, or take them off it.
 *
 * Aksha, 15 Sep 2026: "i will set that up later - as Eng are not in CT Hub yet
 * - but give me the desk to assign them". This is the desk's two verbs.
 */
export async function assignStaff(
  userId: string, projectId: string, role: 'engineer' | 'site_head',
): Promise<Result> {
  const profile = await me()
  if (!userId || !projectId) return fail('Pick both a person and a project.')

  const supabase = await createClient()
  const { error } = await supabase
    .from('mio_project_staff')
    .upsert(
      { user_id: userId, project_id: projectId, role, is_active: true, created_by: profile.id },
      { onConflict: 'project_id,user_id' },
    )
  if (error) return fail(explain(error, 'assign them to that project'))

  revalidatePath('/stores/masters')
  return done('Added.')
}

export async function unassignStaff(id: string): Promise<Result> {
  await me()
  const supabase = await createClient()
  // Soft — the assignment is history once a request has been raised under it,
  // and a hard delete would make an old request look like it came from nowhere.
  const { error } = await supabase
    .from('mio_project_staff').update({ is_active: false }).eq('id', id)
  if (error) return fail(explain(error, 'remove them from that project'))

  revalidatePath('/stores/masters')
  return done('Removed.')
}

/* ── Saying whose stock it is ───────────────────────────────────────────── */

/**
 * Attach a project to stock that carries none.
 *
 * Aksha's rule, 16 Sep 2026: stock belongs to a PROJECT and can sit in any
 * warehouse — "PO of NGH B Belongs to NGH PRoject - so Eng of NGH Project can
 * call for NGH A,B,C etc Stock". Everything loaded from Odoo arrived without
 * one, because Odoo tracked the shelf and never the project.
 *
 * It writes the project onto the MOVEMENTS, not onto a separate table, so the
 * fold keeps being the single source of what is held and whose it is. Only
 * rows that still carry no project are touched — running it twice cannot
 * reassign stock somebody has already placed, and two people working down the
 * list cannot overwrite each other.
 */
export async function assignStockProject(input: {
  lines: Array<{ itemId: string; locationId: string | null }>
  projectId: string
}): Promise<Result<{ moved: number }>> {
  const profile = await me()
  if (!canCorrectEntry(profile.role)) {
    return fail('Only the people who keep the store can say whose stock it is.')
  }
  if (!input.projectId) return fail('Pick the project this stock belongs to.')
  const lines = (input.lines ?? []).filter(l => l.itemId)
  if (lines.length === 0) return fail('Tick at least one line first.')

  const supabase = await createClient()
  let moved = 0
  for (const l of lines) {
    let q = supabase
      .from('mio_movements')
      .update({ project_id: input.projectId })
      .eq('item_id', l.itemId)
      .is('project_id', null)
    q = l.locationId ? q.eq('location_id', l.locationId) : q.is('location_id', null)

    const { data, error } = await q.select('id')
    if (error) return fail(explain(error, 'assign the stock'))
    moved += (data ?? []).length
  }

  revalidatePath('/stores')
  return done(
    `${moved} stock movement${moved === 1 ? '' : 's'} now belong${moved === 1 ? 's' : ''} to that project.`,
    { moved },
  )
}
