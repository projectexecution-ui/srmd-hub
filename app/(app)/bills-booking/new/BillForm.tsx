'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MoneyInput } from '@/components/ui/money-input'
import { Loader2, Send } from 'lucide-react'
import { WoPicker } from './WoPicker'
import type { PickableWo } from '@/lib/bills-booking/wo-picker'
import { formatINR } from '@/lib/utils'

type Opt = { id: string; code?: string; name: string }

/** Bill types that are drawn against a work order. Advance is here because it
 *  is raised against one even though it has no measurement behind it; petty
 *  cash and misc never are, and asking for a WO on those is how you teach
 *  people to type something wrong to get past a field. */
const AGAINST_WO = new Set(['Running', 'Full & Final', 'Advance'])

export function BillForm({ projects, disciplines, in4Wos, in4Projects }: {
  projects: Opt[]; disciplines: Opt[]
  in4Wos: PickableWo[]; in4Projects: Array<{ id: number; name: string }>
}) {
  const router = useRouter()
  const supabase = createClient()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const [billType, setBillType] = useState('Running')
  const [wo, setWo] = useState<PickableWo | null>(null)
  const [noOrder, setNoOrder] = useState(false)

  const [projectId, setProjectId] = useState('')
  const [disciplineId, setDisciplineId] = useState('')
  const [vendorText, setVendorText] = useState('')
  const [work, setWork] = useState('')
  const [billNo, setBillNo] = useState('')
  const [raNo, setRaNo] = useState('')
  const [billDate, setBillDate] = useState('')
  const [claimed, setClaimed] = useState('')
  const [abstractNo, setAbstractNo] = useState('')
  const [orderNoManual, setOrderNoManual] = useState('')

  const projectNames = new Map(in4Projects.map(p => [p.id, p.name]))
  const needsWo = AGAINST_WO.has(billType) && !noOrder
  const usingWo = needsWo && !!wo

  // Everything below is what IN4 supplies once a work order is chosen. It is
  // not asked for, and it is not editable: the point of reading IN4 is that
  // nobody retypes a figure the ERP already holds.
  const orderType = noOrder || !AGAINST_WO.has(billType) ? 'Without WO/PO' : 'WO'
  const orderNo = usingWo ? wo.woNo : orderNoManual.trim()
  const contractor = usingWo ? wo.contractor : vendorText.trim()
  const trust = usingWo ? (wo.trust ?? '') : ''
  const woValue = usingWo ? Math.round(wo.orderedGross) : null
  const paidTill = usingWo ? Math.round(wo.billedGross) : 0

  const thisBill = Number(claimed) || 0
  const overWO = usingWo && woValue != null && woValue > 0 && paidTill + thisBill > woValue

  function pickWo(w: PickableWo | null) {
    setWo(w)
    if (!w) return
    if (!raNo && w.bills > 0) setRaNo('RA-' + (w.bills + 1))
  }

  async function submit() {
    if (!projectId) { setErr('Pick the CT Hub project this books against'); return }
    if (needsWo && !wo) { setErr('Find the work order, or tick “no work order yet”'); return }
    if (!contractor) { setErr('Name the contractor or vendor'); return }
    if (!(thisBill > 0)) { setErr('Enter what this bill is for'); return }
    setBusy(true); setErr(null)
    const { data, error } = await supabase.rpc('bb_rpc_create_bill', {
      p: {
        order_type: orderType, bill_type: billType, bill_category: null,
        ct_other_dept: 'CT', order_no: orderNo, project_id: projectId,
        vendor_id: null, vendor_text: contractor,
        discipline_id: disciplineId || null,
        discipline: disciplines.find(d => d.id === disciplineId)?.name || null,
        work: work.trim() || null,
        bill_no: billNo.trim() || null, ra_no: raNo.trim() || null,
        bill_date: billDate || null, claimed_amount: thisBill, trust: trust || null,
        wo_value: woValue, paid_till_date: paidTill,
        abstract_no_in4: abstractNo.trim() || null,
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
            <button key={t} type="button" onClick={() => { setBillType(t); setWo(null); setNoOrder(false) }}
                    className={`rounded-lg border px-3 py-2 text-sm font-semibold min-h-[44px] ${
                      billType === t ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}>
              {t}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-gray-500">
          {AGAINST_WO.has(billType)
            ? 'Drawn against a work order. Find it below and IN4 fills the rest.'
            : 'No work order and no abstract — these go straight to Billing with a head of account.'}
        </p>
      </Section>

      {/* 2 — the work order, found by typing */}
      {AGAINST_WO.has(billType) && (
        <Section n={2} title="Which work order?">
          {!noOrder && <WoPicker wos={in4Wos} picked={wo} onPick={pickWo} projectNames={projectNames} />}

          <label className="mt-3 flex items-start gap-2 text-sm">
            <input type="checkbox" checked={noOrder} className="mt-0.5 h-4 w-4"
                   onChange={e => { setNoOrder(e.target.checked); if (e.target.checked) setWo(null) }} />
            <span>
              <b>No work order yet</b>
              <span className="block text-xs text-gray-500">
                The bill came first and the WO is still to be raised. A third of bills arrive this way.
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
      <Section n={AGAINST_WO.has(billType) ? 3 : 2} title="The bill itself">
        {(!usingWo) && (
          <div className="mb-3">
            <Label htmlFor="vent">Contractor / vendor *</Label>
            <Input id="vent" value={vendorText} onChange={e => setVendorText(e.target.value)} placeholder="e.g. Desai Construction" />
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
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
          <div>
            <Label htmlFor="ra">RA no</Label>
            <Input id="ra" value={raNo} onChange={e => setRaNo(e.target.value)}
                   placeholder={usingWo && wo.bills > 0 ? 'suggested' : 'RA-1'} />
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <Label htmlFor="work">Work / scope</Label>
            <Input id="work" value={work} onChange={e => setWork(e.target.value)} placeholder="e.g. Excavation and rock breaking" />
          </div>
          <div>
            <Label htmlFor="abs">Abstract no (IN4)</Label>
            <Input id="abs" value={abstractNo} onChange={e => setAbstractNo(e.target.value)} placeholder="if one exists already" />
          </div>
        </div>

        {overWO && (
          <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
            <b>This takes the work order past its value.</b> Billed so far {formatINR(paidTill)} plus this
            bill {formatINR(thisBill)} is {formatINR(paidTill + thisBill)} against {formatINR(woValue ?? 0)} ordered —
            over by <b>{formatINR(paidTill + thisBill - (woValue ?? 0))}</b>. An amendment in IN4 is needed before payment.
            It is flagged automatically; the bill still goes for checking.
          </div>
        )}
      </Section>

      {/* 4 — where it books in CT Hub */}
      <Section n={AGAINST_WO.has(billType) ? 4 : 3} title="Where it books">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <Label htmlFor="proj">CT Hub project *</Label>
            <select id="proj" value={projectId} onChange={e => setProjectId(e.target.value)} className={sel}>
              <option value="">— select —</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
            </select>
            {usingWo && wo.projectId != null && (
              <p className="mt-1 text-[11px] text-gray-500">
                IN4 has this work order under <b>{projectNames.get(wo.projectId) ?? '—'}</b>.
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="disc">Category (Internal Estimate)</Label>
            <select id="disc" value={disciplineId} onChange={e => setDisciplineId(e.target.value)} className={sel}>
              <option value="">— select —</option>
              {disciplines.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        </div>
      </Section>

      <Button onClick={submit} disabled={busy} className="bg-indigo-600 hover:bg-indigo-700">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        Enter bill &amp; send to Site Head
      </Button>
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
