import { createClient } from '@/lib/supabase/server'
import { one } from './data'
import { getStockView } from './report-data'
import { todayIST, groupOf } from './ledger'
import { formatDate, formatNumber } from '@/lib/utils'
import { formatQty, formatINR } from './format'
import {
  cell, ageBucket, daysBetween, seriesGaps, entrySeq, rateSpread, crossEntity,
  outstandingReturnables, poPending, reportMeta, RATE_SPREAD_FLOOR, AGE_BUCKETS,
} from './exceptions'
import type {
  Cell, ReportKey, ReportView, RateObservation, ReturnableLine, PoLineState, EntitySpend,
} from './exceptions'

/** What family this material belongs to. Category where the item carries one,
 *  the IN4 trade otherwise — the same fallback the stock screen and the
 *  registers use, so an item never reads as two different things. */
function catOf(i: { category?: string | null; discipline?: string | null } | null | undefined): string {
  return i?.category?.trim() || i?.discipline?.trim() || 'Not categorised'
}

/** One entry point. Every control report is loaded the same way and returns the
 *  same shape, so the screen and the export never need to know which one it is. */
export async function getControlReport(
  key: ReportKey,
  opts: { from: string | null; to: string | null; showValues: boolean },
): Promise<ReportView> {
  const meta = reportMeta(key)
  if (!meta) return blank(key, 'Unknown report', 'This report does not exist.')
  const ctx = { ...opts, today: todayIST(), meta }

  switch (key) {
    case 'count-variance':    return countVariance(ctx)
    case 'vendor-balance':    return vendorBalanceReport(ctx)
    case 'shortage-damage':   return shortageDamage(ctx)
    case 'no-po':             return noPo(ctx)
    case 'differs-from-in4':  return differsFromIn4(ctx)
    case 'dead-stock':        return deadStock(ctx)
    case 'returnables':       return returnables(ctx)
    case 'po-pending':        return poPendingReport(ctx)
    case 'over-receipt':      return overReceipt(ctx)
    case 'rate-variance':     return rateVarianceReport(ctx)
    case 'entity-settlement': return entitySettlement(ctx)
    case 'number-gaps':       return numberGaps(ctx)
    case 'voided':            return voidedEntries(ctx)
  }
}

type Ctx = {
  from: string | null
  to: string | null
  today: string
  showValues: boolean
  meta: NonNullable<ReturnType<typeof reportMeta>>
}

function shell(ctx: Ctx, over: Partial<ReportView>): ReportView {
  return {
    key: ctx.meta.key,
    title: ctx.meta.title,
    blurb: ctx.meta.blurb,
    question: ctx.meta.question,
    columns: [], groups: [], kpis: [], caveats: [], emptyGood: 'Nothing to report.',
    ...over,
  }
}

function blank(key: string, title: string, why: string): ReportView {
  return {
    key, title, blurb: '', question: '', columns: [], groups: [], kpis: [],
    caveats: [], emptyGood: why,
  }
}

/** Period filter shared by every date-based report. */
function period<T extends { day: string }>(rows: T[], ctx: Ctx): T[] {
  return rows.filter(r =>
    (!ctx.from || r.day >= ctx.from) && (!ctx.to || r.day <= ctx.to))
}

const MONEY = (n: number | null | undefined): Cell =>
  n == null ? cell('—') : cell(formatINR(n), n)

// ===========================================================================
// 1 · Physical count & variance (#2)
// ===========================================================================
async function countVariance(ctx: Ctx): Promise<ReportView> {
  const sb = await createClient()
  const { data, error } = await sb
    .from('wh_counts')
    .select(`id, count_no, scope, status, started_at, approved_at, reject_reason,
             counter:profiles!wh_counts_counted_by_fkey(full_name, email),
             witness:profiles!wh_counts_witness_id_fkey(full_name, email),
             approver:profiles!wh_counts_approved_by_fkey(full_name, email),
             wh_locations(name),
             wh_count_lines(id, book_qty, counted_qty, skipped, reason, diff,
                            wh_items(name, unit, category, discipline, last_rate))`)
    .order('started_at', { ascending: false })
  if (error) return shell(ctx, { error: error.message })

  const counts = (data ?? []).filter(c => {
    const day = (c.approved_at ?? c.started_at ?? '').slice(0, 10)
    return (!ctx.from || day >= ctx.from) && (!ctx.to || day <= ctx.to)
  })

  const groups = []
  let shortValue = 0, shortQty = 0, excessQty = 0, unwitnessed = 0
  for (const c of counts) {
    const lines = (c.wh_count_lines ?? []).filter(l =>
      !l.skipped && l.counted_qty != null && Number(l.diff) !== 0)
    if (!one(c.witness)) unwitnessed++
    const rows: Cell[][] = lines.map(l => {
      const item = one(l.wh_items)
      const diff = Number(l.diff)
      const rate = item?.last_rate == null ? null : Number(item.last_rate)
      const value = rate == null ? null : Math.abs(diff) * rate
      if (diff < 0) { shortQty += -diff; if (value) shortValue += value }
      else excessQty += diff
      return [
        cell(item?.name ?? '—'),
        cell(catOf(item)),
        cell(formatQty(l.book_qty), Number(l.book_qty)),
        cell(formatQty(l.counted_qty), Number(l.counted_qty)),
        cell(`${diff < 0 ? '−' : '+'}${formatQty(Math.abs(diff))} ${item?.unit ?? ''}`, diff,
          diff < 0 ? 'bad' : 'warn'),
        cell(l.reason ?? '—'),
        ...(ctx.showValues ? [MONEY(value)] : []),
      ]
    })
    if (rows.length === 0) continue
    const counter = one(c.counter), witness = one(c.witness), approver = one(c.approver)
    groups.push({
      label: `${c.count_no} · ${one(c.wh_locations)?.name ?? '—'} · ${c.status}`
        + ` · counted by ${counter?.full_name || counter?.email || '—'}`
        + ` · witness ${witness?.full_name || witness?.email || 'NONE'}`
        + (approver ? ` · approved by ${approver.full_name || approver.email}` : ' · not approved'),
      rows,
    })
  }

  return shell(ctx, {
    columns: [
      { header: 'Item', width: 32 }, { header: 'Category', width: 18 },
      { header: 'Book', align: 'right' },
      { header: 'Counted', align: 'right' }, { header: 'Difference', align: 'right' },
      { header: 'Reason', width: 22 },
      ...(ctx.showValues ? [{ header: 'Value', align: 'right' as const }] : []),
    ],
    groups,
    kpis: [
      { label: 'counts with a difference', value: String(groups.length) },
      { label: 'short', value: formatQty(shortQty), tone: shortQty ? 'bad' : undefined },
      { label: 'extra found', value: formatQty(excessQty) },
      ...(ctx.showValues
        ? [{ label: 'shortage value', value: formatINR(shortValue), tone: (shortValue ? 'bad' : undefined) as 'bad' | undefined }]
        : []),
      ...(unwitnessed > 0
        ? [{ label: 'counts with NO witness', value: String(unwitnessed), tone: 'bad' as const,
             hint: 'a keeper counting alone is checking himself' }]
        : []),
    ],
    caveats: [
      'Only lines that did not tally are listed. A count where everything tallied is not a finding.',
      'Value uses the last rate seen for the item — indicative, not a valuation.',
    ],
    emptyGood: 'No count in this period found a difference. Either the register is accurate or nothing has been counted yet.',
  })
}

// ===========================================================================
// 2 · Vendor material balance (#3)
// ===========================================================================
async function vendorBalanceReport(ctx: Ctx): Promise<ReportView> {
  const sb = await createClient()
  const [insRes, outsRes] = await Promise.all([
    sb.from('wh_gate_in')
      .select('party, entry_date, wh_gate_in_lines(received_qty, wh_items(id, name, unit))')
      .eq('owner', 'vendor').is('deleted_at', null),
    sb.from('wh_gate_out')
      .select('party, entry_date, wh_gate_out_lines(qty, wh_items(id, name, unit))')
      .eq('dest_type', 'vendor').is('deleted_at', null),
  ])
  if (insRes.error || outsRes.error) {
    return shell(ctx, { error: insRes.error?.message ?? outsRes.error?.message })
  }

  type Row = { party: string; itemId: string; itemName: string; unit: string; broughtIn: number; takenBack: number }
  const rows = new Map<string, Row>()
  const touch = (party: string | null, itemId: string, itemName: string, unit: string) => {
    const p = (party ?? '').trim() || '— not named —'
    const k = `${p.toLowerCase()}|${itemId}`
    if (!rows.has(k)) rows.set(k, { party: p, itemId, itemName, unit, broughtIn: 0, takenBack: 0 })
    return rows.get(k)!
  }
  for (const e of insRes.data ?? []) {
    for (const l of e.wh_gate_in_lines ?? []) {
      const it = one(l.wh_items); if (!it) continue
      touch(e.party, it.id, it.name, it.unit).broughtIn += Number(l.received_qty)
    }
  }
  for (const e of outsRes.data ?? []) {
    for (const l of e.wh_gate_out_lines ?? []) {
      const it = one(l.wh_items); if (!it) continue
      touch(e.party, it.id, it.name, it.unit).takenBack += Number(l.qty)
    }
  }

  const byParty = new Map<string, Row[]>()
  for (const r of rows.values()) {
    if (!byParty.has(r.party)) byParty.set(r.party, [])
    byParty.get(r.party)!.push(r)
  }
  let overTaken = 0, stillHere = 0
  const groups = [...byParty.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([party, rs]) => ({
      label: party,
      rows: rs.sort((a, b) => a.itemName.localeCompare(b.itemName)).map(r => {
        const left = r.broughtIn - r.takenBack
        if (left < 0) overTaken++
        if (left > 0) stillHere++
        return [
          cell(r.itemName),
          cell(`${formatQty(r.broughtIn)} ${r.unit}`, r.broughtIn),
          cell(`${formatQty(r.takenBack)} ${r.unit}`, r.takenBack),
          cell(`${formatQty(left)} ${r.unit}`, left, left < 0 ? 'bad' : left > 0 ? 'warn' : 'good'),
          cell(left < 0 ? 'HE HAS TAKEN MORE THAN HE BROUGHT' : left > 0 ? 'still at site' : 'all squared',
            null, left < 0 ? 'bad' : left > 0 ? 'warn' : 'good'),
        ]
      }),
    }))

  return shell(ctx, {
    columns: [
      { header: 'Item', width: 32 }, { header: 'Brought in', align: 'right' },
      { header: 'Taken back', align: 'right' }, { header: 'Still here', align: 'right' },
      { header: 'Status', width: 26 },
    ],
    groups,
    kpis: [
      { label: 'vendors with material here', value: String(byParty.size) },
      { label: 'lines still at site', value: String(stillHere), tone: stillHere ? 'warn' : undefined },
      { label: 'taken back MORE than brought', value: String(overTaken), tone: overTaken ? 'bad' : undefined,
        hint: overTaken ? 'a data error or a claim to check' : undefined },
    ],
    caveats: [
      'Matched on the party name recorded at the gate, across every entry — his plates are his plates whichever truck they came on.',
      'This is a position as at today, not a period.',
    ],
    emptyGood: 'No vendor has brought their own material in, so there is nothing outstanding.',
  })
}

// ===========================================================================
// 3 · Shortage & damage (#9 #10)
// ===========================================================================
async function shortageDamage(ctx: Ctx): Promise<ReportView> {
  const sb = await createClient()
  const { data, error } = await sb
    .from('wh_gate_in')
    .select(`id, entry_no, entry_date, party, owner,
             wh_gate_in_lines(id, challan_qty, received_qty, damaged_qty, short_qty, rate,
                              wh_items(name, unit, category, discipline))`)
    .is('deleted_at', null)
    .order('entry_date', { ascending: false })
  if (error) return shell(ctx, { error: error.message })

  type Finding = { party: string; entryNo: string; day: string; itemName: string; unit: string
                   category: string; short: number; damaged: number; value: number | null }
  const findings: Finding[] = []
  for (const e of period((data ?? []).map(e => ({ ...e, day: e.entry_date })), ctx)) {
    for (const l of e.wh_gate_in_lines ?? []) {
      const short = Math.max(0, Number(l.short_qty))
      const damaged = Number(l.damaged_qty)
      if (short === 0 && damaged === 0) continue
      const it = one(l.wh_items)
      const rate = l.rate == null ? null : Number(l.rate)
      findings.push({
        party: e.party || '— not named —', entryNo: e.entry_no, day: e.entry_date,
        itemName: it?.name ?? '—', unit: it?.unit ?? '', category: catOf(it),
        short, damaged, value: rate == null ? null : (short + damaged) * rate,
      })
    }
  }

  const byParty = new Map<string, Finding[]>()
  for (const f of findings) {
    if (!byParty.has(f.party)) byParty.set(f.party, [])
    byParty.get(f.party)!.push(f)
  }
  const totalShort = findings.reduce((s, f) => s + f.short, 0)
  const totalDamaged = findings.reduce((s, f) => s + f.damaged, 0)
  const totalValue = findings.reduce((s, f) => s + (f.value ?? 0), 0)

  const groups = [...byParty.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([party, fs]) => ({
      label: `${party} — ${fs.length} ${fs.length === 1 ? 'line' : 'lines'}`,
      rows: fs.map(f => [
        cell(formatDate(f.day)), cell(f.entryNo), cell(f.itemName), cell(f.category),
        cell(f.short ? `${formatQty(f.short)} ${f.unit}` : '—', f.short, f.short ? 'bad' : undefined),
        cell(f.damaged ? `${formatQty(f.damaged)} ${f.unit}` : '—', f.damaged, f.damaged ? 'warn' : undefined),
        ...(ctx.showValues ? [MONEY(f.value)] : []),
      ]),
      footer: [
        cell(`${fs.length} lines`), cell(''), cell(''), cell(''),
        cell(formatQty(fs.reduce((s, f) => s + f.short, 0)), null, 'bad'),
        cell(formatQty(fs.reduce((s, f) => s + f.damaged, 0)), null, 'warn'),
        ...(ctx.showValues ? [MONEY(fs.reduce((s, f) => s + (f.value ?? 0), 0))] : []),
      ],
    }))

  return shell(ctx, {
    columns: [
      { header: 'Date' }, { header: 'Entry', width: 18 }, { header: 'Item', width: 30 },
      { header: 'Category', width: 18 }, { header: 'Short', align: 'right' }, { header: 'Damaged', align: 'right' },
      ...(ctx.showValues ? [{ header: 'Value at risk', align: 'right' as const, width: 16 }] : []),
    ],
    groups,
    kpis: [
      { label: 'suppliers involved', value: String(byParty.size), tone: byParty.size ? 'warn' : undefined },
      { label: 'short against challans', value: formatQty(totalShort), tone: totalShort ? 'bad' : undefined },
      { label: 'arrived damaged', value: formatQty(totalDamaged), tone: totalDamaged ? 'warn' : undefined },
      ...(ctx.showValues
        ? [{ label: 'value at risk', value: formatINR(totalValue), tone: (totalValue ? 'bad' : undefined) as 'bad' | undefined }]
        : []),
    ],
    caveats: [
      'Short = what the challan said against what was actually taken in. It is a claim on the supplier, not a PO balance.',
      'Damaged material was booked as damaged and never entered good stock.',
      'Ranked by how many lines each supplier accounts for — the repeat offender comes first.',
    ],
    emptyGood: 'Every load in this period arrived complete and undamaged.',
  })
}

// ===========================================================================
// 4 · No-PO entries (#15)
// ===========================================================================
async function noPo(ctx: Ctx): Promise<ReportView> {
  const sb = await createClient()
  const { data, error } = await sb
    .from('wh_gate_in')
    .select(`id, entry_no, entry_date, party, no_po_reason, po_no_text, owner,
             wh_locations(name), projects(name),
             wh_gate_in_lines(good_qty, rate, wh_items(name, unit))`)
    .is('po_id', null).is('deleted_at', null)
    .order('entry_date', { ascending: false })
  if (error) return shell(ctx, { error: error.message })

  const entries = period((data ?? []).map(e => ({ ...e, day: e.entry_date })), ctx)
  // Grouped by month, because "how many emergencies a month" is the question —
  // one is an emergency, fifteen is a habit.
  const byMonth = new Map<string, typeof entries>()
  for (const e of entries) {
    const m = e.entry_date.slice(0, 7)
    if (!byMonth.has(m)) byMonth.set(m, [])
    byMonth.get(m)!.push(e)
  }

  let value = 0
  const groups = [...byMonth.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([month, es]) => ({
    label: `${monthLabel(month)} — ${es.length} ${es.length === 1 ? 'entry' : 'entries'}`,
    rows: es.map(e => {
      const lines = e.wh_gate_in_lines ?? []
      const v = lines.reduce((s, l) => s + (l.rate == null ? 0 : Number(l.good_qty) * Number(l.rate)), 0)
      value += v
      return [
        cell(formatDate(e.entry_date)), cell(e.entry_no),
        cell(one(e.wh_locations)?.name ?? '—'),
        cell(e.party || '—'),
        cell(lines.map(l => `${one(l.wh_items)?.name ?? '—'} ${formatQty(l.good_qty)}`).join(', ') || '—'),
        cell(e.no_po_reason || e.po_no_text || '— no reason given —', null,
          e.no_po_reason ? undefined : 'bad'),
        ...(ctx.showValues ? [MONEY(v || null)] : []),
      ]
    }),
  }))

  const noReason = entries.filter(e => !e.no_po_reason && !e.po_no_text).length

  return shell(ctx, {
    columns: [
      { header: 'Date' }, { header: 'Entry', width: 18 }, { header: 'Store', width: 20 },
      { header: 'Supplier', width: 20 }, { header: 'What came', width: 34 },
      { header: 'Reason given', width: 26 },
      ...(ctx.showValues ? [{ header: 'Value', align: 'right' as const }] : []),
    ],
    groups,
    kpis: [
      { label: 'entries with no PO', value: String(entries.length), tone: entries.length ? 'warn' : undefined },
      { label: 'months affected', value: String(byMonth.size) },
      { label: 'with NO reason given', value: String(noReason), tone: noReason ? 'bad' : undefined },
      ...(ctx.showValues ? [{ label: 'value taken in', value: formatINR(value) }] : []),
    ],
    caveats: [
      'A no-PO entry is allowed — a truck is never turned away at the barrier — but it must say why, and it lands here.',
      'Grouped by month on purpose: one is an emergency, fifteen is a habit.',
    ],
    emptyGood: 'Everything taken in during this period came against a purchase order.',
  })
}

// ===========================================================================
// 5 · Differs from IN4 (added when IN4 became the item base)
// ===========================================================================
async function differsFromIn4(ctx: Ctx): Promise<ReportView> {
  const sb = await createClient()
  const { data, error } = await sb
    .from('wh_gate_in_lines')
    .select(`id, received_qty, differ_note, rate,
             wh_items(name, unit),
             po_line:wh_po_lines(source_text, ordered_qty, wh_items(name)),
             entry:wh_gate_in(entry_no, entry_date, party, deleted_at, wh_po(po_no))`)
    .eq('differs_from_po', true)
  if (error) return shell(ctx, { error: error.message })

  type Row = { day: string; entryNo: string; poNo: string; party: string
               ordered: string; got: string; qty: number; note: string; value: number | null }
  const rows: Row[] = []
  for (const l of data ?? []) {
    const e = one(l.entry)
    if (!e || e.deleted_at) continue
    const rate = l.rate == null ? null : Number(l.rate)
    rows.push({
      day: e.entry_date, entryNo: e.entry_no,
      poNo: one(e.wh_po)?.po_no ?? '—', party: e.party || '—',
      ordered: one(l.po_line)?.source_text ?? one(one(l.po_line)?.wh_items)?.name ?? '—',
      got: one(l.wh_items)?.name ?? '—',
      qty: Number(l.received_qty),
      note: l.differ_note ?? '',
      value: rate == null ? null : Number(l.received_qty) * rate,
    })
  }
  const inPeriodRows = period(rows, ctx)

  const byPo = new Map<string, Row[]>()
  for (const r of inPeriodRows) {
    if (!byPo.has(r.poNo)) byPo.set(r.poNo, [])
    byPo.get(r.poNo)!.push(r)
  }

  return shell(ctx, {
    columns: [
      { header: 'Date' }, { header: 'Entry', width: 18 },
      { header: 'IN4 ordered', width: 34 }, { header: 'What actually came', width: 34 },
      { header: 'Qty', align: 'right' }, { header: 'What is different', width: 30 },
      ...(ctx.showValues ? [{ header: 'Value', align: 'right' as const }] : []),
    ],
    groups: [...byPo.entries()].sort((a, b) => b[1].length - a[1].length).map(([poNo, rs]) => ({
      label: `${poNo} · ${rs[0].party} — ${rs.length} ${rs.length === 1 ? 'line' : 'lines'}`,
      rows: rs.map(r => [
        cell(formatDate(r.day)), cell(r.entryNo),
        cell(r.ordered, null, 'muted'), cell(r.got, null, 'warn'),
        cell(formatQty(r.qty), r.qty),
        cell(r.note),
        ...(ctx.showValues ? [MONEY(r.value)] : []),
      ]),
    })),
    kpis: [
      { label: 'lines not as IN4 ordered', value: String(inPeriodRows.length),
        tone: inPeriodRows.length ? 'warn' : undefined },
      { label: 'POs affected', value: String(byPo.size) },
      ...(ctx.showValues
        ? [{ label: 'value involved', value: formatINR(inPeriodRows.reduce((s, r) => s + (r.value ?? 0), 0)) }]
        : []),
    ],
    caveats: [
      'We follow IN4 for what was ordered. When the truck brings something else, the gate records what actually came and flags it — this is that list.',
      'The PO line still received its quantity: the delivery did happen against that order. What needs settling is the description in IN4 and on the bill.',
    ],
    emptyGood: 'Everything received matched the material IN4 ordered.',
  })
}

// ===========================================================================
// 6 · Dead stock ageing (#16)
// ===========================================================================
async function deadStock(ctx: Ctx): Promise<ReportView> {
  const sb = await createClient()
  const [view, movRes] = await Promise.all([
    getStockView({}),
    sb.from('wh_movements').select('item_id, location_id, created_at'),
  ])
  if (view.error) return shell(ctx, { error: view.error })
  if (movRes.error) return shell(ctx, { error: movRes.error.message })

  // Last time anything happened to this item in this store.
  const last = new Map<string, string>()
  for (const m of movRes.data ?? []) {
    const k = `${m.item_id}|${m.location_id}`
    const day = new Date(m.created_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
    const cur = last.get(k)
    if (!cur || day > cur) last.set(k, day)
  }

  const findings = view.lines
    .filter(l => l.inHand > 0)
    .map(l => {
      const lastDay = last.get(`${l.itemId}|${l.locationId}`) ?? null
      const idle = lastDay ? daysBetween(lastDay, ctx.today) : 0
      return { l, lastDay, idle, bucket: ageBucket(idle) }
    })
    .filter(f => f.bucket !== null)
    .sort((a, b) => b.idle - a.idle)

  const groups = AGE_BUCKETS.map(b => {
    const fs = findings.filter(f => f.bucket === b)
    return {
      label: `Not moved in ${b}+ days — ${fs.length} ${fs.length === 1 ? 'line' : 'lines'}`,
      rows: fs.map(f => [
        cell(f.l.itemName), cell(groupOf(f.l)), cell(`${f.l.siteName} — ${f.l.locationName}`),
        cell(`${formatQty(f.l.inHand)} ${f.l.unit}`, f.l.inHand),
        cell(f.lastDay ? formatDate(f.lastDay) : 'never', null, f.lastDay ? undefined : 'bad'),
        cell(`${formatNumber(f.idle, 0)} days`, f.idle, b === 180 ? 'bad' : 'warn'),
        ...(ctx.showValues ? [MONEY(f.l.rate == null ? null : f.l.value)] : []),
      ]),
      footer: [
        cell(`${fs.length} lines`), cell(''), cell(''), cell(''), cell(''), cell(''),
        ...(ctx.showValues ? [MONEY(fs.reduce((s, f) => s + f.l.value, 0))] : []),
      ],
    }
  }).filter(g => g.rows.length > 0)

  const idleValue = findings.reduce((s, f) => s + f.l.value, 0)

  return shell(ctx, {
    columns: [
      { header: 'Item', width: 32 }, { header: 'Category', width: 18 },
      { header: 'Where', width: 26 },
      { header: 'In hand', align: 'right' }, { header: 'Last moved' },
      { header: 'Idle', align: 'right' },
      ...(ctx.showValues ? [{ header: 'Value', align: 'right' as const }] : []),
    ],
    groups,
    kpis: [
      { label: 'idle lines', value: String(findings.length), tone: findings.length ? 'warn' : undefined },
      { label: 'idle 180+ days', value: String(findings.filter(f => f.bucket === 180).length),
        tone: findings.some(f => f.bucket === 180) ? 'bad' : undefined },
      ...(ctx.showValues
        ? [{ label: 'money sitting idle', value: formatINR(idleValue), tone: (idleValue ? 'warn' : undefined) as 'warn' | undefined }]
        : []),
    ],
    caveats: [
      'Idle means no movement of that item in that store — not that the item is unused elsewhere.',
      'A position as at today, so the period filter does not apply.',
    ],
    emptyGood: 'Nothing has been sitting untouched for 60 days or more.',
  })
}

// ===========================================================================
// 7 · Returnables outstanding (#7)
// ===========================================================================
async function returnables(ctx: Ctx): Promise<ReportView> {
  const sb = await createClient()
  const { data, error } = await sb
    .from('wh_gate_out')
    .select(`entry_no, entry_date, return_due_date, projects(name),
             engineer:profiles!wh_gate_out_engineer_id_fkey(full_name, email),
             wh_gate_out_lines(qty, returned_qty, wh_items(name, unit))`)
    .eq('is_returnable', true).is('deleted_at', null)
  if (error) return shell(ctx, { error: error.message })

  const lines: ReturnableLine[] = []
  for (const e of data ?? []) {
    const eng = one(e.engineer)
    for (const l of e.wh_gate_out_lines ?? []) {
      const it = one(l.wh_items)
      lines.push({
        entryNo: e.entry_no, day: e.entry_date,
        projectName: one(e.projects)?.name ?? null,
        engineerName: eng?.full_name || eng?.email || null,
        itemName: it?.name ?? '—', unit: it?.unit ?? '',
        qty: Number(l.qty), returnedQty: Number(l.returned_qty),
        dueDate: e.return_due_date,
      })
    }
  }
  const findings = outstandingReturnables(lines, ctx.today)
  const overdue = findings.filter(f => f.overdueDays !== null)

  return shell(ctx, {
    columns: [
      { header: 'Entry', width: 18 }, { header: 'Item', width: 30 },
      { header: 'Still out', align: 'right' }, { header: 'Went out' },
      { header: 'Days out', align: 'right' }, { header: 'Due back' },
      { header: 'Overdue by', align: 'right' }, { header: 'Project / engineer', width: 26 },
    ],
    groups: [{
      label: overdue.length > 0
        ? `${overdue.length} overdue, ${findings.length - overdue.length} still within time`
        : `${findings.length} out, none overdue yet`,
      rows: findings.map(f => [
        cell(f.entryNo), cell(f.itemName),
        cell(`${formatQty(f.outstanding)} ${f.unit}`, f.outstanding, f.overdueDays ? 'bad' : 'warn'),
        cell(formatDate(f.day)),
        cell(`${formatNumber(f.daysOut, 0)}`, f.daysOut),
        cell(f.dueDate ? formatDate(f.dueDate) : '— none set —', null, f.dueDate ? undefined : 'muted'),
        cell(f.overdueDays ? `${formatNumber(f.overdueDays, 0)} days` : '—', f.overdueDays,
          f.overdueDays ? 'bad' : undefined),
        cell([f.projectName, f.engineerName].filter(Boolean).join(' · ') || '—'),
      ]),
    }].filter(g => g.rows.length > 0),
    kpis: [
      { label: 'lines still out', value: String(findings.length), tone: findings.length ? 'warn' : undefined },
      { label: 'overdue', value: String(overdue.length), tone: overdue.length ? 'bad' : undefined },
      { label: 'longest out', value: findings.length ? `${formatNumber(findings[0].daysOut, 0)} days` : '—' },
      { label: 'with no due date', value: String(findings.filter(f => !f.dueDate).length),
        hint: 'nothing to chase them against' },
    ],
    caveats: [
      'Only what is still out. A returnable that came back is closed, however late it was.',
      'A position as at today, so the period filter does not apply.',
    ],
    emptyGood: 'Nothing is out on a promise to come back.',
  })
}

// ===========================================================================
// 8 · PO-wise pending (#21) and 9 · Over-receipt (#21)
// ===========================================================================
async function loadPoLines(): Promise<{ lines: PoLineState[]; error?: string }> {
  const sb = await createClient()
  const [poRes, ginRes] = await Promise.all([
    sb.from('wh_po')
      .select('id, po_no, vendor, entity, status, wh_po_lines(id, ordered_qty, rate, source_text, wh_items(name, unit))')
      .is('deleted_at', null),
    sb.from('wh_gate_in_lines')
      .select('po_line_id, received_qty, entry:wh_gate_in(entry_date, deleted_at)')
      .not('po_line_id', 'is', null),
  ])
  if (poRes.error || ginRes.error) return { lines: [], error: poRes.error?.message ?? ginRes.error?.message }

  const received = new Map<string, number>()
  const lastByPo = new Map<string, string>()
  const lineToPo = new Map<string, string>()
  for (const p of poRes.data ?? []) {
    for (const l of p.wh_po_lines ?? []) lineToPo.set(l.id, p.id)
  }
  for (const g of ginRes.data ?? []) {
    const e = one(g.entry)
    if (!g.po_line_id || !e || e.deleted_at) continue
    received.set(g.po_line_id, (received.get(g.po_line_id) ?? 0) + Number(g.received_qty))
    const poId = lineToPo.get(g.po_line_id)
    if (poId) {
      const cur = lastByPo.get(poId)
      if (!cur || e.entry_date > cur) lastByPo.set(poId, e.entry_date)
    }
  }

  const lines: PoLineState[] = []
  for (const p of poRes.data ?? []) {
    for (const l of p.wh_po_lines ?? []) {
      const it = one(l.wh_items)
      lines.push({
        poNo: p.po_no, vendor: p.vendor, entity: p.entity, status: p.status,
        itemName: l.source_text || it?.name || '—', unit: it?.unit ?? '',
        ordered: Number(l.ordered_qty), received: received.get(l.id) ?? 0,
        rate: l.rate == null ? null : Number(l.rate),
        lastDeliveryDay: lastByPo.get(p.id) ?? null,
      })
    }
  }
  return { lines }
}

async function poPendingReport(ctx: Ctx): Promise<ReportView> {
  const { lines, error } = await loadPoLines()
  if (error) return shell(ctx, { error })

  const all = poPending(lines, ctx.today).filter(p => p.pending > 0 && p.status !== 'short_closed')
  const byVendor = new Map<string, typeof all>()
  for (const p of all) {
    const v = p.vendor || '— no vendor named —'
    if (!byVendor.has(v)) byVendor.set(v, [])
    byVendor.get(v)!.push(p)
  }
  const pendingValue = all.reduce((s, p) => s + (p.pendingValue ?? 0), 0)
  const stale = all.filter(p => p.stale)

  return shell(ctx, {
    columns: [
      { header: 'PO', width: 22 }, { header: 'Item', width: 32 },
      { header: 'Ordered', align: 'right' }, { header: 'Received', align: 'right' },
      { header: 'Pending', align: 'right' },
      ...(ctx.showValues ? [{ header: 'Pending value', align: 'right' as const, width: 16 }] : []),
      { header: 'Last delivery' }, { header: 'Status', width: 18 },
    ],
    groups: [...byVendor.entries()]
      .sort((a, b) => b[1].filter(p => p.stale).length - a[1].filter(p => p.stale).length
        || b[1].length - a[1].length)
      .map(([vendor, ps]) => ({
        label: `${vendor} — ${ps.length} pending ${ps.length === 1 ? 'line' : 'lines'}`
          + (ps.some(p => p.stale) ? ` · ${ps.filter(p => p.stale).length} with nothing arriving for a week+` : ''),
        rows: ps.map(p => [
          cell(p.poNo), cell(p.itemName),
          cell(formatQty(p.ordered), p.ordered), cell(formatQty(p.received), p.received),
          cell(`${formatQty(p.pending)} ${p.unit}`, p.pending, p.stale ? 'bad' : 'warn'),
          ...(ctx.showValues ? [MONEY(p.pendingValue)] : []),
          cell(p.daysSinceDelivery === null ? 'never'
            : p.daysSinceDelivery === 0 ? 'today'
            : `${formatNumber(p.daysSinceDelivery, 0)} days ago`,
            p.daysSinceDelivery, p.stale ? 'bad' : undefined),
          cell(p.status.replace(/_/g, ' ')),
        ]),
      })),
    kpis: [
      { label: 'pending lines', value: String(all.length) },
      { label: 'vendors to chase', value: String(byVendor.size) },
      { label: 'nothing for 7+ days', value: String(stale.length), tone: stale.length ? 'bad' : undefined },
      ...(ctx.showValues ? [{ label: 'pending value', value: formatINR(pendingValue) }] : []),
    ],
    caveats: [
      'Pending is a balance, not a shortage — a part delivery is the normal case.',
      'A line that has never had a delivery counts as stale: that is the worst case, not an exemption.',
      'Short-closed POs are excluded — somebody has already decided the rest is not coming.',
      'A position as at today, so the period filter does not apply.',
    ],
    emptyGood: 'Every order has been fully received. Nothing to chase.',
  })
}

async function overReceipt(ctx: Ctx): Promise<ReportView> {
  const { lines, error } = await loadPoLines()
  if (error) return shell(ctx, { error })

  const over = poPending(lines, ctx.today).filter(p => p.overReceived > 0)
  const value = over.reduce((s, p) => s + (p.rate == null ? 0 : p.overReceived * p.rate), 0)

  return shell(ctx, {
    columns: [
      { header: 'PO', width: 22 }, { header: 'Vendor', width: 24 }, { header: 'Item', width: 30 },
      { header: 'Ordered', align: 'right' }, { header: 'Received', align: 'right' },
      { header: 'Over by', align: 'right' },
      ...(ctx.showValues ? [{ header: 'Value over', align: 'right' as const, width: 16 }] : []),
    ],
    groups: over.length ? [{
      label: `${over.length} ${over.length === 1 ? 'line' : 'lines'} received beyond the order`,
      rows: over.map(p => [
        cell(p.poNo), cell(p.vendor ?? '—'), cell(p.itemName),
        cell(formatQty(p.ordered), p.ordered), cell(formatQty(p.received), p.received),
        cell(`${formatQty(p.overReceived)} ${p.unit}`, p.overReceived, 'bad'),
        ...(ctx.showValues ? [MONEY(p.rate == null ? null : p.overReceived * p.rate)] : []),
      ]),
    }] : [],
    kpis: [
      { label: 'over-received lines', value: String(over.length), tone: over.length ? 'bad' : undefined },
      ...(ctx.showValues ? [{ label: 'value over', value: formatINR(value) }] : []),
    ],
    caveats: [
      'An over-receipt is never blocked at the gate — a truck is not turned away — so it is settled here instead.',
      'Either the vendor is owed more money, or the extra goes back. Somebody has to decide which.',
    ],
    emptyGood: 'Nothing has been received beyond what was ordered.',
  })
}

// ===========================================================================
// 10 · Rate variance (#19)
// ===========================================================================
async function rateVarianceReport(ctx: Ctx): Promise<ReportView> {
  const sb = await createClient()
  const { data, error } = await sb
    .from('wh_gate_in_lines')
    .select(`rate, wh_items(id, name, unit, category, discipline),
             entry:wh_gate_in(entry_date, entity, party, deleted_at)`)
    .not('rate', 'is', null)
  if (error) return shell(ctx, { error: error.message })

  const byItem = new Map<string, { name: string; unit: string; category: string; obs: RateObservation[] }>()
  for (const l of data ?? []) {
    const e = one(l.entry); const it = one(l.wh_items)
    if (!e || e.deleted_at || !it) continue
    if (ctx.from && e.entry_date < ctx.from) continue
    if (ctx.to && e.entry_date > ctx.to) continue
    if (!byItem.has(it.id)) byItem.set(it.id, { name: it.name, unit: it.unit, category: catOf(it), obs: [] })
    byItem.get(it.id)!.obs.push({
      entity: e.entity, party: e.party, rate: Number(l.rate), day: e.entry_date,
    })
  }

  const findings = [...byItem.values()]
    .map(i => ({ ...i, spread: rateSpread(i.obs) }))
    .filter(i => i.spread && i.spread.spreadPct >= RATE_SPREAD_FLOOR)
    .sort((a, b) => (b.spread!.spreadPct) - (a.spread!.spreadPct))

  return shell(ctx, {
    columns: [
      { header: 'Item', width: 32 }, { header: 'Category', width: 18 },
      { header: 'Cheapest', align: 'right' },
      { header: 'Paid by / supplier', width: 26 }, { header: 'Dearest', align: 'right' },
      { header: 'Paid by / supplier ', width: 26 }, { header: 'Gap', align: 'right' },
      { header: 'Gap %', align: 'right' }, { header: 'Times taken in', align: 'right' },
    ],
    groups: findings.length ? [{
      label: `${findings.length} ${findings.length === 1 ? 'item' : 'items'} taken in at more than one rate`,
      rows: findings.map(f => {
        const s = f.spread!
        return [
          cell(f.name),
          cell(f.category),
          cell(formatINR(s.low), s.low, 'good'),
          cell([s.cheapest.entity, s.cheapest.party].filter(Boolean).join(' · ') || '—'),
          cell(formatINR(s.high), s.high, 'bad'),
          cell([s.dearest.entity, s.dearest.party].filter(Boolean).join(' · ') || '—'),
          cell(formatINR(s.spread), s.spread, 'bad'),
          cell(`${formatNumber(s.spreadPct * 100, 1)}%`, s.spreadPct, 'bad'),
          cell(String(f.obs.length), f.obs.length),
        ]
      }),
    }] : [],
    kpis: [
      { label: 'items with two prices', value: String(findings.length),
        tone: findings.length ? 'warn' : undefined },
      { label: 'widest gap', value: findings.length
        ? `${formatNumber(findings[0].spread!.spreadPct * 100, 1)}%` : '—',
        tone: findings.length ? 'bad' : undefined },
    ],
    caveats: [
      `Differences under ${Math.round(RATE_SPREAD_FLOOR * 100)}% are ignored — freight and order size move a rate that much without anything being wrong.`,
      'The rate is what was recorded on the gate entry, which is the PO rate unless somebody typed over it.',
    ],
    emptyGood: 'Every item has been taken in at a consistent rate.',
  })
}

// ===========================================================================
// 11 · Entity vs project (#18)
// ===========================================================================
async function entitySettlement(ctx: Ctx): Promise<ReportView> {
  const sb = await createClient()
  const { data, error } = await sb
    .from('wh_gate_out')
    .select(`entry_date, entity, projects(name), wh_gate_out_lines(qty, rate)`)
    .eq('dest_type', 'site').is('deleted_at', null)
  if (error) return shell(ctx, { error: error.message })

  const spend = new Map<string, EntitySpend>()
  for (const e of data ?? []) {
    if (ctx.from && e.entry_date < ctx.from) continue
    if (ctx.to && e.entry_date > ctx.to) continue
    const projectName = one(e.projects)?.name ?? '— no project —'
    const entity = e.entity || '— not stated —'
    const k = `${projectName}|${entity}`
    if (!spend.has(k)) spend.set(k, { projectName, entity, qtyLines: 0, amount: 0 })
    const s = spend.get(k)!
    for (const l of e.wh_gate_out_lines ?? []) {
      s.qtyLines++
      s.amount += l.rate == null ? 0 : Number(l.qty) * Number(l.rate)
    }
  }

  const findings = crossEntity([...spend.values()])

  return shell(ctx, {
    columns: [
      { header: 'Paid by', width: 24 }, { header: 'Issue lines', align: 'right' },
      { header: 'Value issued', align: 'right', width: 16 }, { header: 'Share', align: 'right' },
    ],
    groups: findings.map(f => ({
      label: `${f.projectName} — ${f.entities.length} entities, ${formatINR(f.total)} issued`,
      rows: f.entities.map(e => [
        cell(e.entity),
        cell(String(e.qtyLines), e.qtyLines),
        cell(formatINR(e.amount), e.amount),
        cell(f.total > 0 ? `${formatNumber((e.amount / f.total) * 100, 1)}%` : '—'),
      ]),
      footer: [cell('Total'), cell(String(f.entities.reduce((s, e) => s + e.qtyLines, 0))),
        cell(formatINR(f.total), f.total), cell('100%')],
    })),
    kpis: [
      { label: 'projects needing settlement', value: String(findings.length),
        tone: findings.length ? 'warn' : undefined },
      { label: 'value involved', value: formatINR(findings.reduce((s, f) => s + f.total, 0)) },
    ],
    caveats: [
      'This is what was CHARGED on each issue, not a trace of which truck’s material was used — stock is fungible and pretending otherwise would invent precision that does not exist.',
      'A project funded by one entity is normal and is not listed.',
      'Lines with no rate contribute nothing to the value, so the split can understate.',
    ],
    emptyGood: 'No project has been charged to more than one entity.',
  })
}

// ===========================================================================
// 12 · Entry number gaps (#1)
// ===========================================================================
async function numberGaps(ctx: Ctx): Promise<ReportView> {
  const sb = await createClient()
  const [seriesRes, inRes, outRes] = await Promise.all([
    sb.from('wh_number_series').select('register, day, last_no').order('day', { ascending: false }),
    sb.from('wh_gate_in').select('entry_no, entry_date, deleted_at'),
    sb.from('wh_gate_out').select('entry_no, entry_date, dest_type, deleted_at'),
  ])
  if (seriesRes.error) return shell(ctx, { error: seriesRes.error.message })

  // Which sequence numbers actually have a live entry, per register per day.
  const seen = new Map<string, number[]>()
  const add = (register: string, day: string, entryNo: string) => {
    const n = entrySeq(entryNo)
    if (n === null) return
    const k = `${register}|${day}`
    if (!seen.has(k)) seen.set(k, [])
    seen.get(k)!.push(n)
  }
  for (const e of inRes.data ?? []) if (!e.deleted_at) add('in', e.entry_date, e.entry_no)
  for (const e of outRes.data ?? []) {
    if (e.deleted_at) continue
    add(e.dest_type === 'store' ? 'move' : 'out', e.entry_date, e.entry_no)
  }

  const REG_LABEL: Record<string, string> = {
    in: 'Gate IN', out: 'OUT of the gate', move: 'Store transfer', count: 'Physical count',
  }
  const rows: Cell[][] = []
  let totalGaps = 0
  for (const s of seriesRes.data ?? []) {
    if (ctx.from && s.day < ctx.from) continue
    if (ctx.to && s.day > ctx.to) continue
    const gaps = seriesGaps(Number(s.last_no), seen.get(`${s.register}|${s.day}`) ?? [])
    if (gaps.length === 0) continue
    totalGaps += gaps.length
    rows.push([
      cell(formatDate(s.day)),
      cell(REG_LABEL[s.register] ?? s.register),
      cell(String(s.last_no), Number(s.last_no)),
      cell(String((seen.get(`${s.register}|${s.day}`) ?? []).length)),
      cell(gaps.map(n => String(n).padStart(3, '0')).join(', '), null, 'bad'),
    ])
  }

  return shell(ctx, {
    columns: [
      { header: 'Day' }, { header: 'Register', width: 20 },
      { header: 'Numbers given out', align: 'right' }, { header: 'Entries found', align: 'right' },
      { header: 'Missing', width: 30 },
    ],
    groups: rows.length ? [{ label: `${totalGaps} missing ${totalGaps === 1 ? 'number' : 'numbers'}`, rows }] : [],
    kpis: [
      { label: 'missing numbers', value: String(totalGaps), tone: totalGaps ? 'bad' : undefined },
      { label: 'days affected', value: String(rows.length) },
    ],
    caveats: [
      'Numbers run in strict order per register per day. A number handed out with no entry against it means a movement was not recorded, or an entry was removed — somebody must say which.',
      'A number is also burnt when saving fails halfway. That is the price of making a suppressed entry visible.',
      'A number is matched to the day it was handed out. Nothing can be back-dated today, so that is the same as the entry date — if back-dating is ever allowed, an entry would have to carry the day its number came from or this report would show false gaps.',
    ],
    emptyGood: 'Every number handed out has an entry against it. Nothing is missing.',
  })
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, (m || 1) - 1, 1))
    .toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

// ===========================================================================
// 13 · Voided entries
//
// The counterpart to Entry number gaps. That report asks whether a truck came
// in without being written down; this one asks the opposite — what was written
// down and then taken back out. A void is a legitimate correction, but a store
// where they are frequent, or where the reasons are one word, is a store worth
// looking at.
// ===========================================================================
async function voidedEntries(ctx: Ctx): Promise<ReportView> {
  const sb = await createClient()
  const [inRes, outRes] = await Promise.all([
    sb.from('wh_gate_in')
      .select(`entry_no, entry_date, party, void_reason, deleted_at,
               wh_locations(name),
               voider:profiles!wh_gate_in_deleted_by_fkey(full_name, email),
               wh_gate_in_lines(received_qty)`)
      .not('deleted_at', 'is', null),
    sb.from('wh_gate_out')
      .select(`entry_no, entry_date, dest_type, party, void_reason, deleted_at,
               from:wh_locations!wh_gate_out_from_location_id_fkey(name),
               projects(name),
               voider:profiles!wh_gate_out_deleted_by_fkey(full_name, email),
               wh_gate_out_lines(qty)`)
      .not('deleted_at', 'is', null),
  ])
  if (inRes.error) return shell(ctx, { error: inRes.error.message })
  if (outRes.error) return shell(ctx, { error: outRes.error.message })

  type Void = {
    day: string; entryNo: string; direction: 'IN' | 'OUT'
    who: string; store: string; lines: number; qty: number
    reason: string | null; voidedBy: string | null
  }
  const rows: Void[] = []
  for (const e of inRes.data ?? []) {
    const lines = e.wh_gate_in_lines ?? []
    rows.push({
      day: e.entry_date, entryNo: e.entry_no, direction: 'IN',
      who: e.party || '— not named —', store: one(e.wh_locations)?.name ?? '—',
      lines: lines.length, qty: lines.reduce((s, l) => s + Number(l.received_qty), 0),
      reason: e.void_reason, voidedBy: personName(one(e.voider)),
    })
  }
  for (const e of outRes.data ?? []) {
    const lines = e.wh_gate_out_lines ?? []
    rows.push({
      day: e.entry_date, entryNo: e.entry_no, direction: 'OUT',
      who: e.dest_type === 'site' ? (one(e.projects)?.name ?? 'a site') : (e.party || 'another store'),
      store: one(e.from)?.name ?? '—',
      lines: lines.length, qty: lines.reduce((s, l) => s + Number(l.qty), 0),
      reason: e.void_reason, voidedBy: personName(one(e.voider)),
    })
  }

  const inWindow = period(rows, ctx).sort((a, b) => b.day.localeCompare(a.day))

  // Grouped by store, because "which store keeps unwriting its entries" is the
  // question this gets opened for.
  const byStore = new Map<string, Void[]>()
  for (const r of inWindow) {
    if (!byStore.has(r.store)) byStore.set(r.store, [])
    byStore.get(r.store)!.push(r)
  }
  const groups = [...byStore.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([store, rs]) => ({
      label: `${store} — ${rs.length} ${rs.length === 1 ? 'entry' : 'entries'} voided`,
      rows: rs.map(r => [
        cell(formatDate(r.day)),
        cell(r.entryNo),
        cell(r.direction, null, r.direction === 'IN' ? undefined : 'warn'),
        cell(r.who),
        cell(`${formatQty(r.qty)} across ${r.lines} ${r.lines === 1 ? 'item' : 'items'}`, r.qty),
        cell(r.reason || 'no reason recorded', null, r.reason ? undefined : 'bad'),
        cell(r.voidedBy ?? '—'),
      ]),
    }))

  const noReason = inWindow.filter(r => !r.reason?.trim()).length
  return shell(ctx, {
    columns: [
      { header: 'Date' }, { header: 'Entry', width: 18 }, { header: 'Way' },
      { header: 'Party / project', width: 24 },
      { header: 'What it said', width: 24 },
      { header: 'Why it was voided', width: 34 },
      { header: 'Voided by', width: 20 },
    ],
    groups,
    kpis: [
      { label: 'entries voided', value: String(inWindow.length),
        tone: inWindow.length ? 'warn' : undefined },
      { label: 'stores affected', value: String(byStore.size) },
      ...(noReason > 0
        ? [{ label: 'with no reason given', value: String(noReason), tone: 'bad' as const,
             hint: 'these predate the reason being compulsory' }]
        : []),
    ],
    caveats: [
      'A void reverses what the entry did to stock; both the entry and its reversal stay in the ledger.',
      'The entry number is never reused — a void is not the same as an entry that was never written.',
      'Voiding is normal. A store with many of them, or with one-word reasons, is what this report is for.',
    ],
    emptyGood: 'Nothing has been voided in this period.',
  })
}

function personName(p: unknown): string | null {
  const o = p as { full_name?: string | null; email?: string | null } | null
  return o ? (o.full_name || o.email || null) : null
}
