'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'
import { Camera, AlertTriangle, Loader2 } from 'lucide-react'
import { formatINR, todayISO } from '@/lib/jmr/format'

type Project = { id: string; name: string; code: string | null }
type Contractor = { id: string; name: string }
type Item = { id: string; name: string; category: 'equipment' | 'manpower'; unit: string }

type Line = {
  item_id: string
  item: Item
  sub_project_id: string | null
  jmr_quantity: number
  billed_quantity: number
  rate: number
}

interface Props {
  projects: Project[]; contractors: Contractor[]; items: Item[]
  gstRate: number; varTolPct: number; varTolMinHours: number
}

export function BillForm({ projects, contractors, items, gstRate, varTolPct, varTolMinHours }: Props) {
  const router = useRouter()
  const supabase = createClient()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [projectId, setProjectId] = useState('')
  const [contractorId, setContractorId] = useState('')
  const [billNumber, setBillNumber] = useState('')
  const [billDate, setBillDate] = useState(todayISO())
  const [periodFrom, setPeriodFrom] = useState('')
  const [periodTo, setPeriodTo] = useState(todayISO())
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [loadingJmr, setLoadingJmr] = useState(false)

  // Fetch JMR earned qty when project/contractor/period are filled.
  useEffect(() => {
    if (!projectId || !contractorId || !periodFrom || !periodTo) { setLines([]); return }
    let alive = true
    ;(async () => {
      setLoadingJmr(true)
      const { data } = await supabase
        .from('jmr_daily_entries')
        .select('item_id, sub_project_id, quantity, rate_snapshot')
        .eq('project_id', projectId)
        .eq('contractor_id', contractorId)
        .gte('entry_date', periodFrom)
        .lte('entry_date', periodTo)
      if (!alive) return
      const agg = new Map<string, { qty: number; rate: number }>()
      for (const e of data ?? []) {
        const key = e.item_id
        const prev = agg.get(key) ?? { qty: 0, rate: Number(e.rate_snapshot) }
        agg.set(key, { qty: prev.qty + Number(e.quantity), rate: Number(e.rate_snapshot) })
      }
      const newLines: Line[] = []
      for (const [item_id, { qty, rate }] of agg) {
        const item = items.find(i => i.id === item_id)
        if (!item) continue
        newLines.push({ item_id, item, sub_project_id: null, jmr_quantity: qty, billed_quantity: qty, rate })
      }
      setLines(newLines)
      setLoadingJmr(false)
    })()
    return () => { alive = false }
  }, [projectId, contractorId, periodFrom, periodTo, supabase, items])

  function setLineBilledQty(idx: number, v: string) {
    const next = [...lines]
    next[idx] = { ...next[idx]!, billed_quantity: Number(v) || 0 }
    setLines(next)
  }

  const subtotal = useMemo(
    () => lines.reduce((s, l) => s + l.billed_quantity * l.rate, 0),
    [lines]
  )
  const gstAmt = +(subtotal * gstRate / 100).toFixed(2)
  const total = +(subtotal + gstAmt).toFixed(2)

  // Variance detection — flag if any line breaches threshold.
  const flaggedLines = lines.filter(l => isVariance(l, varTolPct, varTolMinHours))
  const hasVariance = flaggedLines.length > 0

  const canSubmit = !!(
    projectId && contractorId && billNumber && billDate && periodFrom && periodTo &&
    photoFile && lines.length > 0 && !saving
  )

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!canSubmit) return
    setSaving(true)

    // Upload photo
    let photoUrl: string | null = null
    if (photoFile) {
      const ext = photoFile.name.split('.').pop() || 'jpg'
      const path = `bills/${billDate}/${crypto.randomUUID()}.${ext}`
      const { error: upErr } = await supabase.storage.from('jmr-photos').upload(path, photoFile, {
        cacheControl: '3600', contentType: photoFile.type || 'image/jpeg',
      })
      if (upErr) { setError(`Photo upload failed: ${upErr.message}`); setSaving(false); return }
      photoUrl = path
    }

    const user = (await supabase.auth.getUser()).data.user

    // Insert bill
    const { data: bill, error: billErr } = await supabase.from('jmr_bills').insert({
      bill_number: billNumber,
      contractor_id: contractorId,
      project_id: projectId,
      bill_date: billDate,
      period_from: periodFrom,
      period_to: periodTo,
      subtotal,
      gst_rate: gstRate,
      gst_amount: gstAmt,
      total_amount: total,
      bill_photo_url: photoUrl,
      status: 'pm_review',
      variance_flag: hasVariance,
      submitted_by_user_id: user?.id ?? null,
    }).select('id').single()
    if (billErr) { setError(billErr.message); setSaving(false); return }

    // Insert line items
    const lineRows = lines.map(l => ({
      bill_id: bill.id,
      item_id: l.item_id,
      sub_project_id: l.sub_project_id,
      billed_quantity: l.billed_quantity,
      jmr_quantity: l.jmr_quantity,
      rate: l.rate,
      amount: +(l.billed_quantity * l.rate).toFixed(2),
      variance: +(l.billed_quantity - l.jmr_quantity).toFixed(2),
      variance_pct: l.jmr_quantity > 0
        ? +(((l.billed_quantity - l.jmr_quantity) / l.jmr_quantity) * 100).toFixed(2)
        : null,
    }))
    const { error: linesErr } = await supabase.from('jmr_bill_line_items').insert(lineRows)
    if (linesErr) { setError(linesErr.message); setSaving(false); return }

    router.push('/jmr/bills')
    router.refresh()
  }

  return (
    <Card className="p-4">
      <form onSubmit={submit} className="space-y-3">
        <label className="block">
          <div className={`flex flex-col items-center justify-center border-2 border-dashed rounded-md px-3 py-7 cursor-pointer ${photoFile ? 'border-emerald-300 bg-emerald-50' : 'border-blue-200 bg-blue-50/40 text-blue-700'}`}>
            <Camera className="h-6 w-6 mb-2" />
            <span className="text-sm font-medium">{photoFile ? photoFile.name : 'Tap to snap bill photo'}</span>
            <span className="text-[10px] mt-0.5">required</span>
          </div>
          <input
            type="file" accept="image/jpeg,image/png" capture="environment"
            className="sr-only"
            onChange={e => setPhotoFile(e.target.files?.[0] ?? null)}
          />
        </label>

        <div>
          <Label>Project</Label>
          <select required value={projectId} onChange={e => setProjectId(e.target.value)} className="mt-1 flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm">
            <option value="">— select —</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.code ? `${p.code} — ` : ''}{p.name}</option>)}
          </select>
        </div>
        <div>
          <Label>Contractor</Label>
          <select required value={contractorId} onChange={e => setContractorId(e.target.value)} className="mt-1 flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm">
            <option value="">— select —</option>
            {contractors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Bill no.</Label>
            <Input required value={billNumber} onChange={e => setBillNumber(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Bill date</Label>
            <Input type="date" required value={billDate} onChange={e => setBillDate(e.target.value)} className="mt-1" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Period from</Label>
            <Input type="date" required value={periodFrom} onChange={e => setPeriodFrom(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Period to</Label>
            <Input type="date" required value={periodTo} onChange={e => setPeriodTo(e.target.value)} className="mt-1" />
          </div>
        </div>

        <div>
          <Label>Billed quantities</Label>
          <div className="mt-1 border border-gray-200 rounded-md overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-2 py-2 text-left">Item</th>
                  <th className="px-2 py-2 text-right">JMR qty</th>
                  <th className="px-2 py-2 text-right">Billed qty</th>
                </tr>
              </thead>
              <tbody>
                {loadingJmr && (
                  <tr><td colSpan={3} className="px-2 py-3 text-center text-gray-500">Loading JMR data…</td></tr>
                )}
                {!loadingJmr && lines.length === 0 && (
                  <tr><td colSpan={3} className="px-2 py-3 text-center text-gray-500">
                    {projectId && contractorId && periodFrom && periodTo ? 'No JMR entries for this period.' : 'Select project + contractor + period to load JMR data.'}
                  </td></tr>
                )}
                {lines.map((l, idx) => {
                  const flagged = isVariance(l, varTolPct, varTolMinHours)
                  return (
                    <tr key={l.item_id} className={`border-t border-gray-100 ${flagged ? 'bg-rose-50' : ''}`}>
                      <td className="px-2 py-2 truncate max-w-[140px]">{l.item.name}</td>
                      <td className="px-2 py-2 text-right text-gray-700">{l.jmr_quantity.toFixed(l.jmr_quantity % 1 === 0 ? 0 : 2)} {l.item.unit}</td>
                      <td className="px-2 py-1">
                        <input
                          type="number" step="0.01" min="0"
                          value={l.billed_quantity}
                          onChange={e => setLineBilledQty(idx, e.target.value)}
                          className="w-20 h-8 rounded border border-gray-300 px-1.5 text-right text-xs"
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {hasVariance && (
          <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 rounded-md px-3 py-2 text-xs text-rose-900">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">Variance flagged on {flaggedLines.length} line{flaggedLines.length > 1 ? 's' : ''}</p>
              <p className="opacity-80">PM will see this in review.</p>
            </div>
          </div>
        )}

        {lines.length > 0 && (
          <div className="bg-gray-50 rounded-md p-3 space-y-1 text-sm">
            <Row label="Sub-total" value={formatINR(subtotal)} />
            <Row label={`GST ${gstRate}%`} value={formatINR(gstAmt)} />
            <Row label="Bill total" value={formatINR(total)} bold />
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button type="submit" disabled={!canSubmit} className="w-full">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Submit bill for PM review
        </Button>
      </form>
    </Card>
  )
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'font-bold text-gray-900 border-t border-gray-200 pt-1.5 mt-1.5' : 'text-gray-700'}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  )
}

function isVariance(l: Line, pct: number, minHours: number): boolean {
  const diff = Math.abs(l.billed_quantity - l.jmr_quantity)
  const pctDiff = l.jmr_quantity > 0 ? (diff / l.jmr_quantity) * 100 : (diff > 0 ? 100 : 0)
  if (l.item.unit === 'hr') {
    // Spec: ">5% AND >4hr" both must breach.
    return pctDiff > pct && diff > minHours
  }
  return pctDiff > pct
}
