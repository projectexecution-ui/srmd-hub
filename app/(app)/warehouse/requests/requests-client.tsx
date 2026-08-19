'use client'

/** Requests in lanes, because "what needs me" is the only question anybody
 *  opens this screen with. V1 showed one org-wide list and a keeper had to read
 *  every site's requests to find his own — which is a large part of why nobody
 *  read it. */

import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { formatDate } from '@/lib/utils'
import { formatQty, formatINR } from '@/lib/warehouse/format'
import { STATUS_LABEL, STATUS_TONE } from '@/lib/warehouse/requests'
import type { RequestRow, RequestLanes } from '@/lib/warehouse/request-data'
import { Stamp, PackageCheck, UserRound, Clock, ArrowRight } from 'lucide-react'

const TONE: Record<string, string> = {
  wait: 'bg-amber-100 text-amber-900',
  go: 'bg-emerald-100 text-emerald-800',
  part: 'bg-sky-100 text-sky-800',
  done: 'bg-slate-100 text-slate-600',
  bad: 'bg-rose-100 text-rose-800',
  dead: 'bg-slate-100 text-slate-400',
}

export function RequestsClient({
  lanes, showValues,
}: {
  lanes: RequestLanes
  showValues: boolean
}) {
  const empty = lanes.toApprove.length === 0 && lanes.toIssue.length === 0
    && lanes.mine.length === 0 && lanes.recent.length === 0

  if (empty) {
    return (
      <Card className="p-8 shadow-sm text-center space-y-1">
        <p className="text-[13.5px] font-bold text-slate-700">Nothing has been asked for yet</p>
        <p className="text-[12.5px] text-slate-500">
          When an engineer needs material from a store, this is where the ask lands.
        </p>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Lane
        title="Waiting for your approval"
        why="Nothing can be issued against these until you decide."
        icon={<Stamp className="h-4 w-4" />}
        tone="border-amber-200 bg-amber-50/50"
        rows={lanes.toApprove} showValues={showValues} />

      <Lane
        title="For the store to issue"
        why="Approved and outstanding. The material has not gone out yet."
        icon={<PackageCheck className="h-4 w-4" />}
        tone="border-emerald-200 bg-emerald-50/40"
        rows={lanes.toIssue} showValues={showValues} />

      <Lane
        title="You asked for these"
        why="Still open. Chase them from here rather than by phone."
        icon={<UserRound className="h-4 w-4" />}
        tone="border-slate-200"
        rows={lanes.mine} showValues={showValues} />

      <Lane
        title="Everything else, recently"
        why="Finished, rejected or cancelled — kept visible so the queue can be audited."
        icon={<Clock className="h-4 w-4" />}
        tone="border-slate-200"
        rows={lanes.recent} showValues={showValues} collapsedByDefault />

      {!lanes.canApprove && lanes.toApprove.length === 0 && (
        <p className="text-[11px] text-slate-400 px-0.5">
          Approving is an admin or Atm Head job, so that lane is not shown to you.
        </p>
      )}
    </div>
  )
}

function Lane({
  title, why, icon, tone, rows, showValues, collapsedByDefault,
}: {
  title: string
  why: string
  icon: React.ReactNode
  tone: string
  rows: RequestRow[]
  showValues: boolean
  collapsedByDefault?: boolean
}) {
  // An empty lane is not shown at all — a heading over nothing is noise, and
  // "Waiting for your approval · 0" is worse than silence.
  if (rows.length === 0) return null

  return (
    <section className="space-y-1.5">
      <div className="flex items-baseline gap-2 px-0.5">
        <span className="text-slate-500">{icon}</span>
        <h2 className="text-[13px] font-extrabold text-slate-800">{title}</h2>
        <span className="text-[11.5px] font-bold text-slate-400">{rows.length}</span>
      </div>
      <p className="text-[11.5px] text-slate-500 px-0.5">{why}</p>

      <Card className={`p-0 shadow-sm overflow-hidden divide-y divide-slate-100 border ${tone}`}>
        {(collapsedByDefault ? rows.slice(0, 6) : rows).map(r => (
          <Row key={r.id} r={r} showValues={showValues} />
        ))}
        {collapsedByDefault && rows.length > 6 && (
          <p className="px-3 py-2 text-[11.5px] text-slate-500">
            …and {rows.length - 6} more. Older requests are in the Requests report.
          </p>
        )}
      </Card>
    </section>
  )
}

function Row({ r, showValues }: { r: RequestRow; showValues: boolean }) {
  return (
    <Link href={`/warehouse/requests/${r.id}`}
      className="flex items-start gap-3 px-3 py-2.5 min-h-[60px] hover:bg-white/70">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-bold text-slate-800 flex items-center gap-1.5 flex-wrap">
          {r.storeName}
          <ArrowRight className="h-3 w-3 text-slate-400" />
          {r.destination}
        </p>
        <p className="text-[11.5px] text-slate-600 truncate mt-0.5">{r.purpose}</p>
        <p className="text-[11px] text-slate-500 mt-0.5">
          <span className="font-mono">{r.reqNo}</span>
          {r.requestedBy ? ` · ${r.requestedBy}` : ''}
          {` · ${r.lines} ${r.lines === 1 ? 'item' : 'items'}, ${formatQty(r.qty)}`}
          {r.needBy ? ` · needed ${formatDate(r.needBy)}` : ''}
          {showValues && r.estValue != null ? ` · ~${formatINR(r.estValue)}` : ''}
        </p>
        {r.status === 'rejected' && r.rejectReason && (
          <p className="text-[11px] text-rose-700 font-semibold mt-0.5">{r.rejectReason}</p>
        )}
      </div>

      <div className="flex-shrink-0 text-right space-y-1">
        <span className={`inline-block rounded-full px-2 py-0.5 text-[10.5px] font-bold ${TONE[STATUS_TONE[r.status]]}`}>
          {STATUS_LABEL[r.status]}
        </span>
        {r.status === 'pending' && r.stagesNeeded > 1 && (
          <p className="text-[10.5px] text-slate-500">{r.stagesDone} of {r.stagesNeeded} approved</p>
        )}
        {r.status === 'part_issued' && (
          <p className="text-[10.5px] font-bold text-sky-700">{r.pct}% issued</p>
        )}
        {/* Ageing is what makes a queue self-policing — nobody argues with a
            number of days. Only shown once it is worth chasing. */}
        {r.stale && (
          <p className="text-[10.5px] font-bold text-rose-600">{r.age} days waiting</p>
        )}
      </div>
    </Link>
  )
}
