/** Loads one day of the ledger for the daily movement report. */

import { createClient } from '@/lib/supabase/server'
import { one } from './data'
import type { DayMovement } from './daily'
import type { MovementKind } from './ledger'

/** Every movement posted on one IST day.
 *
 *  Read from `wh_movements` rather than from the gate entries, because the
 *  ledger is the only place that has ALL of it — a count correction and a void
 *  reversal never appear as a gate entry, and those are precisely the two
 *  things a daily report exists to surface. */
export async function getDayMovements(
  day: string,
): Promise<{ rows: DayMovement[]; error?: string }> {
  const sb = await createClient()

  // The IST day as a UTC window: created_at is timestamptz, and India is
  // +05:30, so "today" starts at 18:30 UTC the previous evening.
  const from = new Date(`${day}T00:00:00+05:30`).toISOString()
  const to = new Date(`${day}T23:59:59.999+05:30`).toISOString()

  const { data, error } = await sb
    .from('wh_movements')
    .select(`id, kind, qty, created_at, remarks, ref_table, ref_id,
             wh_items(id, name, code, unit, category),
             wh_locations(id, name, parent_id),
             actor:profiles!wh_movements_actor_id_fkey(full_name, email)`)
    .gte('created_at', from)
    .lte('created_at', to)
    .order('created_at', { ascending: false })
  if (error) return { rows: [], error: error.message }
  if (!data?.length) return { rows: [] }

  // Site names for the store → site line, and the entry context under each
  // item, both fetched in one go rather than per row.
  const [sites, ctx] = await Promise.all([siteNames(), entryContext(data)])

  const rows: DayMovement[] = []
  for (const m of data) {
    const item = one(m.wh_items)
    const loc = one(m.wh_locations)
    const c = m.ref_id ? ctx.get(m.ref_id) : undefined
    rows.push({
      id: m.id,
      kind: m.kind as MovementKind,
      qty: Number(m.qty),
      itemId: item?.id ?? '',
      itemName: item?.name ?? '—',
      itemCode: item?.code ?? null,
      unit: item?.unit ?? '',
      category: item?.category ?? null,
      storeId: loc?.id ?? '',
      storeName: loc?.name ?? '—',
      siteName: (loc?.parent_id ? sites.get(loc.parent_id) : null) ?? '',
      actor: personName(m.actor),
      time: new Date(m.created_at).toLocaleTimeString('en-GB', {
        hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata',
      }),
      remarks: m.remarks,
      entryNo: c?.entryNo ?? null,
      counterparty: c?.counterparty ?? null,
      projectName: c?.projectName ?? null,
    })
  }
  return { rows }
}

async function siteNames(): Promise<Map<string, string>> {
  const sb = await createClient()
  const { data } = await sb.from('wh_locations').select('id, name').is('parent_id', null)
  return new Map((data ?? []).map(r => [r.id, r.name]))
}

type Ctx = { entryNo: string; counterparty: string | null; projectName: string | null }

/** The entry each movement came from, so a row can say WHERE it went rather
 *  than only that it left. One query per table, not one per row. */
async function entryContext(
  movements: Array<{ ref_table: string | null; ref_id: string | null }>,
): Promise<Map<string, Ctx>> {
  const sb = await createClient()
  const map = new Map<string, Ctx>()

  const inIds = [...new Set(movements.filter(m => m.ref_table === 'wh_gate_in' && m.ref_id).map(m => m.ref_id!))]
  const outIds = [...new Set(movements.filter(m => m.ref_table === 'wh_gate_out' && m.ref_id).map(m => m.ref_id!))]

  const [insRes, outsRes] = await Promise.all([
    inIds.length
      ? sb.from('wh_gate_in').select('id, entry_no, party, projects(name)').in('id', inIds)
      : Promise.resolve({ data: [] as never[] }),
    outIds.length
      ? sb.from('wh_gate_out')
          .select(`id, entry_no, dest_type, party, projects(name),
                   to:wh_locations!wh_gate_out_to_location_id_fkey(name)`)
          .in('id', outIds)
      : Promise.resolve({ data: [] as never[] }),
  ])

  for (const e of insRes.data ?? []) {
    map.set(e.id, {
      entryNo: e.entry_no,
      counterparty: e.party || null,
      projectName: one(e.projects)?.name ?? null,
    })
  }
  for (const e of outsRes.data ?? []) {
    map.set(e.id, {
      entryNo: e.entry_no,
      counterparty: e.dest_type === 'site' ? (one(e.projects)?.name ?? 'a site')
        : e.dest_type === 'store' ? (one(e.to)?.name ?? 'another store')
        : (e.party || 'a vendor'),
      projectName: one(e.projects)?.name ?? null,
    })
  }
  return map
}

function personName(p: unknown): string | null {
  const o = one(p as never) as { full_name?: string | null; email?: string | null } | null
  if (!o) return null
  // The email's local part is enough — "projectexecution" reads better in a
  // narrow column than the full address, and the full name wins when set.
  return o.full_name || (o.email ? o.email.split('@')[0] : null)
}
