import { notFound } from 'next/navigation'
import { requirePermission, can, getMyUser } from '@/lib/auth'
import { getProjectSchedule } from '@/lib/schedule/data'
import { ScheduleClient } from './schedule-client'

export const dynamic = 'force-dynamic'

export default async function ProjectSchedulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const perms = await requirePermission('schedule', 'view')
  const canEdit = can(perms, 'schedule', 'edit')
  const data = await getProjectSchedule(id)
  if (!data) notFound()
  const me = await getMyUser()
  return <ScheduleClient data={data} canEdit={canEdit} meId={me?.id ?? null} />
}
