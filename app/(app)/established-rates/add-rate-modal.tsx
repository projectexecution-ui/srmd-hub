'use client'
// Inline modal for manually adding a unit rate to a sub-category.

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { MoneyInput } from '@/components/ui/money-input'
import { Loader2, X, Check } from 'lucide-react'

interface Subcategory { id: string; name: string; uom: string }
interface Opt { id: string; name: string }

interface Props {
  subcategory: Subcategory
  vendors: Opt[]
  contractors: Opt[]
  onClose: () => void
  onSaved: () => void
}

export function AddRateModal({ subcategory, vendors, contractors, onClose, onSaved }: Props) {
  const [sourceType, setSourceType] = useState<'vendor' | 'contractor'>('vendor')
  const [partyId, setPartyId]   = useState('')
  const [rate, setRate]         = useState('')
  const [gst, setGst]           = useState('18')
  const [validFrom, setValidFrom] = useState(new Date().toISOString().slice(0, 10))
  const [validTill, setValidTill] = useState('')
  const [remarks, setRemarks]   = useState('')
  const [busy, setBusy]         = useState(false)
  const [error, setError]       = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!partyId || !rate) { setError('Pick a vendor/contractor and enter a rate'); return }
    setBusy(true); setError(null)
    const supabase = createClient()
    const payload = {
      subcategory_id: subcategory.id,
      source_type:    sourceType,
      vendor_id:      sourceType === 'vendor'     ? partyId : null,
      contractor_id:  sourceType === 'contractor' ? partyId : null,
      rate_per_unit:  Number(rate),
      gst_pct:        gst === '' ? null : Number(gst),
      valid_from:     validFrom || new Date().toISOString().slice(0, 10),
      valid_till:     validTill || null,
      remarks:        remarks.trim() || null,
      source:         'manual',
    }
    const { error } = await supabase.from('est_rates').insert(payload)
    setBusy(false)
    if (error) { setError(error.message); return }
    onSaved()
  }

  const options = sourceType === 'vendor' ? vendors : contractors

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-xl max-w-md w-full p-5 space-y-3"
      >
        <div className="flex items-start justify-between mb-1">
          <div>
            <h3 className="text-base font-bold text-gray-900">Add rate</h3>
            <p className="text-xs text-gray-500 mt-0.5">{subcategory.name} · per {subcategory.uom}</p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        {error && <p className="text-sm text-rose-600">{error}</p>}

        <div>
          <Label>Source</Label>
          <div className="mt-1 flex gap-2">
            <label className="inline-flex items-center gap-1.5 text-sm">
              <input type="radio" checked={sourceType === 'vendor'}     onChange={() => { setSourceType('vendor');     setPartyId('') }} /> Vendor
            </label>
            <label className="inline-flex items-center gap-1.5 text-sm">
              <input type="radio" checked={sourceType === 'contractor'} onChange={() => { setSourceType('contractor'); setPartyId('') }} /> Contractor
            </label>
          </div>
        </div>

        <div>
          <Label>{sourceType === 'vendor' ? 'Vendor' : 'Contractor'} *</Label>
          <select value={partyId} onChange={e => setPartyId(e.target.value)} required
            className="mt-1 flex h-10 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm">
            <option value="">— Select —</option>
            {options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          {options.length === 0 && (
            <p className="text-[11px] text-gray-500 mt-1">
              No {sourceType}s yet. Add one under {sourceType === 'vendor' ? '/vendors' : '/jmr/admin/contractors'}.
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Rate per {subcategory.uom} *</Label>
            <MoneyInput value={rate} onChange={setRate} required className="mt-1" />
          </div>
          <div>
            <Label>GST %</Label>
            <Input type="number" step="0.01" min="0" value={gst} onChange={e => setGst(e.target.value)} className="mt-1" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Valid from *</Label>
            <Input type="date" value={validFrom} onChange={e => setValidFrom(e.target.value)} required className="mt-1" />
          </div>
          <div>
            <Label>Valid till (optional)</Label>
            <Input type="date" value={validTill} onChange={e => setValidTill(e.target.value)} className="mt-1" />
          </div>
        </div>

        <div>
          <Label>Remarks</Label>
          <Textarea value={remarks} onChange={e => setRemarks(e.target.value)} rows={2} className="mt-1" />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy || !partyId || !rate}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Save rate
          </Button>
        </div>
      </form>
    </div>
  )
}
