'use client'
// Read-only view for a thumbrule Working Sheet. A thumbrule estimate is a
// single rate × area figure — there are NO line items to itemise, so this
// panel just shows the total + the rate×area note + the shared 3-stage
// approval block (stepper + submit / sign-off / release / return).

import { Card, CardContent } from '@/components/ui/card'
import { Ruler } from 'lucide-react'
import { WSApprovalActions, type SignOffCfg } from '@/components/cost-control/WSApprovalActions'
import type { WSApprovalContext } from '@/components/cost-control/ws-actions'
import type { WSStatus } from '@/components/cost-control/WSStatusPill'
import { formatINR } from '@/lib/utils'

export function ThumbruleSummaryPanel({
  wsId, status, ctx, totalAmount, approvedSoFar, chainReleasedSoFar, summaryNotes, pastApproved, showPastApproved = true, signOffCfg,
}: {
  wsId: string
  status: WSStatus
  ctx: WSApprovalContext
  totalAmount: number
  approvedSoFar: number
  /** Chain-wide released-so-far — forwarded to the Trustee release balance. */
  chainReleasedSoFar?: number
  summaryNotes: string | null
  pastApproved: number
  /** Big historical numbers are management-only. */
  showPastApproved?: boolean
  signOffCfg?: SignOffCfg
}) {
  return (
    <Card>
      <CardContent className="pt-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center flex-shrink-0">
            <Ruler className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-gray-900">Thumbrule estimate</p>
            <p className="text-xs text-gray-500">A quick rate × built-up area figure — no line items needed.</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wide text-gray-500">Estimate</p>
            <p className="text-2xl font-bold text-gray-900 tabular-nums">{formatINR(totalAmount)}</p>
          </div>
        </div>

        {summaryNotes && (
          <div className="rounded-lg border border-gray-200 bg-gray-50/60 px-3 py-2 text-sm text-gray-700">
            <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-0.5">How it&apos;s calculated</p>
            <p className="whitespace-pre-line">{summaryNotes}</p>
          </div>
        )}

        {showPastApproved && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
            <Cell label="Past approved in sub-skill" value={formatINR(pastApproved)} />
            <Cell label="Released via this sheet" value={approvedSoFar > 0 ? formatINR(approvedSoFar) : '—'} />
            <Cell label="This estimate" value={formatINR(totalAmount)} tone="amber" />
          </div>
        )}

        <div className="pt-3 border-t border-gray-100">
          <WSApprovalActions
            signOffCfg={signOffCfg}
            wsId={wsId}
            status={status}
            ctx={ctx}
            totalAmount={totalAmount}
            approvedSoFar={approvedSoFar}
            chainReleasedSoFar={chainReleasedSoFar}
            submitDisabled={!totalAmount || totalAmount <= 0}
          />
        </div>
      </CardContent>
    </Card>
  )
}

function Cell({ label, value, tone }: { label: string; value: string; tone?: 'amber' }) {
  return (
    <div className={`rounded-xl border p-3 ${tone === 'amber' ? 'border-amber-200 bg-amber-50/40' : 'border-gray-200 bg-white'}`}>
      <p className="text-[11px] uppercase tracking-wide text-gray-500">{label}</p>
      <p className="text-base font-semibold text-gray-900 mt-0.5 tabular-nums">{value}</p>
    </div>
  )
}
