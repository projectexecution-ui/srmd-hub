// Per-Working-Sheet approval timeline — the full cycle of one sheet from
// raise → submit → approval tranches → final sign-off, with who, when,
// comment, attachments and amount at each step. Async server component:
// fetches its own data so it can drop into any of the WS-detail render
// branches (line-item / excel / thumbrule).

import { createClient } from '@/lib/supabase/server'
import { formatINR, personName, formatDuration, formatDateTime } from '@/lib/utils'
import { splitCheckedComment, remarkRepeatsAmount } from '@/lib/cost-control/approval-trail'
import {
  FilePlus2, Send, CheckCircle2, RotateCcw, Wallet, Paperclip, CircleDot, Clock,
} from 'lucide-react'

interface ApprovalEventRow {
  id: string
  from_stage: string | null
  to_stage: string | null
  decision: string | null
  comment: string | null
  attachments: Array<{ name?: string; url?: string }> | null
  created_at: string
  actor_id: string | null
}
interface BudgetEventRow {
  id: string
  event_type: string
  delta_amount: number | null
  remarks: string | null
  event_date: string
  approved_by: string | null
}
interface WSRow {
  created_at: string | null
  submitted_at: string | null
  engineer_id: string | null
  status: string
  total_amount: number | null
  approved_for_erp_amt: number | null
  in4_entered_at: string | null
  in4_entered_by: string | null
  in4_ref: string | null
}

type TLItem = {
  ts: string
  kind: 'raised' | 'submitted' | 'signoff' | 'approved' | 'partial' | 'returned' | 'released' | 'in4'
  who: string | null
  title: string
  comment?: string | null
  amount?: number | null
  /** The figure the approver typed at sign-off, lifted out of the comment. */
  checked?: number | null
  attachments?: Array<{ name?: string; url?: string }> | null
}



export async function ApprovalTimeline({ wsId }: { wsId: string }) {
  const supabase = await createClient()

  const [{ data: ws }, { data: events }, { data: budgetEvents }] = await Promise.all([
    supabase
      .from('cc_working_sheets')
      .select('created_at, submitted_at, engineer_id, status, total_amount, approved_for_erp_amt, in4_entered_at, in4_entered_by, in4_ref')
      .eq('id', wsId)
      .single(),
    supabase
      .from('approval_events')
      .select('id, from_stage, to_stage, decision, comment, attachments, created_at, actor_id')
      .eq('doc_type', 'cc_working_sheet')
      .eq('doc_id', wsId)
      .order('created_at', { ascending: true }),
    supabase
      .from('cc_budget_events')
      .select('id, event_type, delta_amount, remarks, event_date, approved_by')
      .eq('related_ws_id', wsId)
      .order('event_date', { ascending: true }),
  ])

  const wsRow = ws as WSRow | null
  const evRows = (events ?? []) as ApprovalEventRow[]
  const beRows = (budgetEvents ?? []) as BudgetEventRow[]

  // Resolve all actor names in one query.
  const ids = Array.from(new Set([
    wsRow?.engineer_id,
    wsRow?.in4_entered_by,
    ...evRows.map(e => e.actor_id),
    ...beRows.map(b => b.approved_by),
  ].filter((x): x is string => !!x)))
  const nameById = new Map<string, string>()
  if (ids.length > 0) {
    const { data: profs } = await supabase.from('profiles').select('id, full_name, name, email').in('id', ids)
    for (const p of profs ?? []) nameById.set(p.id as string, personName(p.full_name, p.name, p.email))
  }

  const items: TLItem[] = []

  // 1. Raised
  if (wsRow?.created_at) {
    items.push({ ts: wsRow.created_at, kind: 'raised', who: wsRow.engineer_id ? nameById.get(wsRow.engineer_id) ?? null : null, title: 'Working Sheet raised' })
  }
  // 2. Submitted. The event log is authoritative when it has a submit-shaped
  //    event, because cc_request_release ALSO rewrites submitted_at — which
  //    produced "Submitted for approval" and "Requested release of the
  //    balance" as two entries a minute apart for one action.
  const hasSubmitEvent = evRows.some(e => e.to_stage === 'submitted' || e.decision === 'release_requested')
  if (wsRow?.submitted_at && !hasSubmitEvent) {
    items.push({ ts: wsRow.submitted_at, kind: 'submitted', who: wsRow.engineer_id ? nameById.get(wsRow.engineer_id) ?? null : null, title: 'Submitted for approval' })
  }
  // 3. Approval events (decisions by stakeholders). The 3-stage chain
  //    logs sign-offs (→ ph_approved / atm_approved) as well as releases.
  for (const e of evRows) {
    const isReturn  = e.decision === 'returned' || e.to_stage === 'returned'
    const isFull    = e.to_stage === 'approved'
    const isSignOff = e.to_stage === 'ph_approved' || e.to_stage === 'atm_approved'
    // Engineer sent a partly released sheet back through the chain to ask
    // for the balance (cc_request_release).
    const isReleaseRequest = e.decision === 'release_requested' || e.to_stage === 'submitted'
    items.push({
      ts: e.created_at,
      kind: isReturn ? 'returned' : isReleaseRequest ? 'submitted' : isSignOff ? 'signoff' : isFull ? 'approved' : 'partial',
      who: e.actor_id ? nameById.get(e.actor_id) ?? null : null,
      title: isReturn
        ? `Returned to engineer${e.from_stage === 'ph_approved' ? ' (by Atm Head stage)' : e.from_stage === 'atm_approved' || e.from_stage === 'partially_approved' ? ' (by Trustee stage)' : ''}`
        : isReleaseRequest ? 'Requested release of the balance — back into the approval chain'
        : e.to_stage === 'ph_approved' ? 'Project Head signed off'
        : e.to_stage === 'atm_approved' ? 'Atm Head signed off'
        : isFull ? 'Fully approved into ERP' : 'Release approved (partial)',
      // Sign-offs store the checked figure INSIDE the comment
      // ("Checked ₹51,27,656 — <remark>"). Split it back out so the remark
      // reads as the person's own words instead of a sentence with our
      // bookkeeping welded to the front.
      ...splitCheckedComment(e.comment),
      attachments: e.attachments,
    })
  }
  // 4. Budget release events (the money side)
  for (const b of beRows) {
    if (b.event_type !== 'ws_approved') continue
    items.push({
      ts: b.event_date,
      kind: 'released',
      who: b.approved_by ? nameById.get(b.approved_by) ?? null : null,
      title: 'Budget released',
      amount: b.delta_amount,
      comment: b.remarks,
    })
  }

  // 5. Billing marked the released amount as entered in the IN4 ERP.
  if (wsRow?.in4_entered_at) {
    items.push({
      ts: wsRow.in4_entered_at,
      kind: 'in4',
      who: wsRow.in4_entered_by ? nameById.get(wsRow.in4_entered_by) ?? null : null,
      title: 'Entered in IN4 ERP',
      comment: wsRow.in4_ref ? `IN4 reference: ${wsRow.in4_ref}` : null,
    })
  }

  // Chronological first, so "+2h after previous" measures against the step that
  // genuinely came before…
  items.sort((a, b) => a.ts.localeCompare(b.ts))
  const gaps = items.map((it, i) => (i > 0 ? formatDuration(items[i - 1].ts, it.ts) : ''))
  // …then newest at the top, which is where the reader looks first.
  const feed = items.map((it, i) => ({ ...it, gap: gaps[i] })).reverse()

  const style: Record<TLItem['kind'], { Icon: typeof Send; dot: string; ring: string }> = {
    raised:    { Icon: FilePlus2,    dot: 'bg-gray-400',    ring: 'ring-gray-100' },
    submitted: { Icon: Send,         dot: 'bg-blue-500',    ring: 'ring-blue-100' },
    signoff:   { Icon: CheckCircle2, dot: 'bg-indigo-500',  ring: 'ring-indigo-100' },
    partial:   { Icon: CircleDot,    dot: 'bg-amber-500',   ring: 'ring-amber-100' },
    approved:  { Icon: CheckCircle2, dot: 'bg-emerald-500', ring: 'ring-emerald-100' },
    returned:  { Icon: RotateCcw,    dot: 'bg-rose-500',    ring: 'ring-rose-100' },
    released:  { Icon: Wallet,       dot: 'bg-emerald-600', ring: 'ring-emerald-100' },
    in4:       { Icon: Wallet,       dot: 'bg-teal-600',    ring: 'ring-teal-100' },
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <div className="px-4 py-2.5 border-b border-gray-100">
        <h3 className="text-sm font-bold text-gray-900 inline-flex items-center gap-2">
          <Clock className="h-4 w-4 text-gray-500" /> Approval trail
        </h3>
        <p className="text-[11px] text-gray-500">Full cycle — every stakeholder action on this sheet, most recent first.</p>
      </div>

      {items.length === 0 ? (
        <p className="px-4 py-6 text-sm text-gray-500 text-center">No activity yet — this sheet hasn&apos;t moved through approval.</p>
      ) : (
        <ol className="p-4 space-y-0">
          {feed.map((it, i) => {
            const s = style[it.kind]
            const last = i === feed.length - 1
            const gap = it.gap
            // Don't print the checked figure twice. Approvers routinely type it
            // into their own remark ("Ok to go ahead, checked 51,27,656/-"),
            // and repeating it from our prefix is what made the trail read
            // like a machine talking over a person.
            const showChecked = it.checked != null && !remarkRepeatsAmount(it.comment ?? null, it.checked)
            return (
              <li key={i} className="relative flex gap-3 pb-4 last:pb-0">
                {/* connector line */}
                {!last && <span className="absolute left-[11px] top-6 bottom-0 w-px bg-gray-200" aria-hidden />}
                <span className={`relative z-10 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full ${s.dot} ring-4 ${s.ring}`}>
                  <s.Icon className="h-3.5 w-3.5 text-white" />
                </span>
                <div className="min-w-0 flex-1 -mt-0.5">
                  <div className="flex items-baseline justify-between gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-gray-900">
                      {it.title}
                      {it.amount != null && <span className="ml-2 font-bold text-emerald-700 tabular-nums">{formatINR(it.amount)}</span>}
                      {showChecked && (
                        <span className="ml-2 text-xs font-normal text-gray-500 tabular-nums">
                          checked {formatINR(it.checked!)}
                        </span>
                      )}
                    </p>
                    <time className="text-[11px] text-gray-400 whitespace-nowrap">{formatDateTime(it.ts)}</time>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-xs text-gray-500">{it.who ?? '—'}</p>
                    {gap && i > 0 && (
                      <span className="text-[10px] text-gray-400 bg-gray-100 rounded-full px-1.5 py-0.5" title="Time since the previous step">
                        +{gap} after previous
                      </span>
                    )}
                  </div>
                  {it.comment && (
                    <p className="mt-1 text-xs text-gray-700 bg-gray-50 border border-gray-100 rounded px-2 py-1 whitespace-pre-line">“{it.comment}”</p>
                  )}
                  {it.attachments && it.attachments.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {it.attachments.map((a, j) => (
                        <a key={j} href={a.url ?? '#'} target="_blank" rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] text-blue-700 hover:underline bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5">
                          <Paperclip className="h-3 w-3" /> {a.name ?? 'attachment'}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
