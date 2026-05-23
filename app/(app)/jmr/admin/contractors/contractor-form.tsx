'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2 } from 'lucide-react'
import type { JmrContractor } from '@/lib/types'

interface Props {
  initial?: Partial<JmrContractor>
  contractorId?: string
}

export function ContractorForm({ initial, contractorId }: Props) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [v, setV] = useState({
    name: initial?.name ?? '',
    gst_number: initial?.gst_number ?? '',
    contact_person: initial?.contact_person ?? '',
    phone: initial?.phone ?? '',
    email: initial?.email ?? '',
    status: initial?.status ?? 'active',
  })

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const supabase = createClient()

    if (contractorId) {
      const { error } = await supabase.from('jmr_contractors').update(v).eq('id', contractorId)
      if (error) { setError(error.message); setSaving(false); return }
      router.push(`/jmr/admin/contractors`)
    } else {
      const { error } = await supabase.from('jmr_contractors').insert(v)
      if (error) { setError(error.message); setSaving(false); return }
      router.push(`/jmr/admin/contractors`)
    }
    router.refresh()
  }

  return (
    <form onSubmit={submit} className="space-y-4 max-w-xl">
      <Field label="Name *" required value={v.name} onChange={x => setV({ ...v, name: x })} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="GST number" value={v.gst_number ?? ''} onChange={x => setV({ ...v, gst_number: x })} placeholder="22AAAAA0000A1Z5" />
        <Field label="Contact person" value={v.contact_person ?? ''} onChange={x => setV({ ...v, contact_person: x })} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Phone" value={v.phone ?? ''} onChange={x => setV({ ...v, phone: x })} />
        <Field label="Email" type="email" value={v.email ?? ''} onChange={x => setV({ ...v, email: x })} />
      </div>
      <div>
        <Label>Status</Label>
        <select
          value={v.status}
          onChange={e => setV({ ...v, status: e.target.value })}
          className="mt-1 flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex items-center gap-2 pt-2">
        <Button type="submit" disabled={saving || !v.name}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {contractorId ? 'Save changes' : 'Create contractor'}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  )
}

function Field({ label, value, onChange, type = 'text', required, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean; placeholder?: string
}) {
  return (
    <div>
      <Label>{label}</Label>
      <Input type={type} value={value} onChange={e => onChange(e.target.value)} required={required} placeholder={placeholder} className="mt-1" />
    </div>
  )
}
