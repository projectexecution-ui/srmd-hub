import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { Users, Settings } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function AdminHomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') redirect('/dashboard')

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto">
      <PageHeader title="Admin" subtitle="App configuration" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Link href="/admin/users"><Card className="p-5 hover:shadow-md transition-shadow"><Users className="h-6 w-6 text-slate-700 mb-3" /><h3 className="font-semibold text-gray-900">Users & Roles</h3><p className="text-sm text-gray-500 mt-1">Assign admin / uploader / viewer.</p></Card></Link>
        <Link href="/admin/settings"><Card className="p-5 hover:shadow-md transition-shadow"><Settings className="h-6 w-6 text-slate-700 mb-3" /><h3 className="font-semibold text-gray-900">Settings</h3><p className="text-sm text-gray-500 mt-1">Admin email, etc.</p></Card></Link>
      </div>
    </div>
  )
}
