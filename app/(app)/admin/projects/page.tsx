import Link from 'next/link'
import { Plus } from 'lucide-react'
import { adminViewer } from '@/lib/admin/viewer'
import { doorById, resolveTab, visibleTabs } from '@/lib/admin/doors'
import { AdminDoor, NothingHere } from '../Door'
import { loadPeopleData } from '../people/load'
import { ProjectsClient } from './ProjectsClient'
import { SigningRulesBody } from '../approvals/body'
import { BillsDesksBody } from '@/app/(app)/bills-booking/admin/body'
import { TrackerVisibilityBody } from '@/app/(app)/procurement-tracker/admin/body'

export const dynamic = 'force-dynamic'

/**
 * Projects — the second door (Aksha, 11 Sep 2026; widened 23 Sep 2026, D1).
 *
 *   Per project         one card per project: who signs each stage, who works on it
 *   Signing rules       what /admin/approvals was — who may move a document, per module
 *   Bills desks         who works each desk, per sub-project (also inside Bills Approval)
 *   Tracker visibility  who sees which project's indents (also inside the tracker)
 *
 * New project sits in the header rather than as a tab: it is a form, not a
 * screen you read.
 */
export default async function AdminProjectsPage({ searchParams }: { searchParams: Promise<{ tab?: string; project?: string }> }) {
  const [v, { tab: requested, project }] = await Promise.all([adminViewer(), searchParams])
  const door = doorById('projects')!
  const tabs = visibleTabs(door, v)
  const current = resolveTab(door, requested, v)
  if (!current) return <NothingHere door={door} />

  const newProject = (
    <Link href="/cost-control/projects/new" className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700">
      <Plus className="h-4 w-4" /> New project
    </Link>
  )

  return (
    <AdminDoor door={door} tabs={tabs} current={current} actions={newProject}>
      {current.id === 'projects' && <PerProject initialProject={project} />}
      {current.id === 'signing' && <SigningRulesBody />}
      {current.id === 'desks' && <BillsDesksBody />}
      {current.id === 'tracker' && <TrackerVisibilityBody />}
    </AdminDoor>
  )
}

async function PerProject({ initialProject }: { initialProject?: string }) {
  const data = await loadPeopleData()
  const noHead = data.projects.filter(p => !p.isGroup && !data.approvers.some(a => a.project_id === p.id && a.role === 'project_head'))
  return (
    <ProjectsClient data={data} initialProject={initialProject ?? noHead[0]?.id} noHead={noHead.map(p => ({ id: p.id, label: p.label }))} />
  )
}
