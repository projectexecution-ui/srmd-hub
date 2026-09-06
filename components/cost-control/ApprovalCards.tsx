// The approval card, as it looks on /cost-control/approvals.
//
// Lifted out of that page unchanged so the project workspace's Approvals tab
// can render the SAME card rather than a lookalike. Two screens drawing the
// same thing from two pieces of markup drift within weeks — the dashboard's
// lighter version is already proof of that — and when the thing being drawn is
// a budget waiting for a signature, drift means two screens quoting different
// money for the same sheet.
//
// Presentational only. Everything it shows arrives as props from
// lib/cost-control/approvals-inbox.ts.

import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { ArrowRight, ArrowUpRight, ArrowDownRight, Download } from 'lucide-react'
import { formatINR } from '@/lib/utils'
import { isWaitingOnMe, type MyApprovalContext } from '@/lib/cost-control/my-approvals'
import {
  pickFirst, daysWaiting, increment, groupByDiscipline,
  type WSRow, type WSEnrichment,
} from '@/lib/cost-control/approvals-inbox'

// Soft, distinct colour per project so a long list reads as clearly separate
// projects. Assigned by a stable hash of the project code, so a project keeps
// the same colour on every visit.
const TONES = [
  { rail: 'border-l-indigo-300', head: 'bg-indigo-50/70', code: 'bg-indigo-100 text-indigo-700', avatar: 'bg-indigo-100 text-indigo-700', ba: 'bg-indigo-50/60 border-indigo-200 text-indigo-900' },
  { rail: 'border-l-teal-300',   head: 'bg-teal-50/70',   code: 'bg-teal-100 text-teal-700',     avatar: 'bg-teal-100 text-teal-700',     ba: 'bg-teal-50/60 border-teal-200 text-teal-900' },
  { rail: 'border-l-violet-300', head: 'bg-violet-50/70', code: 'bg-violet-100 text-violet-700', avatar: 'bg-violet-100 text-violet-700', ba: 'bg-violet-50/60 border-violet-200 text-violet-900' },
  { rail: 'border-l-rose-300',   head: 'bg-rose-50/70',   code: 'bg-rose-100 text-rose-700',     avatar: 'bg-rose-100 text-rose-700',     ba: 'bg-rose-50/60 border-rose-200 text-rose-900' },
  { rail: 'border-l-sky-300',    head: 'bg-sky-50/70',    code: 'bg-sky-100 text-sky-700',       avatar: 'bg-sky-100 text-sky-700',       ba: 'bg-sky-50/60 border-sky-200 text-sky-900' },
  { rail: 'border-l-amber-300',  head: 'bg-amber-50/70',  code: 'bg-amber-100 text-amber-700',   avatar: 'bg-amber-100 text-amber-700',   ba: 'bg-amber-50/60 border-amber-200 text-amber-900' },
]
export function toneFor(key: string) {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return TONES[h % TONES.length]
}

export interface ApprovalCardProps {
  projectId: string
  items: WSRow[]
  enrich: Map<string, WSEnrichment>
  approvedByDisc: Map<string, number>
  approvedBySub: Map<string, number>
  erpBudget: number
  parent: { code: string; name: string } | null
  haveApproved: boolean
  showErpColumns: boolean
  ctx: MyApprovalContext
  /** True on the cross-project inbox, where the card must say which project it
   *  is. False inside a project workspace, whose header already says so — the
   *  card then starts at the first category band. */
  showProjectHeader: boolean
  /** "N waiting on you" vs "N pending", matching which list is on screen. */
  showAll: boolean
}

export function ApprovalProjectCard({
  projectId, items, enrich, approvedByDisc, approvedBySub, erpBudget, parent,
  haveApproved, showErpColumns, ctx, showProjectHeader, showAll,
}: ApprovalCardProps) {
  const proj = pickFirst(items[0].projects)
  const code = proj?.code ?? ''
  const tone = toneFor(code || projectId)
  const { byDisc, discOrder } = groupByDiscipline(items)

  const bands = (
    <div className={showProjectHeader ? 'p-3 md:p-4 space-y-4' : 'space-y-4'}>
      {discOrder.map(did => {
        const ditems = byDisc.get(did) ?? []
        const disc = pickFirst(ditems[0].cc_disciplines)
        const discBefore = approvedByDisc.get(`${projectId}::${did}`) ?? 0
        const discInc = ditems.reduce((s, r) => s + increment(r), 0)
        return (
          <div key={did}>
            <div className="flex items-baseline justify-between gap-2 mb-2 px-3 py-1.5 rounded-lg bg-gray-100/70 border border-gray-200">
              <span className="text-[11px] font-bold text-gray-700 uppercase tracking-wide truncate inline-flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-sm bg-gray-400 flex-shrink-0" />
                {[disc?.code, disc?.name].filter(Boolean).join(' ') || '—'}
              </span>
              {haveApproved && (
                <span className="text-[11px] text-gray-500 tabular-nums whitespace-nowrap normal-case">
                  approved <b className="text-gray-800">{formatINR(discBefore)}</b> → <b className="text-emerald-700">{formatINR(discBefore + discInc)}</b>
                </span>
              )}
            </div>
            <div className="space-y-2">
              {ditems.map(ws => {
                const sub = pickFirst(ws.cc_sub_skills)
                const ex = enrich.get(ws.id)
                const inc = increment(ws)
                const subBefore = approvedBySub.get(`${projectId}::${ws.discipline_id}::${ws.sub_skill_id}`) ?? 0
                const mineFlag = isWaitingOnMe(ws, ctx)
                const href = `/cost-control/working-sheets/${ws.id}?from=approvals`
                const d = daysWaiting(ws.submitted_at)
                const ver = Number(ws.version_no ?? 1)
                return (
                  <div key={ws.id} className="rounded-xl border border-gray-200 bg-white p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-gray-900">{[sub?.code, sub?.name].filter(Boolean).join(' ') || disc?.name || '—'}</span>
                          {ver > 1 && <span className="text-[10px] font-semibold rounded px-1.5 py-0.5 bg-gray-100 text-gray-600 border border-gray-200">Rev {ver}</span>}
                          {ex?.prev && <RevisionFlag prev={ex.prev} />}
                        </div>
                        <p className="text-[11px] font-mono text-gray-400 mt-0.5">{ws.ws_code}</p>
                        <StageChain status={ws.status} mine={mineFlag} />
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="font-bold text-gray-900 tabular-nums">{formatINR(ws.total_amount)}</div>
                        {d >= 3
                          ? <span className="inline-flex items-center rounded-full bg-rose-100 text-rose-800 border border-rose-200 text-[10px] font-bold px-2 py-0.5 mt-1">{d}d overdue</span>
                          : <span className="text-[11px] text-gray-400">{d === 0 ? 'today' : `${d}d`}</span>}
                      </div>
                    </div>

                    {haveApproved && (
                      <div className={`mt-2.5 rounded-lg border px-3 py-2 text-xs tabular-nums ${tone.ba}`}>
                        <p className="text-[10px] uppercase tracking-wide opacity-60 mb-1">Approved so far → after this</p>
                        <div className="flex justify-between gap-2">
                          <span className="opacity-80 truncate">{sub?.name ?? disc?.name ?? 'This line'}</span>
                          <span className="flex-shrink-0"><b>{formatINR(subBefore)}</b> → <b className="text-emerald-700">{formatINR(subBefore + inc)}</b></span>
                        </div>
                        <div className="flex justify-between gap-2 mt-1">
                          <span className="opacity-80 truncate">{disc?.name ?? 'Discipline'} <span className="opacity-60">(discipline)</span></span>
                          <span className="flex-shrink-0"><b>{formatINR(discBefore)}</b> → <b className="text-emerald-700">{formatINR(discBefore + inc)}</b></span>
                        </div>
                      </div>
                    )}

                    <div className="mt-2.5 flex items-center justify-between gap-2">
                      <a
                        href={`/api/cost-control/working-sheets/${ws.id}/download`}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-blue-700"
                      >
                        <Download className="h-3.5 w-3.5" /> Budget Excel
                      </a>
                      <Link
                        href={href}
                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold px-3.5 py-1.5"
                      >
                        {mineFlag ? 'Review & approve' : 'Review'} <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )

  // Inside a project workspace the header above already carries the name, code
  // and area, so repeating them here would be the same identity twice on one
  // screen. The bands stand on their own.
  if (!showProjectHeader) return bands

  return (
    <Card className={`p-0 overflow-hidden border-l-4 ${tone.rail}`}>
      <div className={`px-4 py-3 ${tone.head} border-b border-gray-100`}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2 min-w-0 flex-1">
            <span className={`inline-flex h-7 w-7 items-center justify-center rounded-lg text-sm flex-shrink-0 ${tone.avatar}`}>🏢</span>
            {/* Full names, never truncated — the parent is a small breadcrumb
                line and the project name shows in full below, wrapping if long. */}
            <div className="min-w-0">
              {parent && (
                <div className="text-[11px] text-gray-500 font-medium leading-tight break-words">
                  {parent.name} <span className="text-gray-300">›</span>
                </div>
              )}
              <div className="font-bold text-gray-900 text-[15px] leading-snug break-words">{proj?.name ?? '—'}</div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            <span className="inline-flex items-center rounded-full bg-amber-50 text-amber-800 border border-amber-200 text-[11px] font-semibold px-2.5 py-0.5 whitespace-nowrap">
              {items.length} {showAll ? 'pending' : 'waiting on you'}
            </span>
            {code && <span className={`font-mono text-[11px] rounded px-1.5 py-0.5 ${tone.code}`}>{code}</span>}
          </div>
        </div>
        {showErpColumns && erpBudget > 0 && (
          <div className="mt-2 flex items-baseline gap-x-2 flex-wrap tabular-nums">
            <span className="text-[10px] uppercase tracking-wide text-gray-400">Project budget (ERP)</span>
            <span className="text-base font-bold text-gray-900">{formatINR(erpBudget)}</span>
          </div>
        )}
      </div>
      {bands}
    </Card>
  )
}

// The compact "vs last revision" chip. Up = the ask grew (caution, amber);
// down = it shrank (good, emerald).
export function RevisionFlag({ prev }: { prev: NonNullable<WSEnrichment['prev']> }) {
  const dp = prev.deltaPct
  const up = (dp ?? 0) > 0
  const down = (dp ?? 0) < 0
  const tone = up ? 'bg-amber-50 text-amber-800' : down ? 'bg-emerald-50 text-emerald-800' : 'bg-gray-100 text-gray-600'
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded ${tone} px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap`}
      title={`Previous revision v${prev.ver}: ${formatINR(prev.total)}`}
    >
      {up && <ArrowUpRight className="h-3 w-3" />}
      {down && <ArrowDownRight className="h-3 w-3" />}
      {dp == null ? 'changed' : dp === 0 ? 'same' : `${dp > 0 ? '+' : ''}${dp}%`} vs v{prev.ver}
    </span>
  )
}

// The 3-step sign-off chain (Project Head → Atm Head → Trustee) with the
// current step highlighted — so the screen reads the same for every approver,
// each seeing where a budget sits and (when it's theirs) that it's on them.
export function StageChain({ status, mine }: { status: string; mine: boolean }) {
  const cur = status === 'submitted' ? 1 : status === 'ph_approved' ? 2 : 3
  const stages = [
    { n: 1, label: 'PH' },
    { n: 2, label: 'Atm' },
    { n: 3, label: 'Trustee' },
  ]
  return (
    <div className="mt-1.5 flex items-center gap-1 flex-wrap">
      <span className="text-[10px] text-gray-400">sign-off</span>
      {stages.map(s => {
        const done = s.n < cur
        const isCur = s.n === cur
        const cls = done ? 'bg-emerald-50 text-emerald-700' : isCur ? 'bg-blue-50 text-blue-700 font-bold' : 'bg-gray-100 text-gray-500'
        const text = done ? `${s.label} ✓` : isCur && mine ? `${s.label} · you` : s.label
        return <span key={s.n} className={`text-[10px] rounded px-1.5 py-0.5 ${cls}`}>{text}</span>
      })}
    </div>
  )
}
