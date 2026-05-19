import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardContent } from '@/components/ui/card'
import { VendorForm } from '../vendor-form'

export default async function NewVendorPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin' && profile?.role !== 'uploader') redirect('/vendors')

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto">
      <PageHeader title="New Vendor" back="/vendors" />
      <Card><CardContent className="pt-6"><VendorForm /></CardContent></Card>
    </div>
  )
}
