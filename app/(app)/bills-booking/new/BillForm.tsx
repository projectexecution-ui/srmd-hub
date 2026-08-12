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

  const [orderType, setOrderType] = useState<'WO' | 'PO'>('WO')
  const [billType, setBillType] = useState('Running')
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
  const [trust, setTrust] = useState('')

  async function submit() {
    if (!projectId) { setErr('Pick a project'); return }
    if (!vendorId && !vendorText.trim()) { setErr('Pick a vendor or type the contractor name'); return }
    setBusy(true); setErr(null)
    const { data, error } = await supabase.rpc('bb_rpc_create_bill', {
      p: {
        order_type: orderType, bill_type: billType, order_no: orderNo.trim(), project_id: projectId,
        vendor_id: vendorId || null, vendor_text: vendorText.trim() || null,
        discipline: discipline || null, work: work.trim() || null,
        bill_no: billNo.trim() || null, ra_no: raNo.trim() || null,
        bill_date: billDate || null, claimed_amount: Number(claimed) || 0, trust: trust.trim() || null,
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
          <Label>Type</Label>
          <div className="mt-1 inline-flex overflow-hidden rounded-lg border border-gray-300">
            {(['WO', 'PO'] as const).map(t => (
              <button key={t} type="button" onClick={() => setOrderType(t)}
                className={`px-4 py-2 text-sm font-bold ${orderType === t ? 'bg-indigo-600 text-white' : 'bg-white text-gray-500'}`}>
                {t === 'WO' ? 'WO (contractor)' : 'PO (vendor)'}
              </button>
            ))}
          </div>
        </div>
        <div>
          <Label htmlFor="ono">{orderType} number</Label>
          <Input id="ono" value={orderNo} onChange={e => setOrderNo(e.target.value)} placeholder="WO/SRASSK/…" />
        </div>
      </div>

      <div>
        <Label htmlFor="btype">Bill type</Label>
        <select id="btype" value={billType} onChange={e => setBillType(e.target.value)} className={sel}>
          {['Running', 'Advance', 'Full & Final', 'Petty Cash', 'Misc'].map(t => <option key={t} value={t}>{t}</option>)}
        </select>
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

      <div className="max-w-[220px]">
        <Label htmlFor="cl">Claimed amount (this bill)</Label>
        <MoneyInput id="cl" value={claimed} onChange={setClaimed} placeholder="0" />
      </div>

      <Button onClick={submit} disabled={busy} className="bg-indigo-600 hover:bg-indigo-700">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        Enter bill &amp; send to Site Head
      </Button>
    </Card>
  )
}
