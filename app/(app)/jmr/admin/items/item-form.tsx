'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2 } from 'lucide-react'
import type { JmrItem } from '@/lib/types'

interface Props {
  initial?: Partial<JmrItem>
  itemId?: string
}

export function ItemForm({ initial, itemId }: Props) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [v, setV] = useState({
    name: initial?.name ?? '',
    category: (initial?.category ?? 'equipment') as 'equipment' | 'manpower',
    unit: (initial?.unit ?? 'hr') as 'hr' | 'day' | 'nos' | 'cu_m',
    is_active: initial?.is_active ?? true,
  })

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const supabase = createClient()
    const op = itemId
      ? supabase.from('jmr_items').update(v).eq('id', itemId)
      : supabase.from('jmr_items').insert(v)
    const { error } = await op
    if (error) { setError(error.message); setSaving(false); return }
    router.push('/jmr/admin/items')
    router.refresh()
  }

  return (
    <form onSubmit={submit} className="space-y-4 max-w-xl">
      <div>
        <Label>Name *</Label>
        <Input required value={v.name} onChange={e => setV({ ...v, name: e.target.value })} placeholder="e.g. Supply of Excavator 210 Bucket" className="mt-1" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Category *</Label>
          <select
            value={v.category}
            onChange={e => setV({ ...v, category: e.target.value as 'equipment' | 'manpower' })}
            className="mt-1 flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="equipment">Equipment</option>
            <option value="manpower">Manpower</option>
          </select>
        </div>
        <div>
          <Label>Unit *</Label>
          <select
            value={v.unit}
            onChange={e => setV({ ...v, unit: e.target.value as 'hr' | 'day' | 'nos' | 'cu_m' })}
            className="mt-1 flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="hr">Hour (hr)</option>
            <option value="day">Day</option>
            <option value="nos">Nos</option>
            <option value="cu_m">Cubic metre (cu.m)</option>
          </select>
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={v.is_active} onChange={e => setV({ ...v, is_active: e.target.checked })} />
        Active
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex items-center gap-2 pt-2">
        <Button type="submit" disabled={saving || !v.name}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {itemId ? 'Save changes' : 'Create item'}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  )
}
