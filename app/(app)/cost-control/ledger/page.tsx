// S7 — Sub-skill ledger (passbook). Management-only. One chronological trail
// for a (project · discipline · sub-skill) budget: every version's raise →
// submit → PH/Atm check → approve → release-to-ERP tranche(s) → IN4 entry,
// with a running released balance. Gated on cc_cumulative_versions.

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { checkIsCcReviewer } from '@/components/cost-control/ws-actions'
import { getCcSettings } from '@/lib/cost-control/settings'
import { PageHeader } from '@/components/PageHeader'
import { formatINR } from '@/lib/utils'
import { CheckCircle2, FileText, IndianRupee, ClipboardCheck, Send, Landmark } from 'lucide-react'

export const dynamic = 'force-dynamic'

interface LedgerEvent {
  at: string
  kind: 'raised' | 'submitted' | 'ph' | 'atm' | 'approved' | 'released' | 'in4'
  version: number
  wsId: string
  wsCode: string
  label: string
  amount: number | null       // signed release amount (for the running balance)
  ref?: string | null
}

const KIND_META: Record<LedgerEvent['kind'], { icon: typeof Send; tone: string }> = {
  raised:    { icon: FileText,       tone: 'text-gray-500' },
  submitted: { icon: Send,          tone: 'text-blue-600' },
  ph:        { icon: ClipboardCheck, tone: 'text-indigo-600' },
  atm:       { icon: ClipboardCheck, tone: 'text-violet-600' },
  approved:  { icon: CheckCircle2,   tone: 'text-emerald-600' },
  released:  { icon: IndianRupee,    tone: 'text-emerald-700' },
  in4:       { icon: Landmark,       tone: 'text-amber-700' },
}

export default async function SubSkillLedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; discipline?: string; sub_skill?: string }>
}) {
  await requirePermission('cost-control', 'view')
  const sp = await searchParams
  const ccSettings = await getCcSettings()

  // Management-only + behind the flag (like the rest of the cumulative feature).
  if (!ccSettings.cumulative_versions || !(await checkIsCcReviewer())) {
    redirect('/cost-control')
  }
  if (!sp.project || !sp.discipline || !sp.sub_skill) {
    redirect('/cost-control')
  }

  const supabase = await createClient()

  const [{ data: proj }, { data: disc }, { data: sub }] = await Promise.all([
    supabase.from('projects').select('code, name').eq('id', sp.project).maybeSingle(),
    supabase.from('cc_disciplines').select('code, name').eq('id', sp.discipline).maybeSingle(),
    supabase.from('cc_sub_skills').select('code, name').eq('id', sp.sub_skill).maybeSingle(),
  ])

  const { data: versions } = await supabase
    .from('cc_ws_with_versions')
    .select('id, ws_code, version_no, status, total_amount, approved_for_erp_amt, created_at, submitted_at, ph_checked_at, ph_checked_amt, atm_checked_at, atm_checked_amt, approved_at, approved_for_erp_at, in4_entered_at, in4_ref, summary_notes')
    .eq('project_id', sp.project)
    .eq('discipline_id', sp.discipline)
    .eq('sub_skill_id', sp.sub_skill)
    .order('version_no')

  const real = (versions ?? []).filter(v => !(v.summary_notes ?? '').startsWith('[IB'))

  // Release tranches (finer-grained than approved_for_erp_amt): a WS can be
  // released to ERP in stages. Prefer these for the running balance if present.
  const wsIds = real.map(v => v.id)
  const { data: releaseEvents } = wsIds.length
    ? await supabase
        .from('cc_budget_events')
        .select('related_ws_id, delta_amount, event_type, event_date')
        .in('related_ws_id', wsIds)
        .eq('event_type', 'release')
        .order('event_date')
    : { data: [] as unknown[] }

  const releasesByWs = new Map<string, Array<{ amount: number; at: string }>>()
  for (const e of (releaseEvents ?? []) as Array<{ related_ws_id: string; delta_amount: number; event_date: string }>) {
    const arr = releasesByWs.get(e.related_ws_id) ?? []
    arr.push({ amount: Number(e.delta_amount) || 0, at: e.event_date })
    releasesByWs.set(e.related_ws_id, arr)
  }

  const events: LedgerEvent[] = []
  const push = (v: typeof real[number], kind: LedgerEvent['kind'], at: string | null, label: string, amount: number | null = null, ref: string | null = null) => {
    if (!at) return
    events.push({ at, kind, version: v.version_no, wsId: v.id, wsCode: v.ws_code, label, amount, ref })
  }
  for (const v of real) {
    push(v, 'raised', v.created_at, 'Raised (draft)')
    push(v, 'submitted', v.submitted_at, 'Submitted for approval')
    push(v, 'ph', v.ph_checked_at, `Project Head checked${v.ph_checked_amt != null ? ` · ${formatINR(Number(v.ph_checked_amt))}` : ''}`)
    push(v, 'atm', v.atm_checked_at, `Atm Head checked${v.atm_checked_amt != null ? ` · ${formatINR(Number(v.atm_checked_amt))}` : ''}`)
    push(v, 'approved', v.approved_at, 'Approved by Trustee')
    const tranches = releasesByWs.get(v.id)
    if (tranches && tranches.length) {
      tranches.forEach((t, i) => push(v, 'released', t.at, `Released to ERP${tranches.length > 1 ? ` (tranche ${i + 1})` : ''}`, t.amount))
    } else if (v.approved_for_erp_at && Number(v.approved_for_erp_amt) > 0) {
      push(v, 'released', v.approved_for_erp_at, 'Released to ERP', Number(v.approved_for_erp_amt))
    }
    push(v, 'in4', v.in4_entered_at, 'Entered in IN4', null, v.in4_ref)
  }
  events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))

  // Running released balance.
  let running = 0
  const rows = events.map(e => {
    if (e.kind === 'released' && e.amount) running += e.amount
    return { ...e, balance: running }
  })
  const totalReleased = running
  const latestApproved = [...real].reverse().find(v => ['approved', 'partially_approved', 'wo_issued', 'paid'].includes(v.status))
  const approvedTotal = latestApproved ? Number(latestApproved.total_amount) || 0 : 0

  const title = [sub?.code, sub?.name].filter(Boolean).join(' ') || 'Sub-skill'

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
      <PageHeader
        title={`Ledger — ${title}`}
        subtitle={`${proj?.code ?? ''} ${proj?.name ?? ''} · ${disc?.code ?? ''} ${disc?.name ?? ''}`.trim()}
        back={`/cost-control/projects/${sp.project}`}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-1px rounded-xl border border-gray-200 overflow-hidden bg-gray-200 shadow-sm" style={{ gap: 1 }}>
        <div className="bg-white p-4"><p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">Versions</p><p className="text-xl font-bold text-gray-900">{real.length}</p></div>
        <div className="bg-white p-4"><p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">Latest approved</p><p className="text-xl font-bold text-emerald-700 tabular-nums">{formatINR(approvedTotal)}</p></div>
        <div className="bg-white p-4"><p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">Released to ERP</p><p className="text-xl font-bold text-gray-900 tabular-nums">{formatINR(totalReleased)}</p></div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
        <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 text-xs font-bold uppercase tracking-wide text-gray-600">Passbook — every step in time</div>
        {rows.length === 0 ? (
          <p className="p-6 text-sm text-gray-500">No activity yet for this sub-skill.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {rows.map((e, i) => {
              const M = KIND_META[e.kind]
              const Icon = M.icon
              return (
                <li key={i} className="flex items-center gap-3 px-4 py-2.5">
                  <Icon className={`h-4 w-4 flex-shrink-0 ${M.tone}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-900">
                      {e.label}
                      {e.ref && <span className="ml-1.5 text-xs font-mono text-amber-700">{e.ref}</span>}
                    </p>
                    <p className="text-[11px] text-gray-400">
                      {new Date(e.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}
                      {' · '}
                      <Link href={`/cost-control/working-sheets/${e.wsId}`} className="text-blue-600 hover:underline">v{e.version} · {e.wsCode}</Link>
                    </p>
                  </div>
                  {e.amount != null && (
                    <span className="text-sm font-semibold tabular-nums text-emerald-700">+{formatINR(e.amount)}</span>
                  )}
                  {e.kind === 'released' && (
                    <span className="text-[11px] tabular-nums text-gray-400 w-24 text-right">bal {formatINR(e.balance)}</span>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
