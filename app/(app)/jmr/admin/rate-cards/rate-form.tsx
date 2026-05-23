'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2 } from 'lucide-react'
import { todayISO } from '@/lib/jmr/format'

type Option = { id: string; name: string }
type ItemOption = { id: string; name: string; unit: string }

interface Props {
  contractors: Option[]
  items: ItemOption[]
  projects: Option[]
  initial?: {
    contractor_id?: string; item_id?: string; project_id?: string | null;
    rate_per_unit?: number; valid_from?: string; valid_till?: string | null;
  }
  rateCardId?: string
}

export function RateForm({ contractors, items, projects, initial, rateCardId }: Props) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [v, setV] = useState({
    contractor_id: initial?.contractor_id ?? '',
    item_id: initial?.item_id ?? '',
    project_id: initial?.project_id ?? '',
    rate_per_unit: initial?.rate_per_unit?.toString() ?? '',
    valid_from: initial?.valid_from ?? todayISO(),
    valid_till: initial?.valid_till ?? '',
  })
  const [reason, setReason] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const supabase = createClient()
    const payload = {
      contractor_id: v.contractor_id,
      item_id: v.item_id,
      project_id: v.project_id || null,
      rate_per_unit: Number(v.rate_per_unit),
      valid_from: v.valid_from,
      valid_till: v.valid_till || null,
    }

    if (rateCardId) {
      // Log the change first.
      const { data: existing } = await supabase
        .from('jmr_rate_cards')
        .select('rate_per_unit, contractor_id, item_id, project_id')
        .eq('id', rateCardId)
        .single()
      if (existing && Number(existing.rate_per_unit) !== payload.rate_per_unit) {
        await supabase.from('jmr_rate_change_log').insert({
          rate_card_id: rateCardId,
          contractor_id: existing.contractor_id,
          item_id: existing.item_id,
          project_id: existing.project_id,
          old_rate: existing.rate_per_unit,
          new_rate: payload.rate_per_unit,
          reason: reason || null,
        })
      }
      const { error } = await supabase.from('jmr_rate_cards').update(payload).eq('id', rateCardId)
      if (error) { setError(error.message); setSaving(false); return }
    } else {
      const { error } = await supabase.from('jmr_rate_cards').insert(payload)
      if (error) { setError(error.message); setSaving(false); return }
    }
    router.push('/jmr/admin/rate-cards')
    router.refresh()
  }

  const selectedItem = items.find(i => i.id === v.item_id)

  return (
    <form onSubmit={submit} className="space-y-4 max-w-2xl">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label>Contractor *</Label>
          <select
            required value={v.contractor_id}
            onChange={e => setV({ ...v, contractor_id: e.target.value })}
            className="mt-1 flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">— select —</option>
            {contractors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <Label>Item *</Label>
          <select
            required value={v.item_id}
            onChange={e => setV({ ...v, item_id: e.target.value })}
            className="mt-1 flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">— select —</option>
            {items.map(i => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
          </select>
        </div>
      </div>
      <div>
        <Label>Project (leave blank = default rate for this contractor + item)</Label>
        <select
          value={v.project_id ?? ''}
          onChange={e => setV({ ...v, project_id: e.target.value })}
          className="mt-1 flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All projects (default)</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <Label>Rate per {selectedItem?.unit ?? 'unit'} *</Label>
          <Input
            type="number" step="0.01" min="0" required
            value={v.rate_per_unit}
            onChange={e => setV({ ...v, rate_per_unit: e.target.value })}
            className="mt-1"
          />
        </div>
        <div>
          <Label>Valid from *</Label>
          <Input type="date" required value={v.valid_from} onChange={e => setV({ ...v, valid_from: e.target.value })} className="mt-1" />
        </div>
        <div>
          <Label>Valid till (optional)</Label>
          <Input type="date" value={v.valid_till ?? ''} onChange={e => setV({ ...v, valid_till: e.target.value })} className="mt-1" />
        </div>
      </div>
      {rateCardId && (
        <div>
          <Label>Reason for rate change (logged)</Label>
          <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. revised contract, market change" className="mt-1" />
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex items-center gap-2 pt-2">
        <Button type="submit" disabled={saving || !v.contractor_id || !v.item_id || !v.rate_per_unit}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {rateCardId ? 'Save changes' : 'Create rate'}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  )
}
