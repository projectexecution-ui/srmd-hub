import { redirect } from 'next/navigation'
import { getMyProfile, isPortalOwner } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/PageHeader'
import { ManualFallbackBody } from './body'

export const dynamic = 'force-dynamic'

/**
 * Manual upload (IN4 fallback) — its own page for the people granted it under
 * People › Powers, who cannot open Admin › Data. Admins reach the same screen
 * as Data › Manual fallback.
 */
export default async function ManualUploadPage() {
  const [profile, owner] = await Promise.all([getMyProfile(), isPortalOwner()])
  if (!profile) redirect('/admin')
  if (owner || profile.role === 'admin') redirect('/admin/data?tab=fallback')
  // Others only when ticked under Admin → People → Powers → Manual upload.
  const supabase = await createClient()
  const { data: g } = await supabase.from('app_settings').select('value').eq('key', 'in4_manual_upload_users').maybeSingle()
  if (!((g?.value as string | null) ?? '').includes(profile.id)) redirect('/admin')

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <PageHeader title="Manual upload (IN4 fallback)" back="/dashboard" subtitle="For the day IN4 cannot be read. Switch on, upload the sheets, switch off when IN4 is back." />
      <ManualFallbackBody />
    </div>
  )
}
