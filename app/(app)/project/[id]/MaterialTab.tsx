import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import { loadEntries, loadRequests, loadReturnables, loadLists, locationLabel } from '@/lib/stores/queries'
import { fmtQty, RETURNABLES_ON } from '@/lib/stores/core'
import { formatDate, formatDateTime, formatINR } from '@/lib/utils'
import {
  Empty, Scroller, th, thNum, td, tdNum, StageChip, RegisterChip, StatusChip, When,
} from '@/app/(app)/stores/ui'

/**
 * Material In & Out, seen from inside ONE project.
 *
 * Four pills: what came in for this project, what was issued to it, what it
 * still owes back, and its requests. The cross-project half — the gate queue,
 * the item master, the whole store — stays in the Stores lane, because a
 * warehouse holding material for eleven sites is not a project's question.
 *
 * Reads the same loaders as the lane, so the two can never quote different
 * quantities for the same material.
 */
export async function MaterialTab({ projectId, view = 0 }: { projectId: string; view?: number }) {
  const [entries, requests, returnables, lists] = await Promise.all([
    loadEntries({ projectId, limit: 200 }),
    loadRequests({ projectId }),
    RETURNABLES_ON ? loadReturnables(projectId) : Promise.resolve([]),
    loadLists(),
  ])

  const ins = entries.filter(e => e.direction === 'in' && e.stage !== 'void')
  const outs = entries.filter(e => e.direction === 'out' && e.stage !== 'void')
  const PILLS = RETURNABLES_ON
    ? ['In', 'Issued out', 'To return', 'Requests'] as const
    : ['In', 'Issued out', 'Requests'] as const
  const pill = PILLS[view] ?? PILLS[0]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5">
        <p className="text-[12.5px] text-amber-900">
          <b>Under review.</b> Material In &amp; Out is live on this project only, so it can be picked apart
          before it goes everywhere.
        </p>
        <Link href="/stores" className="ml-auto inline-flex items-center gap-1 text-[12.5px] font-semibold text-amber-900 hover:underline whitespace-nowrap">
          The whole store <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {/* Pills are named, not numbered: with returnables switched off the list
          is three long, and a hard-coded index 3 would land on nothing. */}
      {pill === 'In' && <InPanel rows={ins} />}
      {pill === 'Issued out' && <OutPanel rows={outs} />}
      {pill === 'To return' && <ReturnPanel rows={returnables} />}
      {pill === 'Requests' && <RequestPanel rows={requests} />}
    </div>
  )
}

function InPanel({ rows }: { rows: Awaited<ReturnType<typeof loadEntries>> }) {
  if (rows.length === 0) {
    return (
      <Empty
        title="Nothing has come in for this project yet"
        hint="Material appears here once Security records the vehicle and the storekeeper completes the entry."
        action={
          <Link href="/stores/gate" className="inline-flex items-center rounded-lg bg-indigo-700 px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-indigo-800 min-h-[44px]">
            Open the gate register
          </Link>
        }
      />
    )
  }
  return (
    <Scroller min={800}>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={th}>Number</th>
            <th className={th}>Register</th>
            <th className={th}>Party</th>
            <th className={th}>Vehicle</th>
            <th className={th}>PO / WO</th>
            <th className={th}>Put away at</th>
            <th className={thNum}>Lines</th>
            <th className={th}>Stage</th>
            <th className={th}>When</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(e => (
            <tr key={e.id}>
              <td className={td}>
                <Link href={`/stores/gate/${e.id}`} className="font-mono text-[12.5px] font-semibold text-indigo-700 hover:underline">{e.no}</Link>
              </td>
              <td className={td}><RegisterChip register={e.register} /></td>
              <td className={td}>{e.partyName ?? <span className="text-gray-400">—</span>}</td>
              <td className={`${td} font-mono text-[12px]`}>{e.vehicleNo ?? '—'}</td>
              <td className={`${td} font-mono text-[12px]`}>{e.poWoNo ?? '—'}</td>
              <td className={td}>{e.locationName ?? <span className="text-gray-400">to site</span>}</td>
              <td className={tdNum}>{e.lineCount ? `${e.lineCount} · ${fmtQty(e.totalQty)}` : '—'}</td>
              <td className={td}><StageChip stage={e.stage} /></td>
              <td className={td}><When at={e.entryAt} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Scroller>
  )
}

function OutPanel({ rows }: { rows: Awaited<ReturnType<typeof loadEntries>> }) {
  if (rows.length === 0) {
    return (
      <Empty
        title="Nothing has been issued to this project"
        hint="An issue starts with an engineer's request, approved by Mayank or Kanti, then handed out by the storekeeper."
      />
    )
  }
  return (
    <Scroller min={700}>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={th}>Number</th>
            <th className={th}>Out of</th>
            <th className={th}>Handed to</th>
            <th className={thNum}>Lines</th>
            <th className={thNum}>Qty</th>
            <th className={th}>When</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(e => (
            <tr key={e.id}>
              <td className={td}>
                <Link href={`/stores/gate/${e.id}`} className="font-mono text-[12.5px] font-semibold text-indigo-700 hover:underline">{e.no}</Link>
              </td>
              <td className={td}>{e.locationName ?? '—'}</td>
              <td className={td}>{e.partyName ?? <span className="text-gray-400">—</span>}</td>
              <td className={tdNum}>{e.lineCount}</td>
              <td className={tdNum}>{fmtQty(e.totalQty)}</td>
              <td className={td}><When at={e.entryAt} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Scroller>
  )
}

function ReturnPanel({ rows }: { rows: Awaited<ReturnType<typeof loadReturnables>> }) {
  if (rows.length === 0) {
    return <Empty title="This project owes nothing back" hint="Returnable material shows here the moment it is issued." />
  }
  return (
    <Scroller min={720}>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={th}>Item</th>
            <th className={th}>Owed to</th>
            <th className={thNum}>Out</th>
            <th className={thNum}>Back</th>
            <th className={thNum}>Still out</th>
            <th className={th}>Since</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={`${r.entryId}-${r.itemId}`}>
              <td className={td}>{r.itemName}</td>
              <td className={td}>{r.owedTo}</td>
              <td className={tdNum}>{fmtQty(r.qty)} {r.unit}</td>
              <td className={tdNum}>{r.returned > 0 ? fmtQty(r.returned) : '—'}</td>
              <td className={`${tdNum} font-bold ${r.days > 30 ? 'text-rose-700' : 'text-amber-800'}`}>{fmtQty(r.outstanding)}</td>
              <td className={td}>
                {formatDate(r.since)}
                <span className={`block text-[11px] ${r.days > 30 ? 'text-rose-600 font-semibold' : 'text-gray-400'}`}>{r.days} days</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Scroller>
  )
}

function RequestPanel({ rows }: { rows: Awaited<ReturnType<typeof loadRequests>> }) {
  if (rows.length === 0) {
    return (
      <Empty
        title="No requests on this project"
        hint="An engineer raises one against the project; it goes to Mayank or Kanti to approve."
        action={
          <Link href="/stores/requests" className="inline-flex items-center rounded-lg bg-indigo-700 px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-indigo-800 min-h-[44px]">
            Raise a request
          </Link>
        }
      />
    )
  }
  return (
    <div className="space-y-3">
      {rows.map(r => (
        <div key={r.id} className="rounded-lg border border-gray-200 bg-white p-3.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="font-mono text-[13px] font-bold text-gray-900">{r.no}</span>
            <StatusChip status={r.status} />
            {r.fromProjectName && (
              <span className="rounded bg-teal-100 px-1.5 py-0.5 text-[10.5px] font-semibold text-teal-900">
                from {r.fromProjectName}
              </span>
            )}
            <span className="ml-auto text-[11.5px] text-gray-400">
              {r.raisedByName ?? 'Someone'} · {formatDateTime(r.raisedAt)}
            </span>
          </div>
          <ul className="mt-2 space-y-0.5">
            {r.lines.map(l => (
              <li key={l.id} className="text-[12.5px] text-gray-700">
                {l.itemName} — <span className="tabular-nums">{fmtQty(l.qty)} {l.unit}</span>
                {l.issuedQty > 0 && <span className="text-emerald-700"> · {fmtQty(l.issuedQty)} issued</span>}
                {l.returnable && <span className="text-amber-800"> · must come back</span>}
              </li>
            ))}
          </ul>
          {r.decisionNote && <p className="text-[12px] text-gray-600 mt-1.5 italic">{r.decisionNote}</p>}
        </div>
      ))}
    </div>
  )
}
