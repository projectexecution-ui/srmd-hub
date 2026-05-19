'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Loader2 } from 'lucide-react'
import type { Vendor } from '@/lib/types'

interface Props {
  initial?: Partial<Vendor>
  vendorId?: string
}

export function VendorForm({ initial, vendorId }: Props) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [v, setV] = useState({
    name: initial?.name ?? '',
    gstin: initial?.gstin ?? '',
    address: initial?.address ?? '',
    contact_person: initial?.contact_person ?? '',
    contact_phone: initial?.contact_phone ?? '',
    contact_email: initial?.contact_email ?? '',
  })

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const supabase = createClient()

    if (vendorId) {
      const { error } = await supabase.from('vendors').update(v).eq('id', vendorId)
      if (error) { setError(error.message); setSaving(false); return }
      router.push(`/vendors/${vendorId}`)
    } else {
      const { data, error } = await supabase.from('vendors').insert(v).select('id').single()
      if (error) { setError(error.message); setSaving(false); return }
      router.push(`/vendors/${data.id}`)
    }
    router.refresh()
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Name *" required value={v.name} onChange={x => setV({ ...v, name: x })} />
      <Field label="GSTIN" value={v.gstin ?? ''} onChange={x => setV({ ...v, gstin: x })} placeholder="e.g. 24AAACR5055K1ZD" />
      <div>
        <Label>Address</Label>
        <Textarea value={v.address ?? ''} onChange={e => setV({ ...v, address: e.target.value })} rows={3} className="mt-1" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Contact person" value={v.contact_person ?? ''} onChange={x => setV({ ...v, contact_person: x })} />
        <Field label="Phone" value={v.contact_phone ?? ''} onChange={x => setV({ ...v, contact_phone: x })} />
      </div>
      <Field label="Email" type="email" value={v.contact_email ?? ''} onChange={x => setV({ ...v, contact_email: x })} />

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex items-center gap-2 pt-2">
        <Button type="submit" disabled={saving || !v.name}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {vendorId ? 'Save changes' : 'Create vendor'}
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
