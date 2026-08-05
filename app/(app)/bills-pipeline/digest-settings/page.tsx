import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getMyProfile } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { parseBillsDigestConfig, BILLS_PROJECT_CODES } from '@/lib/bills-pipeline/digest-settings'
import { BillsDigestForm } from './BillsDigestForm'

export const dynamic = 'force-dynamic'

export default async function BillsDigestSettingsPage() {
  const profile = await getMyProfile()
  if (!profile || profile.role !== 'admin') redirect('/bills-pipeline')

  const supabase = await createClient()
  const [{ data: settings }, { data: users }] = await Promise.all([
    supabase.from('app_settings').select('key, value').like('key', 'bills_digest_%'),
    supabase.from('profiles').select('id, full_name, email, role').eq('is_active', true).order('full_name', { ascending: true }),
  ])
  const cfg = parseBillsDigestConfig((settings ?? []) as Array<{ key: string; value: string }>)

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
      <PageHeader
        title="Bills digest — daily email"
        back="/bills-pipeline"
        subtitle="One 9 AM email per Atm Head with a card per their project — bills still with CT, oldest days first."
      />
      <BillsDigestForm
        initial={cfg}
        users={(users ?? []).map(u => ({ id: u.id as string, full_name: (u.full_name as string | null) ?? null, email: u.email as string, role: u.role as string }))}
        projectCodes={BILLS_PROJECT_CODES}
      />
    </div>
  )
}
