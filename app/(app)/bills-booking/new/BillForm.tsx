'use client'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MoneyInput } from '@/components/ui/money-input'
import { Loader2, Send } from 'lucide-react'
import { OrderPicker, type OrderKind } from './OrderPicker'
import { DeskPanel } from './DeskPanel'
import type { PickableOrder } from '@/lib/bills-booking/orders'
import { resolveBooking, bookingGaps, type BookingMaps, type Booking } from '@/lib/bills-booking/booking'
import { formatINR } from '@/lib/utils'

type Opt = { id: string; code?: string; name: string }

/** Bill types that are drawn against an order — a work order or a purchase
 *  order. Advance is here because it is raised against one even though it has
 *  no measurement behind it; petty cash and misc never are, and asking for an
 *  order number on those is how you teach people to type something wrong to get
 *  past a field. */
const AGAINST_ORDER = new Set(['Running', 'Full & Final', 'Advance'])

/** What the server sends, as plain arrays — Maps do not survive the boundary
 *  between a server component and a client one. */
export interface BookingSeed {
  subprojects: Array<[number, string]>
  linked: Array<[number, { id: string; code: string | null; name: string }]>
  desks: Array<[number, { subproject_id: number; in4_name: string | null; cc_project_id: string | null; atm_head_id: string | null; note: string | null }]>
  projectHeads: Array<[string, Array<{ id: string; name: string }>]>
  people: Array<[string, { id: string; name: string }]>
  ctProjects: Array<[string, { id: string; code: string | null; name: string }]>
  skills: Array<[number, string]>
  disciplines: Array<[string, { id: string; name: string }]>
}

const hydrate = (s: BookingSeed): BookingMaps => ({
  subprojects: new Map(s.subprojects),
  linked: new Map(s.linked),
  desks: new Map(s.desks),
  projectHeads: new Map(s.projectHeads),
  people: new Map(s.people),
  ctProjects: new Map(s.ctProjects),
  skills: new Map(s.skills),
  disciplines: new Map(s.disciplines),
})

export function BillForm({ projects, disciplines, in4Wos, in4Pos, in4Projects, seed, canAdmin }: {
  projects: Opt[]; disciplines: Opt[]
  in4Wos: PickableOrder[]; in4Pos: PickableOrder[]
  in4Projects: Array<{ id: number; name: string }>
  seed: BookingSeed
  canAdmin: boolean
}) {
  const router = useRouter()
  const supabase = createClient()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const [billType, setBillType] = useState('Running')
  const [kind, setKind] = useState<OrderKind>('WO')
  const [order, setOrder] = useState<PickableOrder | null>(null)
  const [noOrder, setNoOrder] = useState(false)

  // Only used when there is no order to read any of this off.
  const [projectId, setProjectId] = useState('')
  const [disciplineId, setDisciplineId] = useState('')
  const [vendorText, setVendorText] = useState('')
  const [workManual, setWorkManual] = useState('')
  const [billNo, setBillNo] = useState('')
  const [billDate, setBillDate] = useState('')
  const [claimed, setClaimed] = useState('')
  const [orderNoManual, setOrderNoManual] = useState('')

  const [maps, setMaps] = useState<BookingMaps>(() => hydrate(seed))

  const projectNames = new Map(in4Projects.map(p => [p.id, p.name]))
  const needsOrder = AGAINST_ORDER.has(billType) && !noOrder
  const usingOrder = needsOrder && !!order
  const party = kind === 'WO' ? 'contractor' : 'supplier'

  // Where it books, worked out from the order rather than asked for.
  const booking: Booking = useMemo(() => resolveBooking(usingOrder ? order : null, maps), [usingOrder, order, maps])
  const gaps = bookingGaps(booking)

  // Everything below is what IN4 supplies once an order is chosen. It is not
  // asked for, and it is not editable: the point of reading IN4 is that nobody
  // retypes a figure the ERP already holds.
  const orderType = usingOrder ? order.kind : 'Without WO/PO'
  const orderNo = usingOrder ? order.orderNo : orderNoManual.trim()
  const contractor = usingOrder ? order.party : vendorText.trim()
  const trust = usingOrder ? (order.trust ?? '') : ''
  const woValue = usingOrder ? Math.round(order.orderedGross) : null
  const paidTill = usingOrder ? Math.round(order.billedGross) : 0

  // The CT Hub project is read off the order when there is one. The scope only
  // when IN4 holds one — a work order carries a description, a purchase order
  // has no such field, so on a PO it is asked rather than left blank.
  const finalProjectId = usingOrder ? booking.projectId : (projectId || null)
  const finalDisciplineId = usingOrder ? booking.disciplineId : (disciplineId || null)
  const finalDisciplineName = usingOrder
    ? (booking.disciplineName ?? booking.categoryIn4)
    : (disciplines.find(d => d.id === disciplineId)?.name ?? null)
  const work = booking.scope ?? (workManual.trim() || null)

  const thisBill = Number(claimed) || 0
  const overWO = usingOrder && woValue != null && woValue > 0 && paidTill + thisBill > woValue

  // The RA number is a count, not a decision — it only says which bill this is
  // on that work order. IN4 already knows how many have been raised, so it is
  // derived rather than asked for.
  //
  // Only work orders have one. A supplier's bills against a purchase order are
  // not a running account — IN4 numbers them as certificates, not RA-1, RA-2 —
  // so a PO bill carries no RA number rather than a made-up one. Without any
  // order there is no series to count at all.
  const raNo = usingOrder && order.kind === 'WO' ? 'RA-' + (order.bills + 1) : ''

  async function submit() {
    // A bill with no CT Hub project is still a bill that arrived. It is
    // recorded against its IN4 sub-project and shows on the desks screen as a
    // gap — it is never refused, because refusing it just means it is kept in
    // somebody's drawer instead.
    if (!usingOrder && !projectId) { setErr('Pick the CT Hub project this books against'); return }
    if (needsOrder && !order) {
      setErr(kind === 'WO'
        ? 'Find the work order, or tick "no work order yet"'
        : 'Find the purchase order, or tick "no purchase order yet"')
      return
    }
    if (!contractor) { setErr(`Name the ${party}`); return }
    if (!(thisBill > 0)) { setErr('Enter what this bill is for'); return }
    setBusy(true); setErr(null)
    const { data, error } = await supabase.rpc('bb_rpc_create_bill', {
      p: {
        order_type: orderType, bill_type: billType, bill_category: null,
        ct_other_dept: 'CT', order_no: orderNo, project_id: finalProjectId,
        vendor_id: null, vendor_text: contractor,
        discipline_id: finalDisciplineId,
        discipline: finalDisciplineName,
        work,
        bill_no: billNo.trim() || null, ra_no: raNo || null,
        bill_date: billDate || null, claimed_amount: thisBill, trust: trust || null,
        wo_value: woValue, paid_till_date: paidTill,
        in4_subproject_id: booking.subprojectId,
      },
    })
    if (error) { setBusy(false); setErr(error.message); return }
    const id = (data as { bill_id?: string })?.bill_id
    router.push(id ? `/bills-booking/${id}` : '/bills-booking')
  }

  const sel = 'h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm mt-1'

  return (
    <Card className="p-5 space-y-5">
      {err && <p role="alert" className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{err}</p>}

      {/* 1 — what kind of bill, because it decides whether the rest applies */}
      <Section n={1} title="What kind of bill is this?">
        <div className="flex flex-wrap gap-2">
          {['Running', 'Full & Final', 'Advance', 'Petty Cash', 'Misc'].map(t => (
            <button key={t} type="button" onClick={() => { setBillType(t); setOrder(null); setNoOrder(false) }}
                    className={`rounded-lg border px-3 py-2 text-sm font-semibold min-h-[44px] ${
                      billType === t ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}>
              {t}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-gray-500">
          {AGAINST_ORDER.has(billType)
            ? 'Drawn against a work order or a purchase order. Find it below and IN4 fills the rest.'
            : 'No order and no abstract — these go straight to Billing with a head of account.'}
        </p>
      </Section>

      {/* 2 — the order, found by typing. Everything about where the bill books
          follows from this one choice. */}
      {AGAINST_ORDER.has(billType) && (
        <Section n={2} title="Which order is this against?">
          {!noOrder && (
            <OrderPicker
              kind={kind}
              onKind={k => { setKind(k); setOrder(null) }}
              wos={in4Wos} pos={in4Pos}
              picked={order} onPick={setOrder} projectNames={projectNames}
            />
          )}

          {usingOrder && (
            <DeskPanel
              booking={booking} gaps={gaps} projects={projects} people={seed.people.map(([, p]) => p)}
              canAdmin={canAdmin}
              onSaved={desk => setMaps(m => ({ ...m, desks: new Map(m.desks).set(desk.subproject_id, desk) }))}
            />
          )}

          <label className="mt-3 flex items-start gap-2 text-sm">
            <input type="checkbox" checked={noOrder} className="mt-0.5 h-4 w-4"
                   onChange={e => { setNoOrder(e.target.checked); if (e.target.checked) setOrder(null) }} />
            <span>
              <b>No {kind === 'WO' ? 'work order' : 'purchase order'} yet</b>
              <span className="block text-xs text-gray-500">
                The bill came first and the {kind} is still to be raised. A third of bills arrive this way.
                It is recorded now, ages from its own bill date, and stops before the Atm desk until a number is attached.
              </span>
            </span>
          </label>

          {noOrder && (
            <div className="mt-3">
              <Label htmlFor="ono">Reference, if there is one</Label>
              <Input id="ono" value={orderNoManual} onChange={e => setOrderNoManual(e.target.value)} placeholder="optional" />
            </div>
          )}
        </Section>
      )}

      {/* 3 — only what IN4 cannot know */}
      <Section n={AGAINST_ORDER.has(billType) ? 3 : 2} title="The bill itself">
        {(!usingOrder) && (
          <div className="mb-3">
            <Label htmlFor="vent">Contractor / vendor *</Label>
            <Input id="vent" value={vendorText} onChange={e => setVendorText(e.target.value)} placeholder="e.g. Desai Construction" />
          </div>
        )}

        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label htmlFor="bno">Bill no</Label>
            <Input id="bno" value={billNo} onChange={e => setBillNo(e.target.value)} placeholder="from the invoice" />
          </div>
          <div>
            <Label htmlFor="bd">Bill date</Label>
            <Input id="bd" type="date" value={billDate} onChange={e => setBillDate(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="cl">This bill *</Label>
            <MoneyInput id="cl" value={claimed} onChange={setClaimed} placeholder="0" />
          </div>
        </div>

        {raNo && (
          <p className="mt-2 text-xs text-gray-500">
            This will be <b className="font-mono text-gray-800">{raNo}</b> on that work order
            {order!.bills > 0 ? ` — ${order!.bills} ${order!.bills === 1 ? 'bill has' : 'bills have'} been raised against it so far` : ' — the first bill against it'}.
          </p>
        )}
        {usingOrder && order.kind === 'PO' && order.bills > 0 && (
          <p className="mt-2 text-xs text-gray-500">
            {order.bills} {order.bills === 1 ? 'bill has' : 'bills have'} been raised against that purchase order so
            far, the last one <b className="font-mono text-gray-800">{order.lastBillNo ?? '—'}</b>.
          </p>
        )}

        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          {/* The scope is read off the order when IN4 holds one. A work order
              carries a description; a purchase order has no such field, so on a
              PO this is asked rather than left empty. */}
          {!booking.scope && (
            <div>
              <Label htmlFor="work">Work / scope</Label>
              <Input id="work" value={workManual} onChange={e => setWorkManual(e.target.value)}
                     placeholder={usingOrder ? 'e.g. Electrical cable and conduit supply' : 'e.g. Excavation and rock breaking'} />
            </div>
          )}
          {/* The CT Hub project and the category come off the order too. */}
          {!usingOrder && (
            <>
              <div>
                <Label htmlFor="proj">CT Hub project *</Label>
                <select id="proj" value={projectId} onChange={e => setProjectId(e.target.value)} className={sel}>
                  <option value="">— select —</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
                </select>
              </div>
              <div>
                <Label htmlFor="disc">Category</Label>
                <select id="disc" value={disciplineId} onChange={e => setDisciplineId(e.target.value)} className={sel}>
                  <option value="">— select —</option>
                  {disciplines.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
            </>
          )}
        </div>

        {/* The abstract number is NOT asked for here. Aksha, 14 Sep 2026: "why
            Abstract Number - that will come ahead in process na ???" — it is
            filled by the Site Head in IN4 after this bill exists, so at this
            moment there is nothing to type. It is recorded on the bill itself
            when it arrives. */}

        {overWO && (
          <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
            <b>This takes the work order past its value.</b> Billed so far {formatINR(paidTill)} plus this
            bill {formatINR(thisBill)} is {formatINR(paidTill + thisBill)} against {formatINR(woValue ?? 0)} ordered —
            over by <b>{formatINR(paidTill + thisBill - (woValue ?? 0))}</b>. An amendment in IN4 is needed before payment.
            It is flagged automatically; the bill still goes for checking.
          </div>
        )}
      </Section>

      <div>
        <Button onClick={submit} disabled={busy} className="bg-indigo-600 hover:bg-indigo-700">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Enter bill
        </Button>
        {/* It used to say "& send to Site Head", which it has never done: a new
            bill lands at Entered — the ERP desk, which is whoever typed it —
            and waits. Saying so is the fix. Forwarding on create would skip a
            step the flow is meant to have. */}
        <p className="mt-2 text-xs text-gray-500">
          It lands at <b>Entered</b>, your own desk, with the trail starting from this moment.
          Open it and forward to the Site Head once the measurement sheet is attached.
        </p>
      </div>
    </Card>
  )
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-900">
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-gray-900 text-[11px] font-bold text-white">{n}</span>
        {title}
      </h2>
      {children}
    </section>
  )
}
