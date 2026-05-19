import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardContent } from '@/components/ui/card'
import { ProjectForm } from '../project-form'

export default async function NewProjectPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') redirect('/projects')

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto">
      <PageHeader title="New Project" back="/projects" />
      <Card><CardContent className="pt-6"><ProjectForm /></CardContent></Card>
    </div>
  )
}
