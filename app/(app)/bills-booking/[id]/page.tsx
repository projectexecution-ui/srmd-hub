import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requirePermission, getMyPermissions, can } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { PIPELINE, stageDef, stageIndex, type BbStage } from '@/lib/bills-booking/stages'
import { StagePill } from '../StagePill'
import { MoveActions } from './MoveActions'
import { StatusTimeline } from './StatusTimeline'
import { Documents, type DocRow } from './Documents'
import { buildTimeline, type RawEvent } from '@/lib/bills-booking/timeline'
import { formatDateTime } from '@/lib/utils'

export const dynamic = 'force-dynamic'
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v)

type Ev = {
  id: string; from_stage: BbStage | null; to_stage: BbStage | null; action: string
  comment: string | null; amount_snapshot: number | null; created_at: string
  profiles: { full_name: string | null; email: string } | { full_name: string | null; email: string }[] | null
}

export default async function BillDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission('bills-booking', 'view')
  const canEdit = can(await getMyPermissions(), 'bills-booking', 'edit')
  const { id } = await params
  const supabase = await createClient()

  const [{ data: bill }, { data: events }, { data: docRows }] = await Promise.all([
    supabase.from('bb_bills')
      .select('*, projects(code, name), vendors(name)')
      .eq('id', id).maybeSingle(),
    supabase.from('bb_bill_events')
      .select('id, from_stage, to_stage, action, comment, amount_snapshot, created_at, profiles(full_name, email)')
      .eq('bill_id', id).order('created_at', { ascending: false }),
    supabase.from('bb_bill_docs').select('id, path, name, kind').eq('bill_id', id).order('created_at'),
  ])
  if (!bill) notFound()

  const project = one(bill.projects as { code: string; name: string } | null)
  const vendor = one(bill.vendors as { name: string } | null)?.name || bill.vendor_text || '—'
  const curIdx = stageIndex(bill.current_stage as BbStage)
  const evs = (events ?? []) as Ev[]

  // Who currently holds this bill (resolved desk owner).
  let ownerName: string | null = null
  const { data: ownerId } = await supabase.rpc('bb_desk_owner', {
    p_stage: bill.current_stage, p_project: bill.project_id, p_discipline: bill.discipline,
  })
  if (ownerId) {
    const { data: op } = await supabase.from('profiles').select('full_name, email').eq('id', ownerId as string).maybeSingle()
    ownerName = op?.full_name || op?.email || null
  }

  // Timeline (events ascending) + who moved each.
  const asc: RawEvent[] = [...evs].reverse().map(e => {
    const w = one(e.profiles)
    return { from_stage: e.from_stage, to_stage: e.to_stage, created_at: e.created_at, actor: w?.full_name || w?.email || null }
  })
  const segs = buildTimeline(asc, bill.current_stage as BbStage, Date.now())

  // Documents + signed URLs.
  const paths = (docRows ?? []).map(d => d.path as string)
  const urlMap = new Map<string, string>()
  if (paths.length) {
    const { data: signed } = await supabase.storage.from('bills-booking').createSignedUrls(paths, 3600)
    for (const s of signed ?? []) if (s.path && s.signedUrl) urlMap.set(s.path, s.signedUrl)
  }
  const docs: DocRow[] = (docRows ?? []).map(d => ({
    id: d.id as string, name: d.name as string | null, kind: d.kind as string | null,
    url: urlMap.get(d.path as string) ?? null,
    ext: (String(d.path).split('.').pop() || '').toLowerCase(),
  }))

  const money = (n: number | null | undefined) => (n == null ? '—' : '₹' + Number(n).toLocaleString('en-IN'))

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-5">
      <PageHeader title={vendor} back="/bills-booking"
        subtitle={`${project?.code ?? ''} · ${bill.order_type} ${bill.order_no ?? ''}${bill.discipline ? ' · ' + bill.discipline : ''}`}>
        <StagePill stage={bill.current_stage as BbStage} />
      </PageHeader>

      {/* WO status banners */}
      {bill.wo_pending && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <b>No WO/PO issued</b> — this bill is to be <b>regularised</b>; a work order needs to be raised.
        </div>
      )}
      {bill.amendment_flag && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <b>WO budget short — IN4 amendment needed.</b> Paid-so-far + this bill exceeds the {bill.order_type} value; raise the amendment in IN4 before payment.
        </div>
      )}

      {/* Facts */}
      <Card className="p-4">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
          <Fact k="Bill type" v={bill.bill_type || '—'} />
          <Fact k="Category" v={bill.bill_category || '—'} />
          <Fact k="Dept" v={bill.ct_other_dept || '—'} />
          <Fact k="Work" v={bill.work || '—'} />
          <Fact k="Bill no" v={bill.bill_no || '—'} />
          <Fact k="RA no" v={bill.ra_no || '—'} />
          <Fact k={`${bill.order_type} value`} v={money(bill.wo_value)} />
          <Fact k="Paid till date" v={money(bill.paid_till_date)} />
          <Fact k="This bill" v={money(bill.claimed_amount)} />
          <Fact k="Certified" v={money(bill.certified_amount)} />
          <Fact k="Net payable" v={money(bill.net_amount)} strong={bill.net_amount != null} />
          <Fact k="Abstract no (IN4)" v={bill.abstract_no_in4 || '—'} />
          <Fact k="Trust" v={bill.trust || '—'} />
          <Fact k="Bill date" v={bill.bill_date || '—'} />
          <Fact k="Project" v={project ? `${project.code} — ${project.name}` : '—'} />
        </div>
      </Card>

      {/* Stage ladder */}
      <Card className="p-4">
        <p className="mb-3 text-xs font-bold uppercase tracking-wide text-gray-400">Flow</p>
        <div className="flex items-start gap-0 overflow-x-auto pb-1">
          {PIPELINE.map((s, i) => {
            const done = i < curIdx, cur = i === curIdx
            return (
              <div key={s.key} className="relative min-w-[84px] shrink-0 text-center">
                {i > 0 && <div className={`absolute left-[-50%] top-3 -z-0 h-[3px] w-full ${done || cur ? 'bg-indigo-500' : 'bg-gray-200'}`} />}
                <div className={`relative z-10 mx-auto flex h-7 w-7 items-center justify-center rounded-full border-2 text-[12px] font-extrabold ${
                  done ? 'border-indigo-500 bg-indigo-500 text-white'
                    : cur ? 'border-indigo-600 bg-white text-indigo-700 ring-4 ring-indigo-500/20'
                      : 'border-gray-200 bg-white text-gray-300'}`}>
                  {done ? '✓' : i + 1}
                </div>
                <div className={`mt-1.5 text-[10.5px] font-semibold leading-tight ${cur ? 'text-indigo-700' : 'text-gray-500'}`}>{s.label}</div>
              </div>
            )
          })}
        </div>
      </Card>

      {/* Time at each desk (SLA) */}
      <StatusTimeline segs={segs} />

      {/* Documents */}
      <Documents billId={bill.id as string} docs={docs} canEdit={canEdit} />

      {/* Current owner */}
      <p className="px-1 text-sm text-gray-500">
        {ownerName
          ? <>With <span className="font-semibold text-gray-800">{ownerName}</span> at the {stageDef(bill.current_stage as BbStage).label} desk.</>
          : <>No owner set for the {stageDef(bill.current_stage as BbStage).label} desk — anyone with access can move it. <span className="text-gray-400">Assign it in Desks settings.</span></>}
      </p>

      {/* Move actions */}
      {canEdit && <MoveActions billId={bill.id as string} stage={bill.current_stage as BbStage} netAmount={bill.net_amount as number | null} claimed={bill.claimed_amount as number} />}

      {/* Audit trail */}
      <Card className="p-4">
        <p className="mb-3 text-xs font-bold uppercase tracking-wide text-gray-400">History</p>
        <ol className="space-y-3">
          {evs.map(e => {
            const who = one(e.profiles)
            return (
              <li key={e.id} className="flex gap-3 text-sm">
                <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-indigo-400" />
                <div className="min-w-0">
                  <p className="text-gray-800">
                    <b>{e.action === 'send_back' ? 'Sent back' : e.action === 'hold' ? 'Put on hold' : e.action === 'reject' ? 'Rejected' : 'Moved'}</b>
                    {e.from_stage && <> from <span className="font-medium">{stageDef(e.from_stage).label}</span></>}
                    {e.to_stage && <> → <span className="font-medium">{stageDef(e.to_stage).label}</span></>}
                    {e.amount_snapshot != null && <> · {money(e.amount_snapshot)}</>}
                  </p>
                  {e.comment && <p className="mt-0.5 text-[13px] text-gray-600">“{e.comment}”</p>}
                  <p className="mt-0.5 text-[11px] text-gray-400">{who?.full_name || who?.email || 'Someone'} · {formatDateTime(e.created_at)}</p>
                </div>
              </li>
            )
          })}
        </ol>
      </Card>
    </div>
  )
}

function Fact({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{k}</p>
      <p className={`mt-0.5 ${strong ? 'text-base font-bold text-gray-900' : 'text-gray-800'}`}>{v}</p>
    </div>
  )
}
