import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getMyPermissions, can } from '@/lib/auth'
import { requireBillsAccess } from '@/lib/bills-booking/access'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { PIPELINE, stageDef, stageIndex, type BbStage } from '@/lib/bills-booking/stages'
import { StagePill } from '../StagePill'
import { MoveActions } from './MoveActions'
import { StatusTimeline } from './StatusTimeline'
import { Documents, type DocRow } from './Documents'
import { AbstractNo } from './AbstractNo'
import { Calculation } from './Calculation'
import { loadBillCalc, loadMakerSeed } from '@/lib/bills-booking/load-calc'
import { AbstractMaker } from './AbstractMaker'
import { linesFromSheet } from '@/lib/bills-booking/maker'
import { buildTimeline, type RawEvent } from '@/lib/bills-booking/timeline'
import { formatDate, formatDateTime, formatINR } from '@/lib/utils'

export const dynamic = 'force-dynamic'
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v)

type Ev = {
  id: string; from_stage: BbStage | null; to_stage: BbStage | null; action: string
  comment: string | null; amount_snapshot: number | null; created_at: string
  profiles: { full_name: string | null; email: string } | { full_name: string | null; email: string }[] | null
}

export default async function BillDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireBillsAccess()
  const canEdit = can(await getMyPermissions(), 'bills-booking', 'edit')
  const { id } = await params
  const supabase = await createClient()

  const [{ data: bill }, { data: events }, { data: docRows }] = await Promise.all([
    supabase.from('bb_bills')
      .select('*, projects(code, name)')
      .eq('id', id).maybeSingle(),
    supabase.from('bb_bill_events')
      .select('id, from_stage, to_stage, action, comment, amount_snapshot, created_at, profiles(full_name, email)')
      .eq('bill_id', id).order('created_at', { ascending: false }),
    supabase.from('bb_bill_docs').select('id, path, name, kind').eq('bill_id', id).order('created_at'),
  ])
  if (!bill) notFound()

  const project = one(bill.projects as { code: string; name: string } | null)
  const vendor = (bill.vendor_text as string | null) || '—'
  const curIdx = stageIndex(bill.current_stage as BbStage)
  const evs = (events ?? []) as Ev[]

  // The IN4 sub-project this bill came from, named. It is the only thing tying
  // a bill to a building when CT Hub has no project for it.
  let subprojectName: string | null = null
  if (bill.in4_subproject_id != null) {
    const { data: sp } = await supabase.from('in4_subprojects')
      .select('name').eq('id', bill.in4_subproject_id).maybeSingle()
    const { data: desk } = await supabase.from('bb_project_desks')
      .select('short_name, in4_name').eq('subproject_id', bill.in4_subproject_id).maybeSingle()
    subprojectName = (desk?.short_name as string | null)
      || (sp?.name as string | null)
      || (desk?.in4_name as string | null)
  }

  // Who currently holds this bill (all members of the current desk). The
  // sub-project is passed too, so a bill on a Bills Approval project reaches
  // that project's own desks rather than falling back to the global default.
  let ownerNames: string[] = []
  const { data: memberIds } = await supabase.rpc('bb_stage_members', {
    p_stage: bill.current_stage, p_project: bill.project_id, p_disc: bill.discipline,
    p_subproject: bill.in4_subproject_id,
  })
  const ids = (memberIds ?? []) as string[]
  if (ids.length) {
    const { data: mp } = await supabase.from('profiles').select('id, full_name, email').in('id', ids)
    ownerNames = (mp ?? []).map(p => (p.full_name || p.email) as string).filter(Boolean)
  }

  // Timeline (events ascending) + who moved each.
  const asc: RawEvent[] = [...evs].reverse().map(e => {
    const w = one(e.profiles)
    return { from_stage: e.from_stage, to_stage: e.to_stage, created_at: e.created_at, actor: w?.full_name || w?.email || null }
  })
  // The clock lives inside buildTimeline, which defaults it. Reading Date.now()
  // here is exactly what the lint rule had been failing on since this page was
  // written — a component must not be the thing that asks what time it is.
  const segs = buildTimeline(asc, bill.current_stage as BbStage)

  // The live IN4 position behind this bill: how it adds up, and every bill
  // already raised on the same work order. Null when the bill names no order —
  // petty cash and misc have nothing to read.
  const calc = await loadBillCalc(supabase, {
    orderType: bill.order_type as string | null,
    orderNo: bill.order_no as string | null,
    billNo: bill.bill_no as string | null,
    raNo: bill.ra_no as string | null,
    claimed: Number(bill.claimed_amount ?? 0),
    abstractNo: bill.abstract_no_in4 as string | null,
  }).catch(() => null)

  // The Abstract maker — the sheet filled HERE rather than in IN4. Offered
  // while the bill is still ours to change; once it is with the Trust or paid,
  // the measurement is history and the sheet is read-only.
  //
  // Work orders only. An abstract measures a BOQ line by line; a purchase order
  // has no BOQ — it is received by GRN and billed against what arrived — so
  // there is nothing to measure and no sheet to fill.
  const openStages = ['submitted', 'site_head', 'disc_head', 'ct_head']
  const maker = bill.order_no && bill.order_type === 'WO'
    ? await loadMakerSeed(supabase, { billId: bill.id as string, woNo: bill.order_no as string }).catch(() => null)
    : null

  // ONE abstract format, whoever measured it.
  //
  // Aksha, 15 Sep 2026: "why is the Abstract sheet is coming like this and
  // not like the screenshot". Because IN4's read-back had its own plainer
  // table — no Work Order / This bill / Cumulative / Balance grouping and no
  // Sub Total → GST → Retention → Net Payable ladder. Two renderings of one
  // document, which is the same mistake as two panels for one document.
  //
  // So IN4's measured quantities are fed through the SAME component now, read
  // only. The arithmetic is shared, the numbers are IN4's.
  const in4Seed = calc?.sheet ? linesFromSheet(calc.sheet.rows) : null
  const fromIn4 = !!in4Seed && !maker?.ownSheet
  const in4Note = calc?.sheet
    ? [calc.sheet.abstractNo, calc.sheet.on ? formatDate(calc.sheet.on) : null,
       calc.sheet.certified == null ? 'not yet certified' : 'certified in IN4']
        .filter(Boolean).join(' · ')
    : null

  // Has IN4 approved the measurement behind this bill? One function, shared
  // with the sweep that does the moving, so the screen and the job can never
  // disagree about whether a bill is ready.
  let measured: boolean | null = null
  if (bill.order_no) {
    const { data: ref } = await supabase.rpc('bb_measurement_ref', {
      p_order_type: bill.order_type, p_order_no: bill.order_no, p_bill_no: bill.bill_no,
    })
    measured = !!ref
  }

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

  // formatINR, like everywhere else: no stray paise, and an em dash rather
  // than "₹NaN" when the figure is not set yet.
  const money = formatINR

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-5">
      <PageHeader title={vendor} back="/bills-booking"
        subtitle={`${project?.code ?? ''} · ${bill.order_type} ${bill.order_no ?? ''}${bill.discipline ? ' · ' + bill.discipline : ''}`}>
        <StagePill stage={bill.current_stage as BbStage} />
      </PageHeader>

      {bill.is_example && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <b>This is an example bill.</b> Seeded to walk the flow on — real IN4 work order, real arithmetic, but no real
          money. It is left out of every total, and goes with the rest from <b>Bills desks</b>.
        </div>
      )}

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
          <Fact k="Category" v={(bill.discipline as string | null) || (bill.bill_category as string | null) || '—'} />
          <Fact k="Dept" v={bill.ct_other_dept || '—'} />
          <Fact k="Work" v={bill.work || '—'} />
          <Fact k="Bill no" v={bill.bill_no || '—'} />
          <Fact k="RA no" v={bill.ra_no || '—'} />
          <Fact k={`${bill.order_type} value`} v={money(bill.wo_value)} />
          <Fact k="Paid till date" v={money(bill.paid_till_date)} />
          <Fact k="This bill" v={money(bill.claimed_amount)} />
          <Fact k="Certified" v={money(bill.certified_amount)} />
          <Fact k="Net payable" v={money(bill.net_amount)} strong={bill.net_amount != null} />
          {canEdit
            ? <AbstractNo billId={bill.id as string} value={(bill.abstract_no_in4 as string | null) ?? null} stage={bill.current_stage as BbStage} />
            : <Fact k="Abstract no (IN4)" v={(bill.abstract_no_in4 as string | null) || '—'} />}
          <Fact k="Trust" v={bill.trust || '—'} />
          <Fact k="Bill date" v={bill.bill_date ? formatDate(bill.bill_date as string) : '—'} />
          {/* A bill can have no CT Hub project — 32 of the 54 IN4 sub-projects
              that carry work orders have none. Saying "—" and stopping hid the
              building we do know, which is the one on the work order. */}
          <Fact k="Project" v={project ? `${project.code} — ${project.name}` : (subprojectName ?? 'not in CT Hub')} />
          {!project && subprojectName && <Fact k="Books under" v="Bills Approval project" />}
        </div>
      </Card>

      {/* ONE abstract sheet, never two — Aksha, 15 Sep 2026: "why u are
          showing 2 Abstracts - i am getting confused". Whoever measured it
          owns the panel:
            CT Hub has lines            → the maker, editable
            else IN4 already has one    → IN4's, read-only (below)
            else                        → the maker, blank, to fill */}
      {maker && (
        <AbstractMaker
          billId={bill.id as string}
          woNo={bill.order_no as string}
          vendor={vendor}
          work={bill.work as string | null}
          seed={fromIn4 && in4Seed ? in4Seed : maker.lines}
          gst={bill.gst_pct != null ? { ...maker.gst, pct: bill.gst_pct as number } : maker.gst}
          retention={bill.retention_pct != null ? { ...maker.retention, pct: bill.retention_pct as number } : maker.retention}
          canEdit={!fromIn4 && canEdit && openStages.includes(bill.current_stage as string)}
          raLabel={(bill.ra_no as string | null) ?? 'RA'}
          ownSheet={maker.ownSheet}
          in4Total={calc?.sheet?.thisBill ?? null}
          source={fromIn4 ? 'in4' : 'ct'}
          sourceNote={fromIn4 ? in4Note : null}
        />
      )}

      {calc && <Calculation calc={calc} />}

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

      {/* Current desk members */}
      <p className="px-1 text-sm text-gray-500">
        {ownerNames.length
          ? <>With <span className="font-semibold text-gray-800">{ownerNames.join(', ')}</span> at the {stageDef(bill.current_stage as BbStage).label} desk.</>
          : <>No one is assigned to the {stageDef(bill.current_stage as BbStage).label} desk — anyone with access can move it. <span className="text-gray-400">Assign it in Desks.</span></>}
      </p>

      {/* Move actions */}
      {canEdit && <MoveActions billId={bill.id as string} stage={bill.current_stage as BbStage}
        netAmount={bill.net_amount as number | null} claimed={bill.claimed_amount as number}
        preHoldStage={(bill.pre_hold_stage as BbStage | null) ?? null}
        measured={measured} orderType={bill.order_type as string | null} />}

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
                    <b>{e.action === 'send_back' ? 'Sent back' : e.action === 'hold' ? 'Put on hold' : e.action === 'reject' ? 'Rejected' : e.action === 'abstract' ? 'Abstract' : 'Moved'}</b>
                    {/* An event that did not move the bill — recording the
                        abstract number, say — would otherwise read "from CT
                        Head → CT Head", which is noise in a trail people are
                        meant to skim. */}
                    {e.from_stage && e.from_stage !== e.to_stage && <> from <span className="font-medium">{stageDef(e.from_stage).label}</span></>}
                    {e.to_stage && e.to_stage !== e.from_stage && <> → <span className="font-medium">{stageDef(e.to_stage).label}</span></>}
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
