import type { SupabaseClient } from '@supabase/supabase-js'
import type { BillsMe } from './access'
import type { RegisterRow } from './register'
import { isTerminal, type BbStage } from './stages'

/** Everything the register and its export read, fetched once and shaped once.
 *
 *  The landing page and the CSV route used to be two chances to disagree about
 *  which bills exist and who holds them. They share this now. The rules that
 *  decide anything — filters, tags, the "why" line — live in register.ts and
 *  are pure; this only fetches and shapes.
 *
 *  PostgREST stops at 1,000 rows without a word, so bills are paged, and the
 *  per-bill lookups (documents, last event) are chunked rather than `in()`-ed
 *  with a thousand ids at once. */

export interface RawBill {
  id: string; order_type: string; bill_type: string | null; bill_no: string | null; order_no: string | null
  claimed_amount: number; net_amount: number | null; current_stage: BbStage; stage_since: string
  discipline: string | null; trust: string | null; project_id: string | null
  wo_pending: boolean; amendment_flag: boolean; is_example: boolean; in4_subproject_id: number | null
  vendor_text: string | null; created_by: string | null; created_at: string
}

export interface ProjectRef { code: string; name: string; parent: string | null }

export interface Register {
  rows: RegisterRow[]
  raw: RawBill[]
  projects: Map<string, ProjectRef>
  /** Desk combination key → member ids, resolved through bb_stage_members. */
  memberIds: Map<string, string[]>
  nameOf: Map<string, string>
  deskKey: (r: RawBill) => string
  /** Bills that raised themselves from IN4 today (IST) — the tile's figure. */
  arrivedToday: number
  error: string | null
}

const istDay = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))

const COLS = 'id, order_type, bill_type, bill_no, order_no, claimed_amount, net_amount, current_stage, stage_since, discipline, trust, project_id, wo_pending, amendment_flag, is_example, vendor_text, in4_subproject_id, created_by, created_at'

/** A bill with no contractor named still has to be findable in a list. The
 *  order number is what the person holding the paper is looking at. */
export const vendorOf = (r: { vendor_text: string | null; order_no: string | null; bill_no: string | null }) =>
  r.vendor_text?.trim() || r.order_no?.trim() || (r.bill_no?.trim() ? `Bill ${r.bill_no.trim()}` : 'Unnamed bill')

const chunk = <T,>(xs: T[], n: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}

export async function loadRegister(sb: SupabaseClient, me: BillsMe): Promise<Register> {
  const raw: RawBill[] = []
  let error: string | null = null
  for (let from = 0; ; from += 1000) {
    const { data, error: e } = await sb.from('bb_bills').select(COLS)
      .order('created_at', { ascending: false }).range(from, from + 999)
    if (e) { error = e.message; break }
    const page = (data ?? []) as unknown as RawBill[]
    raw.push(...page)
    if (page.length < 1000) break
  }

  const { data: projData } = await sb.from('projects').select('id, code, name, parent_project_id')
  const projects = new Map<string, ProjectRef>(
    (projData ?? []).map(p => [p.id as string, { code: p.code as string, name: p.name as string, parent: p.parent_project_id as string | null }]),
  )

  const live = raw.filter(r => !isTerminal(r.current_stage))
  const liveIds = live.map(r => r.id)

  // Which live bills carry the stamped bill, and what was last said about each.
  const stamped = new Set<string>()
  const last = new Map<string, { action: string | null; comment: string | null }>()
  for (const ids of chunk(liveIds, 200)) {
    const [{ data: docs }, { data: evs }] = await Promise.all([
      sb.from('bb_bill_docs').select('bill_id, kind').in('bill_id', ids).in('kind', ['bill', 'stamped_bill']),
      sb.from('bb_bill_events').select('bill_id, action, comment, created_at').in('bill_id', ids)
        .order('created_at', { ascending: false }),
    ])
    for (const d of docs ?? []) stamped.add(d.bill_id as string)
    for (const e of evs ?? []) {
      const id = e.bill_id as string
      if (!last.has(id)) last.set(id, { action: (e.action as string | null) ?? null, comment: (e.comment as string | null) ?? null })
    }
  }

  // The desk behind a bill is decided by bb_stage_members, the one place those
  // rules live. The answer only varies by (stage, project, discipline,
  // sub-project), so it is asked once per combination, not once per bill.
  const deskKey = (r: RawBill) =>
    `${r.current_stage}|${r.project_id ?? ''}|${r.discipline ?? ''}|${r.in4_subproject_id ?? ''}`
  const combos = new Map<string, RawBill>()
  for (const r of live) if (!combos.has(deskKey(r))) combos.set(deskKey(r), r)
  const memberIds = new Map<string, string[]>()
  await Promise.all([...combos].map(async ([k, r]) => {
    const { data } = await sb.rpc('bb_stage_members', {
      p_stage: r.current_stage, p_project: r.project_id, p_disc: r.discipline, p_subproject: r.in4_subproject_id,
    })
    memberIds.set(k, ((data ?? []) as string[]).filter(Boolean))
  }))

  const allIds = [...new Set([...memberIds.values()].flat())]
  const nameOf = new Map<string, string>()
  if (allIds.length) {
    const { data: people } = await sb.from('profiles').select('id, full_name, email').in('id', allIds)
    for (const p of people ?? []) nameOf.set(p.id as string, (p.full_name || p.email) as string)
  }

  const rows: RegisterRow[] = raw.map(r => {
    const ev = last.get(r.id)
    return {
      id: r.id,
      vendor: vendorOf(r),
      billNo: r.bill_no,
      orderType: r.order_type,
      orderNo: r.order_no,
      project: r.project_id ? projects.get(r.project_id)?.code ?? null : null,
      amount: Number(r.net_amount ?? r.claimed_amount ?? 0),
      stage: r.current_stage,
      stageSince: r.stage_since,
      isExample: r.is_example,
      autoRaised: r.created_by == null,
      hasStampedBill: stamped.has(r.id),
      lastComment: ev?.comment ?? null,
      lastAction: ev?.action ?? null,
      // On the desk, not merely allowed to see it: an admin sees every desk
      // and is "on" none of them unless named.
      mine: !!me.userId && (memberIds.get(deskKey(r)) ?? []).includes(me.userId),
    }
  })

  const today = istDay(new Date().toISOString())
  const arrivedToday = raw.filter(r => r.created_by == null && istDay(r.created_at) === today).length

  return { rows, raw, projects, memberIds, nameOf, deskKey, arrivedToday, error }
}
