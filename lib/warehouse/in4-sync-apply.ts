import { createClient } from '@/lib/supabase/server'
import { in4Key } from './in4-items'
import { getSyncPreview, readExisting, type SupabaseLike } from './in4-sync-data'
import type { SyncGroup } from './in4-sync'

/** Writing the plan.
 *
 *  Separated from the server action so the SAME code runs whether an admin
 *  presses the button or an IN4 upload triggers it — one path, so the automatic
 *  run can never behave differently from the one somebody watched.
 *
 *  Everything is batched. The first version inserted purchase orders one at a
 *  time, which is fine for the twelve a week that normally arrive and hopeless
 *  for the 1,223 of a first load — and it has to be quick enough to sit inside
 *  an upload request. */

export type SyncOutcome = {
  ok: true
  itemsCreated: number
  itemsAdopted: number
  unitsCreated: number
  disciplinesCreated: number
  posCreated: number
  poLinesCreated: number
  skipped: string[]
} | { ok: false; error: string }

const CHUNK = 200

function chunked<T>(rows: T[], size = CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size))
  return out
}

export async function runIn4Sync(groups: SyncGroup[], actorId: string | null, client?: SupabaseLike): Promise<SyncOutcome> {
  if (groups.length === 0) return { ok: false, error: 'Nothing was selected to bring across.' }

  // The IN4 live sync runs from a cron with no cookies and passes the service
  // role in; the settings page and the upload route use the request client.
  const sb = (client ?? await createClient()) as Awaited<ReturnType<typeof createClient>>
  const preview = await getSyncPreview(client)
  if (preview.error) return { ok: false, error: `Could not read the uploads: ${preview.error}` }

  const p = preview.plan
  const want = new Set(groups)
  const skipped: string[] = []
  let itemsCreated = 0, itemsAdopted = 0, unitsCreated = 0, disciplinesCreated = 0
  let posCreated = 0, poLinesCreated = 0

  // A PO line has to point at an item, so items come first even when only POs
  // were asked for.
  const needItems = want.has('items') || want.has('pos')
  if (want.has('pos') && !want.has('items') && (p.items.create.length + p.items.adopt.length > 0)) {
    skipped.push(
      `${p.items.create.length + p.items.adopt.length} items had to be added anyway — a PO line has to point at an item.`,
    )
  }

  const itemIdByKey = new Map<string, string>()
  const { have } = await readExisting(client)
  for (const [k, v] of have.byIn4Key) itemIdByKey.set(k, v.id)

  // The rate a newly created item starts with, taken from the PO that is about
  // to be imported. Existing items are left alone — the gate rewrites last_rate
  // on every receipt anyway, so it stays current through use.
  const rateByKey = new Map<string, number>()
  for (const po of p.pos.create) {
    for (const l of po.lines) {
      if (l.rate && l.rate > 0 && !rateByKey.has(l.itemKey)) rateByKey.set(l.itemKey, l.rate)
    }
  }

  if (needItems) {
    // Adopt first: linking the item we already hold is what stops a second copy
    // existing and splitting its stock.
    for (const a of p.items.adopt) {
      const { error } = await sb
        .from('wh_items')
        .update({ in4_name: a.name, in4_uom: a.unit, source: 'in4', discipline: a.discipline })
        .eq('id', a.adoptItemId!)
        .is('in4_name', null)                     // never overwrite an existing link
      if (error) return { ok: false, error: `Could not link an existing item: ${error.message}` }
      itemIdByKey.set(a.key, a.adoptItemId!)
      itemsAdopted++
    }

    for (const batch of chunked(p.items.create)) {
      const { data, error } = await sb
        .from('wh_items')
        .insert(batch.map(it => ({
          name: it.name,
          unit: it.unit,
          discipline: it.discipline,
          source: 'in4',
          in4_name: it.name,
          in4_uom: it.unitDefaulted ? null : it.unit,
          last_rate: rateByKey.get(it.key) ?? null,
          created_by: actorId,
        })))
        .select('id, in4_name')
      if (error) return { ok: false, error: `Could not add the items: ${error.message}` }
      for (const row of data ?? []) if (row.in4_name) itemIdByKey.set(in4Key(row.in4_name), row.id)
      itemsCreated += data?.length ?? 0
    }
  }

  if (want.has('units') && p.units.create.length > 0) {
    const { data, error } = await sb
      .from('wh_lists')
      .upsert(p.units.create.map(v => ({ kind: 'unit', value: v })),
        { onConflict: 'kind,value', ignoreDuplicates: true })
      .select('id')
    if (error) return { ok: false, error: `Could not add the units: ${error.message}` }
    unitsCreated = data?.length ?? 0
  }

  if (want.has('disciplines') && p.disciplines.create.length > 0) {
    const { data, error } = await sb
      .from('wh_lists')
      .upsert(p.disciplines.create.map(v => ({ kind: 'discipline', value: v })),
        { onConflict: 'kind,value', ignoreDuplicates: true })
      .select('id')
    if (error) return { ok: false, error: `Could not add the trades: ${error.message}` }
    disciplinesCreated = data?.length ?? 0
  }

  if (want.has('pos')) {
    // Only POs with at least one line that resolves to a real item — a header
    // with no lines reads as a suppressed entry.
    const usable = p.pos.create
      .map(po => ({
        po,
        lines: po.lines
          .map(l => ({ itemId: itemIdByKey.get(l.itemKey), qty: l.qty, rate: l.rate }))
          .filter((l): l is { itemId: string; qty: number; rate: number | null } => Boolean(l.itemId)),
      }))
      .filter(x => x.lines.length > 0)

    for (const batch of chunked(usable, 100)) {
      const { data, error } = await sb
        .from('wh_po')
        .insert(batch.map(({ po }) => ({
          po_no: po.poNo,
          po_date: isoOrNull(po.poDate),
          vendor: po.vendor,
          entity: po.entity,
          project_id: po.projectId,
          indent_no: po.indentNo,
          source: 'tracker',
          created_by: actorId,
        })))
        .select('id, po_no')
      if (error) {
        // A PO number that appeared between the preview and now is not a failure
        // worth losing the whole run over.
        if (/duplicate|unique/i.test(error.message)) {
          skipped.push('Some purchase orders were already imported by the time this ran, and were left alone.')
          continue
        }
        return { ok: false, error: `Could not add the purchase orders: ${error.message}` }
      }
      const idByNo = new Map((data ?? []).map(r => [r.po_no, r.id]))
      posCreated += data?.length ?? 0

      const lineRows = batch.flatMap(({ po, lines }) => {
        const poId = idByNo.get(po.poNo)
        if (!poId) return []
        return lines.map(l => ({ po_id: poId, item_id: l.itemId, ordered_qty: l.qty, rate: l.rate }))
      })
      for (const lineBatch of chunked(lineRows, 500)) {
        const { error: lErr } = await sb.from('wh_po_lines').insert(lineBatch)
        if (lErr) return { ok: false, error: `Could not add the purchase order lines: ${lErr.message}` }
        poLinesCreated += lineBatch.length
      }
    }
  }

  return {
    ok: true, itemsCreated, itemsAdopted, unitsCreated, disciplinesCreated,
    posCreated, poLinesCreated, skipped,
  }
}

/** IN4 writes dates like "Apr 22, 2023". */
function isoOrNull(s: string | null): string | null {
  if (!s) return null
  const t = Date.parse(s)
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10)
}
