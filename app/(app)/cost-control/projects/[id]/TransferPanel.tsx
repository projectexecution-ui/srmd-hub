// "Budget moving between work categories" — the band on the project screen.
//
// Crossing categories changes what each one was approved to spend, so it needs
// to be visible on the project rather than buried in whoever's inbox it is
// sitting in. Open requests show in full, because somebody owes an action on
// each one. Settled ones roll up behind a summary — a project with a long
// history should not push the work categories off the screen.
//
// A project that has never moved budget across categories shows nothing.

import { ArrowLeftRight, TriangleAlert } from 'lucide-react'
import { formatINR, formatDate } from '@/lib/utils'
import {
  isOpen, isMismatched, shortLabel, explain, chipClasses,
  type ProjectTransfer,
} from '@/lib/cost-control/transfers'
import { WithdrawTransferButton } from './WithdrawTransferButton'

function Chip({ t }: { t: ProjectTransfer }) {
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide border whitespace-nowrap ${chipClasses(t.status)}`}
      title={explain(t.status)}
    >
      {shortLabel(t.status)}
    </span>
  )
}

function Row({ t, projectId, canWithdraw }: {
  t: ProjectTransfer
  projectId: string
  canWithdraw: boolean
}) {
  const mismatch = isMismatched(t)
  return (
    <div className="px-4 py-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          {/* The movement itself, on one line, in the project's own naming. */}
          <p className="text-[12.5px] text-gray-900">
            <span className="text-gray-500">{t.from_label}</span>
            <ArrowLeftRight className="inline h-3 w-3 mx-1.5 text-indigo-500 align-middle" />
            <b>{t.to_label}</b>
          </p>
          <p className="mt-1 text-[12px] text-gray-700 whitespace-pre-line">{t.reason}</p>

          {/* Who has touched it, in the order it happened. */}
          <p className="mt-1.5 text-[11px] text-gray-500">
            Raised by {t.raised_by_name ?? '—'}
            {t.raised_at && <> · {formatDate(t.raised_at)}</>}
            {t.atm_at && <> → Atm Head {t.atm_by_name ?? ''} {formatDate(t.atm_at)}</>}
            {t.trustee_at && <> → Trustee {t.trustee_by_name ?? ''} {formatDate(t.trustee_at)}</>}
            {t.in4_at && <> → IN4 {t.in4_by_name ?? ''} {formatDate(t.in4_at)}</>}
          </p>

          {(t.atm_comment || t.trustee_comment) && (
            <p className="mt-1 text-[11.5px] text-gray-600 italic">
              {[t.atm_comment, t.trustee_comment].filter(Boolean).join(' · ')}
            </p>
          )}

          {/* A transfer that IN4 did not match stays open on purpose, and the
              note says what actually moved. */}
          {mismatch && (
            <p className="mt-1.5 text-[11.5px] font-semibold text-rose-800 bg-rose-50 border border-rose-200 rounded px-2 py-1.5 inline-flex items-start gap-1.5">
              <TriangleAlert className="h-3.5 w-3.5 flex-shrink-0 mt-px" />
              <span className="font-normal">{t.settle_note}</span>
            </p>
          )}

          {t.closed_reason && (
            <p className="mt-1 text-[11.5px] text-gray-600">{t.closed_reason}</p>
          )}
        </div>

        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          <p className="text-[13px] font-bold tabular-nums text-gray-900">{formatINR(t.amount)}</p>
          <Chip t={t} />
          {canWithdraw && (t.status === 'pending_atm' || t.status === 'pending_trustee') && (
            <WithdrawTransferButton
              id={t.id} projectId={projectId}
              amount={t.amount} fromLabel={t.from_label}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export function TransferPanel({
  transfers, projectId,
}: {
  transfers: ProjectTransfer[]
  projectId: string
}) {
  if (transfers.length === 0) return null

  const open = transfers.filter(t => isOpen(t.status))
  const settled = transfers.filter(t => !isOpen(t.status))
  const openTotal = open.reduce((s, t) => s + t.amount, 0)

  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 overflow-hidden">
      <div className="flex items-center justify-between gap-3 flex-wrap px-4 py-2.5 border-b border-indigo-200">
        <p className="text-[13px] font-bold text-indigo-900 inline-flex items-center gap-1.5">
          <ArrowLeftRight className="h-4 w-4" /> Budget moving between work categories
        </p>
        <p className="text-[11.5px] text-indigo-900/70 tabular-nums">
          {open.length > 0
            ? `${open.length} open · ${formatINR(openTotal)}`
            : `${settled.length} settled`}
        </p>
      </div>

      {open.length > 0 && (
        <div className="divide-y divide-indigo-200 bg-white/60">
          {open.map(t => (
            <Row key={t.id} t={t} projectId={projectId} canWithdraw={t.raised_by_me} />
          ))}
        </div>
      )}

      {settled.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer list-none px-4 py-2.5 text-[11.5px] font-semibold text-indigo-800 hover:bg-indigo-100/50 border-t border-indigo-200 first:border-t-0">
            {settled.length} settled transfer{settled.length === 1 ? '' : 's'}
            <span className="ml-1 font-normal text-indigo-700/70 group-open:hidden">— show</span>
            <span className="ml-1 font-normal text-indigo-700/70 hidden group-open:inline">— hide</span>
          </summary>
          <div className="divide-y divide-indigo-200 bg-white/60 border-t border-indigo-200">
            {settled.map(t => (
              <Row key={t.id} t={t} projectId={projectId} canWithdraw={false} />
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
