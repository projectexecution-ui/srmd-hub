import { notFound } from 'next/navigation'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { requireBillsAccess } from '@/lib/bills-booking/access'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { RefreshCw } from 'lucide-react'
import { PIPELINE, stageDef, stageIndex, type BbStage } from '@/lib/bills-booking/stages'
import { StagePill } from '../StagePill'
import { ActionBar } from './ActionBar'
import { StatusTimeline } from './StatusTimeline'
import { Documents, type DocRow, type RequiredDoc } from './Documents'
import { PhoneSummary, type PhoneLine } from './PhoneSummary'
import { MeasurementPicker } from './MeasurementPicker'
import { Calculation } from './Calculation'
import { loadBillCalc, loadMakerSeed, loadPoRates, loadMeasurementOptions } from '@/lib/bills-booking/load-calc'
import { AbstractMaker } from './AbstractMaker'
import { linesFromSheet, type Deduction } from '@/lib/bills-booking/maker'
import { linesFromGrn } from '@/lib/bills-booking/purchase'
import { buildTimeline, type RawEvent } from '@/lib/bills-booking/timeline'
import { formatDate, formatDateTime, formatINR } from '@/lib/utils'

export const dynamic = 'force-dynamic'
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v)

type Ev = {
  id: string; from_stage: BbStage | null; to_stage: BbStage | null; action: string
  comment: string | null; amount_snapshot: number | null; created_at: string; actor_id: string | null
  profiles: { full_name: string | null; email: string } | { full_name: string | null; email: string }[] | null
}

/** One bill, as the person approving it needs it.
 *
 *  Aksha, 16 Sep 2026, screens B and F of the look-and-feel preview: "Build
 *  it". What changed and why, in the order it is on the page:
 *
 *  · A bill that raised itself from IN4 says so at the top. Nothing was typed.
 *  · The documents card names what the flow expects — the stamped bill — and
 *    whether it is here, before anyone finds out from a refused button.
 *  · The flow names who held it, for how long, with the send-back reason
 *    where it happened.
 *  · The decision is pinned to the foot of the screen (ActionBar), with the
 *    one figure being approved, and stays there while the sheet scrolls.
 *  · On a phone the sheet gives way to a summary that leads with net payable;
 *    the full sheet is one tap away. */
export default async function BillDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireBillsAccess()
  const { id } = await params
  const supabase = await createClient()
  const navCollapsed = (await cookies()).get('srmd_nav_collapsed')?.value === '1'

  const [{ data: bill }, { data: events }, { data: docRows }] = await Promise.all([
    supabase.from('bb_bills')
      .select('*, projects(code, name)')
      .eq('id', id).maybeSingle(),
    supabase.from('bb_bill_events')
      .select('id, from_stage, to_stage, action, comment, amount_snapshot, created_at, actor_id, profiles(full_name, email)')
      .eq('bill_id', id).order('created_at', { ascending: false }),
    supabase.from('bb_bill_docs').select('id, path, name, kind, uploaded_by, created_at').eq('bill_id', id).order('created_at'),
  ])
  if (!bill) notFound()

  const project = one(bill.projects as { code: string; name: string } | null)
  const vendor = (bill.vendor_text as string | null) || '—'
  const stage = bill.current_stage as BbStage
  const curIdx = stageIndex(stage)
  const evs = (events ?? []) as Ev[]
  const autoRaised = bill.created_by == null

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

  // Who holds it now — every member of the current desk, resolved WITH the
  // sub-project, the same call the move gate and the notifier make.
  const { data: memberIds } = await supabase.rpc('bb_stage_members', {
    p_stage: stage, p_project: bill.project_id, p_disc: bill.discipline, p_subproject: bill.in4_subproject_id,
    p_bill: bill.id,
  })
  const ids = (memberIds ?? []) as string[]
  let ownerNames: string[] = []
  if (ids.length) {
    const { data: mp } = await supabase.from('profiles').select('id, full_name, email').in('id', ids)
    ownerNames = (mp ?? []).map(p => (p.full_name || p.email) as string).filter(Boolean)
  }
  const meOnDesk = !!me.userId && ids.includes(me.userId)
  // Who may act: the desk, or the matrix's editors and admins. The database
  // decides the same way; this only decides what to draw.
  const canAct = meOnDesk || me.isAdmin || me.canEdit
  const canAttach = canAct

  // The Site Head named at entry, and IN4's approved measurements to pick
  // from (10 Oct 2026: picked from IN4's own list, never typed).
  let ownerName: string | null = null
  if (bill.owner_id) {
    const { data: op } = await supabase.from('profiles').select('full_name, email').eq('id', bill.owner_id as string).maybeSingle()
    ownerName = ((op?.full_name || op?.email) as string | undefined) ?? null
  }
  const pickStage = stage === 'site_head' || stage === 'disc_head'
  const measureOptions = pickStage && (bill.order_type === 'WO' || bill.order_type === 'PO')
    ? await loadMeasurementOptions(supabase, bill.order_type as string, bill.order_no as string | null).catch(() => [])
    : []
  const hasMeasurement = !!bill.abstract_no_in4 || bill.in4_grn_id != null
  const measureCurrent = bill.order_type === 'PO'
    ? (bill.in4_grn_id != null ? String(bill.in4_grn_id) : null)
    : ((bill.abstract_no_in4 as string | null) ?? null)

  // Timeline (events ascending) + who moved each, and what they said.
  const asc: RawEvent[] = [...evs].reverse().map(e => {
    const w = one(e.profiles)
    return {
      from_stage: e.from_stage, to_stage: e.to_stage, created_at: e.created_at,
      actor: w?.full_name || w?.email || null, action: e.action, comment: e.comment,
      amount: e.amount_snapshot,
    }
  })
  const segs = buildTimeline(asc, stage)
  // Events that changed the bill without moving it. The flow card covers every
  // event that DID move it, so listing those again is the duplication that
  // made this page unreadable.
  const edits = evs.filter(e => e.to_stage === e.from_stage || e.action === 'abstract')

  // The way home: the last thing done was a send-back or a reject, by this
  // person, inside ten minutes. The database enforces the same three
  // conditions — this only decides whether to draw the button.
  const lastEv = evs[0]
  const undoWhat = lastEv && lastEv.actor_id === me.userId
    && (lastEv.action === 'send_back' || lastEv.action === 'reject')
    ? (lastEv.action as 'send_back' | 'reject') : null
  const undoUntil = undoWhat && lastEv
    ? new Date(new Date(lastEv.created_at).getTime() + 10 * 60_000).toISOString()
    : null

  const calc = await loadBillCalc(supabase, {
    orderType: bill.order_type as string | null,
    orderNo: bill.order_no as string | null,
    billNo: bill.bill_no as string | null,
    raNo: bill.ra_no as string | null,
    claimed: Number(bill.claimed_amount ?? 0),
    abstractNo: bill.abstract_no_in4 as string | null,
    grnId: (bill.in4_grn_id as number | null) ?? null,
  }).catch(() => null)

  const maker = bill.order_no && bill.order_type === 'WO'
    ? await loadMakerSeed(supabase, { billId: bill.id as string, woNo: bill.order_no as string }).catch(() => null)
    : null
  const in4Seed = calc?.sheet ? linesFromSheet(calc.sheet.rows) : null
  // The measurement is IN4's (10 Oct 2026): a picked abstract always wins over
  // lines typed here; lines typed here are only shown when nothing was picked.
  const fromIn4 = !!in4Seed && (hasMeasurement || !maker?.ownSheet)
  // A purchase order's goods receipt feeds the SAME sheet (Aksha, 9 Oct 2026:
  // "dont make new formats"): lines at PO rates, the same totals ladder, the
  // deductions block at the Disc Head and CT Head desks.
  const poSeed = bill.order_type === 'PO' && calc?.grn ? linesFromGrn(calc.grn.rows, calc.grn.orderedTaxPct) : null
  const poRates = poSeed ? await loadPoRates(supabase, bill.order_no as string).catch(() => null) : null
  const grnNote = calc?.grn
    ? [...calc.grn.grns.map(g => [g.no, g.on ? formatDate(g.on) : null, g.challan ? `challan ${g.challan}` : null].filter(Boolean).join(' · ')),
       calc.grn.billed ? 'certified in IN4' : 'no supplier certificate yet'].filter(Boolean).join(' · ')
    : null
  const in4Note = calc?.sheet
    ? [calc.sheet.abstractNo, calc.sheet.on ? formatDate(calc.sheet.on) : null,
       calc.sheet.certified == null ? 'not yet certified' : 'certified in IN4']
        .filter(Boolean).join(' · ')
    : null

  let measured: boolean | null = null
  if (bill.order_no) {
    const { data: ref } = await supabase.rpc('bb_measurement_ref', {
      p_order_type: bill.order_type, p_order_no: bill.order_no, p_bill_no: bill.bill_no,
    })
    measured = !!ref
  }

  // Documents + signed URLs + who attached them.
  const paths = (docRows ?? []).map(d => d.path as string)
  const urlMap = new Map<string, string>()
  if (paths.length) {
    const { data: signed } = await supabase.storage.from('bills-booking').createSignedUrls(paths, 3600)
    for (const s of signed ?? []) if (s.path && s.signedUrl) urlMap.set(s.path, s.signedUrl)
  }
  const uploaderIds = [...new Set((docRows ?? []).map(d => d.uploaded_by as string | null).filter((v): v is string => !!v))]
  const uploaderName = new Map<string, string>()
  if (uploaderIds.length) {
    const { data: up } = await supabase.from('profiles').select('id, full_name, email').in('id', uploaderIds)
    for (const p of up ?? []) uploaderName.set(p.id as string, (p.full_name || p.email) as string)
  }
  const docs: DocRow[] = (docRows ?? []).map(d => ({
    id: d.id as string, name: d.name as string | null, kind: d.kind as string | null,
    url: urlMap.get(d.path as string) ?? null,
    ext: (String(d.path).split('.').pop() || '').toLowerCase(),
    uploadedBy: d.uploaded_by ? uploaderName.get(d.uploaded_by as string) ?? null : null,
    on: d.created_at ? formatDate(d.created_at as string) : null,
  }))
  const hasStampedBill = docs.some(d => d.kind === 'bill' || d.kind === 'stamped_bill')
  const required: RequiredDoc[] = [
    { kinds: ['bill', 'stamped_bill'], label: 'Stamped bill', note: 'Needed before the Disc Head can forward' },
    ...(bill.order_type === 'WO'
      ? [{ kinds: ['abstract'], label: 'Abstract', note: 'Made in IN4 by the Site Head', satisfiedBy: calc?.sheet ? 'read from IN4' : null } as RequiredDoc]
      : [{ kinds: ['support'], label: 'Goods receipt', note: 'Raised in IN4 at the gate', satisfiedBy: calc?.grn ? 'read from IN4' : null } as RequiredDoc]),
  ]

  const money = formatINR
  const mineRa = calc?.mineCert
    ? calc.history.rows.find(r => r.certificateId === calc.mineCert!.certificateId)?.ra
    : undefined
  const raLabel = mineRa ? `RA-${mineRa}` : ((bill.ra_no as string | null) ?? 'RA')

  // ── the phone's summary ──
  const claimed = Number(bill.claimed_amount ?? 0)
  const net = (bill.net_amount as number | null) ?? null
  const certified = (bill.certified_amount as number | null) ?? null
  const figure = net ?? certified ?? (calc?.sheet?.thisBill ?? claimed)
  const figureLabel = net != null ? 'Net payable' : certified != null ? 'Certified' : 'Claimed'
  const woValue = calc?.orderedGross ?? (bill.wo_value as number | null) ?? null
  const thisGross = calc?.mineCert?.gross ?? 0
  const billedBefore = calc ? Math.max(0, calc.history.billedGross - thisGross) : (bill.paid_till_date as number | null) ?? null
  const leftAfter = woValue != null && billedBefore != null ? woValue - billedBefore - claimed : null
  const overrun = (calc?.sheet?.rows ?? []).filter(r => r.overrun).map(r => ({ item: r.item, cum: r.cumulativeQty, ordered: r.orderedQty, uom: r.uom }))
  const phoneLines: PhoneLine[] = calc?.sheet
    ? calc.sheet.rows.slice(0, 4).map(r => ({ item: r.item, qty: r.thisQty, uom: r.uom, amt: r.thisAmt }))
    : (calc?.grn?.rows ?? []).slice(0, 4).map(r => ({ item: r.material, qty: r.thisQty ?? r.receiptQty ?? 0, uom: r.uom, amt: r.thisAmt }))
  const lineCount = calc?.sheet?.rows.length ?? calc?.grn?.rows.length ?? 0
  const flowLine = segs.length
    ? segs.map(s => `${stageDef(s.stage).label} ${s.current ? (meOnDesk ? '· you' : '· here') : `${Math.round(s.days)}d${s.leftAction === 'send_back' ? ' · sent back' : ''}`}`).join(' → ')
    : null

  // At Entered there is nothing to measure yet: the sheet appears once the
  // bill is with the Site Head (Aksha, 10 Oct 2026).
  const sheetPanels = stage === 'submitted' || (stage === 'site_head' && !hasMeasurement) ? (
    <Card className="p-4 text-sm text-gray-600">
      {stage === 'submitted'
        ? 'The abstract or goods receipt sheet appears once the bill is with the Site Head, who makes it in IN4 and picks it here.'
        : `Make the ${bill.order_type === 'PO' ? 'goods receipt' : 'abstract'} in IN4 and get it approved there, then pick it in the facts above. The sheet reads back from IN4 — nothing is measured in CT Hub.`}
    </Card>
  ) : (
    <>
      {maker && (
        <AbstractMaker
          billId={bill.id as string}
          woNo={bill.order_no as string}
          vendor={vendor}
          work={bill.work as string | null}
          seed={fromIn4 && in4Seed ? in4Seed : maker.lines}
          gst={bill.gst_pct != null ? { ...maker.gst, pct: bill.gst_pct as number } : maker.gst}
          retention={bill.retention_pct != null ? { ...maker.retention, pct: bill.retention_pct as number } : maker.retention}
          canEdit={false}
          canEditDeductions={canAct && (stage === 'disc_head' || stage === 'ct_head')}
          retentionAmt={(bill.retention_amt as number | null) ?? null}
          deductions={Array.isArray(bill.deductions) ? (bill.deductions as Deduction[]) : []}
          in4Net={calc?.mine?.netPayable ?? null}
          raLabel={raLabel}
          ownSheet={maker.ownSheet}
          in4Total={calc?.sheet?.thisBill ?? null}
          source={fromIn4 ? 'in4' : 'ct'}
          earlierBills={fromIn4 ? calc?.sheet?.earlierBills ?? [] : []}
          sourceNote={fromIn4 ? in4Note : null}
        />
      )}
      {poSeed && calc?.grn && poRates && (
        <AbstractMaker
          billId={bill.id as string}
          woNo={bill.order_no as string}
          kind="PO"
          vendor={vendor}
          work={bill.work as string | null}
          seed={poSeed}
          gst={bill.gst_pct != null ? { ...poRates.gst, pct: bill.gst_pct as number } : poRates.gst}
          retention={bill.retention_pct != null ? { ...poRates.retention, pct: bill.retention_pct as number } : poRates.retention}
          canEdit={false}
          canEditDeductions={canAct && (stage === 'disc_head' || stage === 'ct_head')}
          retentionAmt={(bill.retention_amt as number | null) ?? null}
          deductions={Array.isArray(bill.deductions) ? (bill.deductions as Deduction[]) : []}
          in4Net={calc.grn.billed ? (calc.mine?.netPayable ?? null) : null}
          invoiceTotal={calc.grn.billed ? null : claimed}
          in4ReceiptValue={calc.grn.thisBill}
          raLabel={raLabel}
          ownSheet={false}
          in4Total={null}
          source="in4"
          earlierBills={calc.grn.earlierBills}
          sourceNote={grnNote}
        />
      )}
      {calc && <Calculation calc={calc} />}
    </>
  )

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      <PageHeader title={vendor} back="/bills-booking"
        subtitle={`${project?.code ?? subprojectName ?? ''} · ${bill.order_type} ${bill.order_no ?? ''}${bill.discipline ? ' · ' + bill.discipline : ''}`}>
        <StagePill stage={stage} />
      </PageHeader>

      {autoRaised && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <RefreshCw className="h-4 w-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <b>Raised automatically from IN4.</b>{' '}
            {bill.abstract_no_in4 ? <>Abstract <span className="font-mono text-[12px]">{bill.abstract_no_in4 as string}</span> was approved in IN4</> : <>IN4 approved the measurement</>}
            {' '}— the bill, the party, the order, the claim and the measurement all came from there. Nothing was typed.
          </div>
        </div>
      )}

      {bill.is_example && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <b>This is an example bill.</b> Seeded to walk the flow on — real IN4 work order, real arithmetic, but no real
          money. It is left out of every total, and goes with the rest from <b>Desks</b>.
        </div>
      )}
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

      {bill.verdict && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${bill.verdict === 'matched' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
          <b>{bill.verdict === 'matched' ? 'IN4 approval matches CT Hub.' : 'IN4 approval differs from CT Hub.'}</b>{' '}
          IN4 payable {formatINR(Number(bill.in4_payable ?? 0))} · CT Hub net {formatINR(Number(bill.sanctioned_net ?? bill.net_amount ?? 0))}
          {bill.in4_approved_by ? ` · approved in IN4 by ${bill.in4_approved_by}` : ''}{bill.in4_approved_at ? ` on ${formatDate(bill.in4_approved_at as string)}` : ''}.
        </div>
      )}

      {/* The phone leads with the figure. */}
      <PhoneSummary
        figure={figure} figureLabel={figureLabel} claimed={claimed}
        retention={calc?.mineCert?.retention ?? null} retentionPct={(bill.retention_pct as number | null) ?? null}
        billedBefore={billedBefore} woValue={woValue} leftAfter={leftAfter}
        reconciles={calc?.sheet?.reconciles ?? calc?.grn?.reconciles ?? null}
        overrun={overrun}
        docs={required.map(r => {
          const d = docs.find(x => x.kind && r.kinds.includes(x.kind))
          return { label: r.label, ok: !!d || !!r.satisfiedBy, note: d ? `${d.uploadedBy ?? ''}${d.on ? `, ${d.on}` : ''}`.replace(/^, /, '') || null : r.satisfiedBy ?? r.note }
        })}
        flow={flowLine} lines={phoneLines} lineCount={lineCount} sheetHref="#sheet"
      />

      {/* Facts */}
      <Card className="p-4">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
          <Fact k="Bill no" v={bill.bill_no || '—'} />
          <Fact k="RA no" v={raLabel} />
          <Fact k="Bill type" v={bill.bill_type || '—'} />
          <Fact k="Category" v={(bill.discipline as string | null) || (bill.bill_category as string | null) || '—'} />
          <Fact k="Work" v={bill.work || '—'} />
          <Fact k={`${bill.order_type} value`} v={money(bill.wo_value)} />
          <Fact k="Paid till date" v={money(bill.paid_till_date)} />
          <Fact k="This bill" v={money(bill.claimed_amount)} />
          <Fact k="Certified" v={money(bill.certified_amount)} />
          <Fact k="Net payable" v={money(bill.net_amount)} strong={bill.net_amount != null} />
          <Fact k="Site Head (owner)" v={ownerName ?? '—'} />
          {pickStage && (bill.order_type === 'WO' || bill.order_type === 'PO')
            ? <MeasurementPicker billId={bill.id as string} kind={bill.order_type as 'WO' | 'PO'} options={measureOptions}
                                 current={measureCurrent} canPick={canAct} billNo={(bill.bill_no as string | null) ?? null} />
            : <Fact k={bill.order_type === 'PO' ? 'Goods receipt (IN4)' : 'Abstract no (IN4)'} v={(bill.abstract_no_in4 as string | null) || '—'} />}
          <Fact k="Trust" v={bill.trust || '—'} />
          <Fact k="Bill date" v={bill.bill_date ? formatDate(bill.bill_date as string) : '—'} />
          <Fact k="Project" v={project ? `${project.code} — ${project.name}` : (subprojectName ?? 'not in CT Hub')} />
          {!project && subprojectName && <Fact k="Books under" v="Bills Approval project" />}
        </div>
      </Card>

      {/* Documents — with what the flow asks for. */}
      <Documents billId={bill.id as string} docs={docs} canAttach={canAttach} required={required} />

      {/* The sheets and the money. On a laptop, in full; on a phone, folded
          behind the summary above and opened from its "full sheet" link. */}
      <div className="hidden space-y-5 md:block">{sheetPanels}</div>
      <details id="sheet" className="group md:hidden">
        <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-800">
          Full sheet and IN4 money
          <span className="text-[11px] font-normal text-gray-400 group-open:hidden">open</span>
          <span className="hidden text-[11px] font-normal text-gray-400 group-open:inline">close</span>
        </summary>
        <div className="mt-3 space-y-5">{sheetPanels}</div>
      </details>

      {/* Stage ladder */}
      <Card className="p-4">
        <p className="mb-3 text-xs font-bold uppercase tracking-wide text-gray-400">Stages</p>
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
                {/* What happened at the two money steps, under their dots:
                    the CT Head's sanction, and the Atm Head's approval in IN4
                    with its verdict (Aksha, 10 Oct 2026). */}
                {s.key === 'ct_head' && bill.sanctioned_net != null && (
                  <div className="mt-0.5 text-[10px] text-gray-500">approved {formatINR(Number(bill.sanctioned_net))}</div>
                )}
                {s.key === 'atm_in4' && (bill.in4_approved_at
                  ? <div className={`mt-0.5 text-[10px] font-semibold ${bill.verdict === 'matched' ? 'text-emerald-700' : 'text-amber-700'}`}>
                      approved {formatDate(bill.in4_approved_at as string)} · {bill.verdict === 'matched' ? 'matches' : 'differs'}
                    </div>
                  : cur ? <div className="mt-0.5 text-[10px] text-amber-700">waiting in IN4</div> : null)}
              </div>
            )
          })}
        </div>
      </Card>

      {/* Who held it, for how long, and what they said */}
      <StatusTimeline segs={segs} holders={ownerNames} meOnDesk={meOnDesk} />

      {!canAct && (
        <p className="px-1 text-sm text-gray-500">
          {ownerNames.length
            ? <>With <span className="font-semibold text-gray-800">{ownerNames.join(', ')}</span> at the {stageDef(stage).label} desk.</>
            : <>No one is assigned to the {stageDef(stage).label} desk. <span className="text-gray-400">An admin can assign it in Desks.</span></>}
        </p>
      )}

      {/* Edits that changed the bill without moving it — recording the
          abstract number, say. They are not part of the flow, and there are
          usually none, so this is a line rather than a second trail.
          The flow itself (who held it, what they said) is the card above;
          printing the same six events twice is what made this page unreadable
          (Aksha, 17 Sep 2026: "why showing so much info - its looking like
          garbage"). */}
      {edits.length > 0 && (
        <Card className="p-4">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-400">Edits</p>
          <ul className="space-y-1.5 text-[13px]">
            {edits.map(e => {
              const who = one(e.profiles)
              return (
                <li key={e.id} className="flex flex-wrap items-baseline gap-x-2">
                  <b className="text-gray-900">{e.action === 'abstract' ? 'Abstract number' : e.action}</b>
                  {e.comment && <span className="text-gray-600">{e.comment}</span>}
                  <span className="ml-auto text-[11px] text-gray-400">
                    {who?.full_name || who?.email || 'Someone'} · {formatDateTime(e.created_at)}
                  </span>
                </li>
              )
            })}
          </ul>
        </Card>
      )}

      {canAct && (
        <ActionBar billId={bill.id as string} stage={stage}
          netAmount={net} certified={certified} claimed={claimed}
          preHoldStage={(bill.pre_hold_stage as BbStage | null) ?? null}
          measured={measured} orderType={bill.order_type as string | null}
          hasStampedBill={hasStampedBill} hasMeasurement={hasMeasurement} navCollapsed={navCollapsed}
          undoUntil={undoUntil} undoWhat={undoWhat}
          reconciles={calc?.sheet?.reconciles ?? calc?.grn?.reconciles ?? null} />
      )}
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
