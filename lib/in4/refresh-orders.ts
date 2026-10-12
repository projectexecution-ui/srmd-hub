// Re-read a few work orders from IN4 NOW, instead of waiting for the twice-a-day
// sync (Aksha, 12 Oct 2026: "the Desk owners once they are in the Bills they
// should get refresh or fetch latest data from In4 in one click").
//
// The same reads the scheduled feeds do, limited to the given orders: BOQ lines,
// abstracts (with IN4's own approval status), certificates and advances, each
// certificate's approval trail, and debit notes with what recovered them. They
// land in the same mirror tables, with the same columns, so every screen and
// every bill rule reads the fresh figures. Read-only towards IN4.

import type { SupabaseClient } from '@supabase/supabase-js'
import { extractWoBoqItems, extractWoAbstractItems } from './extract'
import { extractContractorCerts, extractCertEvents, extractWoDebitNotes, extractWoDebitNoteRecoveries } from './extract-feeds'

export interface RefreshResult {
  orders: number
  boqLines: number
  abstractLines: number
  certificates: number
  trailEvents: number
  debitNotes: number
  ms: number
}

async function upsert(sb: SupabaseClient, table: string, rows: Record<string, unknown>[], onConflict: string) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from(table).upsert(rows.slice(i, i + 500), { onConflict })
    if (error) throw new Error(`${table}: ${error.message}`)
  }
}

/** Drop rows of THESE orders that IN4 no longer has — nothing else is touched. */
async function dropStaleFor(sb: SupabaseClient, table: string, col: string, ids: number[], now: string) {
  if (!ids.length) return
  const { error } = await sb.from(table).delete().in(col, ids).lt('synced_at', now)
  if (error) throw new Error(`${table} cleanup: ${error.message}`)
}

export async function refreshWorkOrdersFromIn4(sb: SupabaseClient, woIds: number[]): Promise<RefreshResult> {
  const t0 = Date.now()
  const ids = [...new Set(woIds.filter(i => Number.isInteger(i) && i > 0))]
  const empty = { orders: 0, boqLines: 0, abstractLines: 0, certificates: 0, trailEvents: 0, debitNotes: 0, ms: 0 }
  if (!ids.length) return empty
  const now = new Date().toISOString()

  const [boq, abstracts, certs, notes, partiesRes] = await Promise.all([
    extractWoBoqItems(ids),
    extractWoAbstractItems(ids),
    extractContractorCerts(ids),
    extractWoDebitNotes(ids),
    sb.from('in4_parties').select('id, name').eq('kind', 'contractor'),
  ])
  const certIds = certs.filter(c => c.kind === 'wo').map(c => c.certificate_id)
  const noteIds = notes.map(d => d.id)
  const [events, recoveries] = await Promise.all([
    certIds.length ? extractCertEvents(certIds) : Promise.resolve([]),
    noteIds.length ? extractWoDebitNoteRecoveries(noteIds) : Promise.resolve([]),
  ])
  const contractor = new Map(((partiesRes.data ?? []) as Array<{ id: number; name: string }>).map(p => [p.id, p.name]))

  await upsert(sb, 'in4_wo_boq_items', boq.map(i => ({
    item_id: i.item_id, wo_id: i.wo_id, boq_id: i.boq_id, category_id: i.category_id, subcategory_id: i.subcategory_id,
    quantity: i.quantity, rate: i.rate, amt: i.amt,
    boq_name: i.boq_name, boq_subname: i.boq_subname, description: i.description, uom: i.uom, uom_id: i.uom_id, synced_at: now,
  })), 'item_id')
  await dropStaleFor(sb, 'in4_wo_boq_items', 'wo_id', ids, now)

  await upsert(sb, 'in4_wo_abstract_items', abstracts.map(a => ({
    abstract_id: a.abstract_id, item_id: a.item_id, wo_id: a.wo_id,
    executed_quantity: a.executed_quantity, recommended_rate: a.recommended_rate, executed_amt: a.executed_amt,
    bill_no: a.bill_no, display_no: a.display_no, abstract_dt: a.abstract_dt, status: a.status, synced_at: now,
  })), 'abstract_id,item_id')
  await dropStaleFor(sb, 'in4_wo_abstract_items', 'wo_id', ids, now)

  await upsert(sb, 'in4_wo_certificates', certs.map(c => ({
    kind: c.kind, certificate_id: c.certificate_id, certificate_type_id: c.certificate_type_id, certificate_type: c.certificate_type,
    display_no: c.display_no,
    wo_id: c.wo_id ?? 0, wo_no: c.wo_no, wo_value: c.wo_value, project_id: c.project_id, subproject_id: c.subproject_id,
    category_id: c.skill_id ?? 0, subcategory_id: c.subskill_id ?? 0, contractor_id: c.contractor_id,
    contractor_name: c.contractor_id != null ? contractor.get(c.contractor_id) ?? `Contractor ${c.contractor_id}` : null,
    status: c.status, status_name: c.status_name, invoice_no: c.invoice_no, invoice_date: c.invoice_date, creation_dt: c.creation_dt,
    gross_bill_amt: c.gross, certified_amt: c.certified, paid_amt: c.paid, recoveries: c.recoveries, deductions: c.deductions,
    retention_amt: c.retention, outstanding_amt: c.outstanding, synced_at: now,
  })), 'kind,certificate_id')
  // Certificates of these orders that IN4 no longer lists.
  {
    const { error } = await sb.from('in4_wo_certificates').delete()
      .in('wo_id', ids).in('kind', ['wo', 'advance']).lt('synced_at', now)
    if (error) throw new Error(`in4_wo_certificates cleanup: ${error.message}`)
  }

  // The trail is append-only — rows only ever arrive (see runTrail).
  await upsert(sb, 'in4_cert_events', events.map(e => ({ ...e, synced_at: now })), 'event_id')

  await upsert(sb, 'in4_wo_debit_notes', notes.map(d => ({ ...d, synced_at: now })), 'id')
  await dropStaleFor(sb, 'in4_wo_debit_notes', 'wo_id', ids, now)
  await upsert(sb, 'in4_wo_debit_note_recoveries', recoveries.map(r => ({ ...r, synced_at: now })), 'id')
  if (noteIds.length) await dropStaleFor(sb, 'in4_wo_debit_note_recoveries', 'debit_note_id', noteIds, now)

  return {
    orders: ids.length, boqLines: boq.length, abstractLines: abstracts.length,
    certificates: certs.length, trailEvents: events.length, debitNotes: notes.length, ms: Date.now() - t0,
  }
}
