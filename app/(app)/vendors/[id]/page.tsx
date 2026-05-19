import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Pencil, FileText } from 'lucide-react'
import { formatDate, formatINR } from '@/lib/utils'
import { VendorForm } from '../vendor-form'

export const dynamic = 'force-dynamic'

export default async function VendorDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ edit?: string }>
}) {
  const { id } = await params
  const sp = await searchParams
  const editing = sp.edit === '1'

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = user ? await supabase.from('profiles').select('role').eq('id', user.id).single() : { data: null }
  const canWrite = profile?.role === 'admin' || profile?.role === 'uploader'

  const { data: vendor } = await supabase.from('vendors').select('*').eq('id', id).single()
  if (!vendor) notFound()

  const { data: pos } = await supabase
    .from('purchase_orders')
    .select('id, po_no, po_date, po_amount')
    .eq('vendor_id', id)
    .order('po_date', { ascending: false })
    .limit(20)

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4">
      <PageHeader title={vendor.name} back="/vendors">
        {!editing && canWrite && (
          <Button asChild size="sm" variant="outline">
            <Link href={`/vendors/${id}?edit=1`}><Pencil className="h-4 w-4" /> Edit</Link>
          </Button>
        )}
      </PageHeader>

      {editing ? (
        <Card><CardContent className="pt-6"><VendorForm initial={vendor} vendorId={id} /></CardContent></Card>
      ) : (
        <Card>
          <CardContent className="pt-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <Field label="GSTIN" value={vendor.gstin || '—'} mono />
              <Field label="Contact person" value={vendor.contact_person || '—'} />
              <Field label="Phone" value={vendor.contact_phone || '—'} />
              <Field label="Email" value={vendor.contact_email || '—'} />
              <div className="md:col-span-2">
                <Field label="Address" value={vendor.address || '—'} whitespace />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent POs ({pos?.length ?? 0})</CardTitle>
        </CardHeader>
        <CardContent>
          {pos && pos.length > 0 ? (
            <div className="space-y-2">
              {pos.map(p => (
                <Link
                  key={p.id}
                  href={`/pos/${p.id}`}
                  className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0 hover:bg-gray-50 -mx-2 px-2 rounded-lg"
                >
                  <div>
                    <p className="text-sm font-semibold text-blue-700">{p.po_no}</p>
                    <p className="text-xs text-gray-500">{formatDate(p.po_date)}</p>
                  </div>
                  <p className="text-sm font-semibold text-gray-900">{formatINR(p.po_amount)}</p>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState icon={<FileText className="h-8 w-8" />} title="No POs for this vendor yet" />
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Field({ label, value, mono, whitespace }: { label: string; value: string; mono?: boolean; whitespace?: boolean }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">{label}</p>
      <p className={
        'text-sm font-medium text-gray-900' +
        (mono ? ' font-mono text-xs' : '') +
        (whitespace ? ' whitespace-pre-line' : '')
      }>{value}</p>
    </div>
  )
}
