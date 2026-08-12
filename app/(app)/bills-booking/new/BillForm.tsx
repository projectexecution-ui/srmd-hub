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

type Opt = { id: string; code?: string; name: string }

export function BillForm({ projects, vendors }: { projects: Opt[]; vendors: Opt[] }) {
  const router = useRouter()
  const supabase = createClient()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const [orderType, setOrderType] = useState<'WO' | 'PO' | 'Without WO/PO'>('WO')
  const [billType, setBillType] = useState('Running')
  const [billCategory, setBillCategory] = useState('')
  const [ctDept, setCtDept] = useState('CT')
  const [orderNo, setOrderNo] = useState('')
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '')
  const [vendorId, setVendorId] = useState('')
  const [vendorText, setVendorText] = useState('')
  const [discipline, setDiscipline] = useState('')
  const [work, setWork] = useState('')
  const [billNo, setBillNo] = useState('')
  const [raNo, setRaNo] = useState('')
  const [billDate, setBillDate] = useState('')
  const [claimed, setClaimed] = useState('')
  const [woValue, setWoValue] = useState('')
  const [paidTill, setPaidTill] = useState('')
  const [abstractNo, setAbstractNo] = useState('')
  const [trust, setTrust] = useState('')

  const noWO = orderType === 'Without WO/PO'
  const woNum = Number(woValue) || 0
  const overWO = !noWO && woNum > 0 && (Number(paidTill) || 0) + (Number(claimed) || 0) > woNum

  async function submit() {
    if (!projectId) { setErr('Pick a project'); return }
    if (!vendorId && !vendorText.trim()) { setErr('Pick a vendor or type the contractor name'); return }
    setBusy(true); setErr(null)
    const { data, error } = await supabase.rpc('bb_rpc_create_bill', {
      p: {
        order_type: orderType, bill_type: billType, bill_category: billCategory.trim() || null,
        ct_other_dept: ctDept || null, order_no: orderNo.trim(), project_id: projectId,
        vendor_id: vendorId || null, vendor_text: vendorText.trim() || null,
        discipline: discipline || null, work: work.trim() || null,
        bill_no: billNo.trim() || null, ra_no: raNo.trim() || null,
        bill_date: billDate || null, claimed_amount: Number(claimed) || 0, trust: trust.trim() || null,
        wo_value: noWO ? null : (Number(woValue) || null), paid_till_date: Number(paidTill) || 0,
        abstract_no_in4: abstractNo.trim() || null,
      },
    })
    if (error) { setBusy(false); setErr(error.message); return }
    const id = (data as { bill_id?: string })?.bill_id
    router.push(id ? `/bills-booking/${id}` : '/bills-booking')
  }

  const sel = 'h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm'

  return (
    <Card className="p-5 space-y-4">
      {err && <p role="alert" className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{err}</p>}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="otype">Order type</Label>
          <select id="otype" value={orderType} onChange={e => setOrderType(e.target.value as typeof orderType)} className={sel}>
            <option value="WO">WO (contractor)</option>
            <option value="PO">PO (vendor)</option>
            <option value="Without WO/PO">Without WO/PO</option>
          </select>
        </div>
        <div>
          <Label htmlFor="ono">{noWO ? 'Reference (optional)' : `${orderType} number`}</Label>
          <Input id="ono" value={orderNo} onChange={e => setOrderNo(e.target.value)} placeholder={noWO ? '—' : 'WO/SRASSK/…'} disabled={noWO} />
        </div>
      </div>

      {noWO && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <b>No WO/PO issued.</b> This bill is flagged to be <b>regularised</b> — a work order will need to be raised. It still flows for checking.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <div>
          <Label htmlFor="btype">Bill type</Label>
          <select id="btype" value={billType} onChange={e => setBillType(e.target.value)} className={sel}>
            {['Running', 'Advance', 'Full & Final', 'Petty Cash', 'Misc'].map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="cat">Bill category</Label>
          <Input id="cat" value={billCategory} onChange={e => setBillCategory(e.target.value)} placeholder="e.g. RA / Labour" />
        </div>
        <div>
          <Label htmlFor="dept">CT / Other dept</Label>
          <select id="dept" value={ctDept} onChange={e => setCtDept(e.target.value)} className={sel}>
            <option value="CT">CT</option>
            <option value="Other">Other</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="proj">Project *</Label>
          <select id="proj" value={projectId} onChange={e => setProjectId(e.target.value)} className={sel}>
            {projects.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="disc">Discipline</Label>
          <select id="disc" value={discipline} onChange={e => setDiscipline(e.target.value)} className={sel}>
            <option value="">—</option>
            <option value="Civil">Civil</option>
            <option value="MEP">MEP</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="ven">Vendor / contractor</Label>
          <select id="ven" value={vendorId} onChange={e => setVendorId(e.target.value)} className={sel}>
            <option value="">— pick or type below —</option>
            {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="vent">…or type the name</Label>
          <Input id="vent" value={vendorText} onChange={e => setVendorText(e.target.value)} placeholder="e.g. Desai Construction" disabled={!!vendorId} />
        </div>
      </div>

      <div>
        <Label htmlFor="work">Work / scope</Label>
        <Input id="work" value={work} onChange={e => setWork(e.target.value)} placeholder="e.g. Excavation and rock breaking works" />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div>
          <Label htmlFor="bno">Bill no</Label>
          <Input id="bno" value={billNo} onChange={e => setBillNo(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="ra">RA no</Label>
          <Input id="ra" value={raNo} onChange={e => setRaNo(e.target.value)} placeholder="MS-04" />
        </div>
        <div>
          <Label htmlFor="bd">Bill date</Label>
          <Input id="bd" type="date" value={billDate} onChange={e => setBillDate(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="tr">Trust</Label>
          <Input id="tr" value={trust} onChange={e => setTrust(e.target.value)} placeholder="SRA / SRET" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {!noWO && (
          <div>
            <Label htmlFor="wov">{orderType} value</Label>
            <MoneyInput id="wov" value={woValue} onChange={setWoValue} placeholder="0" />
          </div>
        )}
        <div>
          <Label htmlFor="ptd">Paid till date</Label>
          <MoneyInput id="ptd" value={paidTill} onChange={setPaidTill} placeholder="0" />
        </div>
        <div>
          <Label htmlFor="cl">This bill amount *</Label>
          <MoneyInput id="cl" value={claimed} onChange={setClaimed} placeholder="0" />
        </div>
        <div>
          <Label htmlFor="abs">Abstract no (IN4)</Label>
          <Input id="abs" value={abstractNo} onChange={e => setAbstractNo(e.target.value)} />
        </div>
      </div>

      {overWO && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          <b>WO budget short.</b> Paid-so-far + this bill ({(((Number(paidTill) || 0) + (Number(claimed) || 0))).toLocaleString('en-IN')}) exceeds the {orderType} value ({woNum.toLocaleString('en-IN')}) by <b>₹{(((Number(paidTill) || 0) + (Number(claimed) || 0)) - woNum).toLocaleString('en-IN')}</b> — an <b>amendment in IN4</b> will be needed before payment. It&apos;s flagged automatically.
        </div>
      )}

      <Button onClick={submit} disabled={busy} className="bg-indigo-600 hover:bg-indigo-700">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        Enter bill &amp; send to Site Head
      </Button>
    </Card>
  )
}
