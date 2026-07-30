'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { MoneyInput } from '@/components/ui/money-input'
import { Card } from '@/components/ui/card'
import { FileCheck2, Camera, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { compressImage } from '@/lib/img/compress'
import { todayISO } from '@/lib/jmr/format'

type Proj = { id: string; code: string | null; name: string }
type Vend = { id: string; name: string }

const OTHER = '__other__'

export function ReportForm({ projects, vendors, createdBy }: { projects: Proj[]; vendors: Vend[]; createdBy: string }) {
  const router = useRouter()
  const supabase = createClient()
  const today = todayISO()

  const [projectId, setProjectId] = useState(projects.length === 1 ? projects[0].id : '')
  const [vendorId, setVendorId] = useState('')          // '' = choose, OTHER = free-text
  const [supplierText, setSupplierText] = useState('')
  const [material, setMaterial] = useState('')
  const [qty, setQty] = useState('')
  const [unit, setUnit] = useState('')
  const [amount, setAmount] = useState('')
  const [billNo, setBillNo] = useState('')
  const [billDate, setBillDate] = useState('')
  const [receivedOn, setReceivedOn] = useState(today)
  const [stampedBill, setStampedBill] = useState<File | null>(null)
  const [materialPhotos, setMaterialPhotos] = useState<File[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const supplierOk = vendorId === OTHER ? supplierText.trim().length > 0 : vendorId !== ''

  const missing: string[] = []
  if (!projectId) missing.push('site')
  if (!supplierOk) missing.push('supplier')
  if (!material.trim()) missing.push('material')
  if (!billNo.trim()) missing.push('bill number')
  if (!stampedBill) missing.push('stamped-bill photo')
  const canSubmit = missing.length === 0 && !saving

  function addMaterialPhotos(files: FileList | null) {
    if (!files) return
    setMaterialPhotos(prev => [...prev, ...Array.from(files)])
  }
  function removeMaterialPhoto(i: number) {
    setMaterialPhotos(prev => prev.filter((_, idx) => idx !== i))
  }

  async function uploadOne(file: File, path: string): Promise<boolean> {
    const compressed = await compressImage(file)
    const { error: upErr } = await supabase.storage.from('site-reports').upload(path, compressed, {
      cacheControl: '3600',
      contentType: compressed.type || 'image/jpeg',
    })
    return !upErr
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!canSubmit) return
    setSaving(true)

    const reportId = crypto.randomUUID()

    // 1. Stamped bill FIRST — the entry gate. No photo, no row.
    const stampedPath = `${reportId}/stamped-${crypto.randomUUID()}.jpg`
    if (!(await uploadOne(stampedBill!, stampedPath))) {
      setError('Could not upload the stamped-bill photo. Check your connection and try again.')
      setSaving(false)
      return
    }

    // 2. Insert the report (stamped_bill_path NOT NULL is the DB backstop).
    const { error: insErr } = await supabase.from('dsr_reports').insert({
      id: reportId,
      project_id: projectId,
      vendor_id: vendorId === OTHER || vendorId === '' ? null : vendorId,
      supplier_name_text: vendorId === OTHER ? supplierText.trim() : null,
      material_description: material.trim(),
      quantity: qty ? Number(qty) : null,
      unit: unit.trim() || null,
      amount: amount ? Number(amount) : null,
      bill_number: billNo.trim(),
      bill_date: billDate || null,
      received_on: receivedOn || today,
      stamped_bill_path: stampedPath,
      created_by: createdBy,
    })
    if (insErr) {
      const dup = /dsr_reports_bill_uq|duplicate key/i.test(insErr.message)
      setError(dup
        ? `A report for bill "${billNo.trim()}" already exists on this site.`
        : `Could not save — ${insErr.message}`)
      setSaving(false)
      return
    }

    // 3. Material photos (optional) — best effort, never blocks the save.
    let failed = 0
    for (const f of materialPhotos) {
      const path = `${reportId}/material-${crypto.randomUUID()}.jpg`
      if (!(await uploadOne(f, path))) { failed++; continue }
      const { error: attErr } = await supabase.from('dsr_attachments').insert({
        report_id: reportId, path, name: f.name, kind: 'material', uploaded_by: createdBy,
      })
      if (attErr) failed++
    }
    if (failed > 0) toast.warning(`Saved. ${failed} material photo(s) couldn't upload — add them later from the report.`)
    else toast.success('Site report saved')

    router.push(`/daily-site-report/${reportId}`)
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-4">
      {/* Stamped bill — the gate, first and prominent */}
      <Card className="border-teal-200 bg-teal-50/40 p-4">
        <Label className="text-sm font-semibold text-teal-900">Stamped bill photo — required</Label>
        <p className="mb-2 mt-0.5 text-xs text-teal-800/80">
          The stamped copy is the proof the bill reached the CT office. You can&apos;t save without it.
        </p>
        <label className="block cursor-pointer">
          <div className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-3 py-6 ${stampedBill ? 'border-teal-400 bg-teal-50' : 'border-teal-300 hover:border-teal-400'}`}>
            <FileCheck2 className={`mb-1 h-6 w-6 ${stampedBill ? 'text-teal-600' : 'text-teal-400'}`} />
            <span className="text-sm font-medium text-teal-900">{stampedBill ? stampedBill.name : 'Tap to photograph the stamped bill'}</span>
            {stampedBill && <span className="mt-0.5 text-[11px] text-teal-700">Tap again to retake</span>}
          </div>
          <input
            type="file"
            accept="image/jpeg,image/png"
            capture="environment"
            className="sr-only"
            onChange={e => setStampedBill(e.target.files?.[0] ?? null)}
          />
        </label>
      </Card>

      <Card className="space-y-3 p-4">
        <div>
          <Label>Site</Label>
          <select
            value={projectId}
            onChange={e => setProjectId(e.target.value)}
            className="mt-1 flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">— select site —</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.code ? `${p.code} — ` : ''}{p.name}</option>
            ))}
          </select>
        </div>

        <div>
          <Label>Supplier</Label>
          <select
            value={vendorId}
            onChange={e => setVendorId(e.target.value)}
            className="mt-1 flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">— select supplier —</option>
            {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            <option value={OTHER}>Other (type name)…</option>
          </select>
          {vendorId === OTHER && (
            <Input
              value={supplierText}
              onChange={e => setSupplierText(e.target.value)}
              placeholder="Supplier / vendor name"
              className="mt-2"
            />
          )}
        </div>

        <div>
          <Label>Material received</Label>
          <Textarea
            value={material}
            onChange={e => setMaterial(e.target.value)}
            rows={2}
            placeholder="e.g. TMT bars 12mm — 40 nos"
            className="mt-1"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Quantity</Label>
            <Input value={qty} onChange={e => setQty(e.target.value)} inputMode="decimal" placeholder="e.g. 40" className="mt-1" />
          </div>
          <div>
            <Label>Unit</Label>
            <Input value={unit} onChange={e => setUnit(e.target.value)} placeholder="nos / bags / MT" className="mt-1" />
          </div>
        </div>

        <div>
          <Label>Bill amount (optional)</Label>
          <MoneyInput value={amount} onChange={setAmount} className="mt-1" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Bill number</Label>
            <Input value={billNo} onChange={e => setBillNo(e.target.value)} placeholder="Supplier bill no." className="mt-1" />
          </div>
          <div>
            <Label>Bill date (optional)</Label>
            <Input type="date" value={billDate} max={today} onChange={e => setBillDate(e.target.value)} className="mt-1" />
          </div>
        </div>

        <div>
          <Label>Received on</Label>
          <Input type="date" value={receivedOn} max={today} onChange={e => setReceivedOn(e.target.value || today)} className="mt-1" />
        </div>
      </Card>

      {/* Material photos — optional */}
      <Card className="p-4">
        <Label className="text-sm font-semibold">Material photos (optional)</Label>
        <p className="mb-2 mt-0.5 text-xs text-gray-500">Photograph the delivered material — helpful for management to verify.</p>
        <label className="block cursor-pointer">
          <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 px-3 py-5 hover:border-gray-400">
            <Camera className="mb-1 h-5 w-5 text-gray-400" />
            <span className="text-sm text-gray-700">Add material photo(s)</span>
          </div>
          <input
            type="file"
            accept="image/jpeg,image/png"
            capture="environment"
            multiple
            className="sr-only"
            onChange={e => { addMaterialPhotos(e.target.files); e.currentTarget.value = '' }}
          />
        </label>
        {materialPhotos.length > 0 && (
          <ul className="mt-2 space-y-1">
            {materialPhotos.map((f, i) => (
              <li key={i} className="flex items-center justify-between rounded border border-gray-100 bg-gray-50 px-2 py-1 text-xs text-gray-700">
                <span className="truncate">{f.name}</span>
                <button type="button" onClick={() => removeMaterialPhoto(i)} className="ml-2 text-gray-400 hover:text-red-600" aria-label="Remove photo">
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {missing.length > 0 && (
        <p className="text-xs text-amber-700">Add {missing.join(', ')} to save.</p>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={!canSubmit} className="min-w-40">
          {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
          {saving ? 'Saving…' : 'Save report'}
        </Button>
      </div>
    </form>
  )
}
