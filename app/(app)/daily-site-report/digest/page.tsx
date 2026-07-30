import { requirePermission, getMyProfile } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/ui/empty-state'
import { ImageOff } from 'lucide-react'
import { DigestCard } from './DigestCard'

export const dynamic = 'force-dynamic'

export default async function DigestPage() {
  await requirePermission('daily-site-report', 'view')
  const profile = await getMyProfile()
  const role = profile?.role
  const isMgmt = role === 'admin' || role === 'project_head' || role === 'head' || role === 'founder'

  const IST = 5.5 * 3600 * 1000
  const todayIST = new Date(Date.now() + IST).toISOString().slice(0, 10)

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-6">
      <PageHeader
        title="Daily digest card"
        subtitle="A shareable summary of the day's material arrivals — copy or download, then post to the WhatsApp group"
        back="/daily-site-report"
      />
      {isMgmt ? (
        <DigestCard defaultDate={todayIST} />
      ) : (
        <EmptyState
          icon={<ImageOff className="h-10 w-10" />}
          title="Management only"
          description="The daily digest card summarises every site — it's available to management roles."
        />
      )}
    </div>
  )
}
