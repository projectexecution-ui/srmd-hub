'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getMyProfile } from '@/lib/auth'
import { entryNo, checkIssue, createsStock, type Register } from './core'
import { FIELD_LANG_KEY, type FieldLang } from './lang'
import { loadStock } from './queries'

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
    })
    .select('id, no')
    .single()
  if (error) return fail(explain(error, 'raise the request'))

  const borrowing = !!input.fromProjectId
  const { error: lineErr } = await supabase.from('mio_request_lines').insert(
    lines.map(l => ({
      request_id: data.id, item_id: l.itemId, unit: l.unit, qty: l.qty,
      returnable: borrowing ? true : l.returnable === true,
    })),
  )
  if (lineErr) return fail(explain(lineErr, 'save the request lines'))

  revalidatePath('/stores')
  return done(`${no} sent to Mayank / Kanti for approval.`, { id: data.id as string, no })
}

export async function decideRequest(requestId: string, approve: boolean, note?: string): Promise<Result> {
  const profile = await me()
  const supabase = await createClient()

  const { data: req } = await supabase.from('mio_requests').select('id, no, status').eq('id', requestId).maybeSingle()
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
export async function issueRequest(input: IssueInput): Promise<Result<{ no: string }>> {
  const profile = await me()
  const supabase = await createClient()

  const { data: req } = await supabase
    .from('mio_requests').select('id, no, status, project_id, from_project_id').eq('id', input.requestId).maybeSingle()
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

  revalidatePath('/stores')
  return done(fullyServed
    ? `Issued as ${no}. ${req.no} is complete.`
    : `Issued as ${no}. ${req.no} stays open — some quantity is still to go.`, { no })
}

/* ── Corrections — Aksha, 13 Sep 2026: "yes", entries are editable ──────── */

const FIELD_LABELS: Record<string, string> = {
  vehicle_no: 'Vehicle number', driver_name: 'Driver name', driver_mobile: 'Driver mobile',
  driver_licence: 'Driver licence', party_name: 'Party', remarks: 'Remarks',
  handed_over_to: 'Handed over to', handed_over_party: 'Handed over party', po_wo_no: 'PO / WO number',
}

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
  const supabase = await createClient()

  if (!(field in FIELD_LABELS)) return fail('That field cannot be corrected here.')

  // The column is chosen at runtime from FIELD_LABELS, so the generated types
  // cannot name it — hence the cast. The `field in FIELD_LABELS` guard above
  // is what keeps this from being a way to read an arbitrary column.
  const { data: entry } = await supabase
    .from('mio_entries').select(`id, no, ${field}`).eq('id', entryId).maybeSingle()
  if (!entry) return fail('That entry no longer exists.')

  const oldValue = (entry as unknown as Record<string, unknown>)[field]
  const oldText = oldValue == null ? null : String(oldValue)
  const newText = newValue.trim() || null
  if (oldText === newText) return fail('Nothing changed.')

  const { error } = await supabase.from('mio_entries').update({ [field]: newText }).eq('id', entryId)
  if (error) return fail(explain(error, 'save the correction'))

  await supabase.from('mio_edits').insert({
    table_name: 'mio_entries', row_id: entryId, field: FIELD_LABELS[field],
    old_value: oldText, new_value: newText, reason: reason?.trim() || null, changed_by: profile.id,
  })

  revalidatePath('/stores')
  return done(`${FIELD_LABELS[field]} corrected. The old value is kept on the entry.`)
}

/** Recorded in error. Kept and marked, never deleted — and its movements go,
 *  so a mistaken entry cannot leave phantom stock behind. */
export async function voidEntry(entryId: string, reason: string): Promise<Result> {
  const profile = await me()
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
  kind: 'entity' | 'delivery_mode' | 'item_category' | 'discipline' | 'location'
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
export async function saveItem(input: {
  id?: string | null
  name: string
  unit: string
  in4MaterialId?: number | null
  disciplineId?: string | null
  lastRate?: number | null
}): Promise<Result<{ id: string }>> {
  const supabase = await createClient()
  if (!input.name?.trim()) return fail('Give the item a name.')

  const row = {
    name: input.name.trim(), unit: input.unit?.trim() || 'Nos',
    in4_material_id: input.in4MaterialId ?? null,
    discipline_id: input.disciplineId || null,
    last_rate: input.lastRate ?? null,
  }
  const { data, error } = input.id
    ? await supabase.from('mio_items').update(row).eq('id', input.id).select('id').single()
    : await supabase.from('mio_items').insert(row).select('id').single()
  if (error) return fail(explain(error, 'save the item'))

  revalidatePath('/stores')
  return done(input.id ? 'Saved.' : `${row.name} added.`, { id: data.id as string })
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
    .from('in4_materials').select('id, name, uom').eq('id', materialId).maybeSingle()
  if (!mat) return fail('IN4 does not have that material.')

  const { data: rate } = await supabase
    .from('in4_last_po_by_material').select('rate').eq('material_id', materialId).maybeSingle()

  const { data, error } = await supabase
    .from('mio_items')
    .insert({
      name: mat.name as string, unit: (mat.uom as string) || 'Nos',
      in4_material_id: materialId,
      last_rate: rate?.rate == null ? null : Number(rate.rate),
    })
    .select('id, name')
    .single()
  if (error) return fail(explain(error, 'add the item'))

  revalidatePath('/stores')
  return done(`${mat.name} added${rate?.rate != null ? ` at ₹${Number(rate.rate).toLocaleString('en-IN')}` : ''}.`,
    { id: data.id as string, name: data.name as string })
}

/**
 * Turn the English line on the gate screens on or off. ADMIN ONLY.
 *
 * Aksha, 13 Sep 2026: "give that option to Admin only to switch on and off".
 * The role is checked HERE rather than relying on the Stores section being
 * admin-only today — when the section widens to storekeepers and guards, this
 * must not widen with it. A guard changing the language of a phone he shares
 * with the next shift is not a setting, it is a prank.
 */
export async function setFieldLang(lang: FieldLang): Promise<Result> {
  const profile = await me()
  if (profile.role !== 'admin') {
    return fail('Only an admin can change the language. Ask Aksha.')
  }
  if (lang !== 'gu' && lang !== 'both') return fail('That is not a language option.')

  const supabase = await createClient()
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key: FIELD_LANG_KEY, value: lang }, { onConflict: 'key' })
  if (error) return fail(explain(error, 'change the language'))

  revalidatePath('/stores')
  return done(lang === 'gu'
    ? 'The gate screens now show Gujarati only.'
    : 'The gate screens now show English above the Gujarati.')
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
