import Link from 'next/link'
import { MessageSquare } from 'lucide-react'
import { getMyPermissions, can } from '@/lib/auth'
import { checkIsCcReviewer } from '@/components/cost-control/ws-actions'
import { loadProjectDiscussions } from '@/lib/revamp/tab-data'
import { MentionText } from '@/components/mentions/MentionText'
import { formatDateTime } from '@/lib/utils'
import { loadAssignees, loadCategoryOptions, loadRegister, loadStakeholders } from '@/lib/site-register/queries'
import type { RegisterFilter } from '@/lib/site-register/types'
import { RegisterClient } from './RegisterClient'

/**
 * Discussions — the project's register.
 *
 * The four pills decide what the page opens on, which is the whole difference
 * between a register people use and one they scroll: a person lands on their
 * own list, not on the project's.
 */
const BY_PILL: RegisterFilter[] = ['live', 'mine', 'overdue', 'closed']

export async function RegisterTab({
  projectId, view = 0, scopeAll = false, openEntryId = null,
}: {
  projectId: string
  view?: number
  /** Every project the reader can see, rather than this one. An engineer works
   *  on four sites and their own list is the point of the register. */
  scopeAll?: boolean
  openEntryId?: string | null
}) {
  const [register, assignees, categories, stake, perms, reviewer] = await Promise.all([
    loadRegister(scopeAll ? null : projectId),
    loadAssignees(projectId),
    loadCategoryOptions(projectId),
    loadStakeholders(projectId),
    getMyPermissions(),
    checkIsCcReviewer(),
  ])
  const canWrite = can(perms, 'cost-control', 'edit')

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={scopeAll ? `/project/${projectId}/discussions` : `/project/${projectId}/discussions?scope=all`}
          className="text-[12px] font-semibold text-indigo-700 hover:underline"
        >
          {scopeAll ? `← Only ${stake.projectName}` : 'Show entries across every project →'}
        </Link>
      </div>

      <RegisterClient
        projectId={projectId}
        projectName={stake.projectName}
        rows={register.rows}
        myId={register.myId}
        initialFilter={BY_PILL[view] ?? 'live'}
        scopeAll={scopeAll}
        canWrite={canWrite}
        people={assignees.people}
        stakeholders={assignees.stakeholders}
        stakeholderRecords={stake.people}
        categories={categories}
        disciplines={stake.enabled.map(d => ({ id: d.id, name: d.name }))}
        closedDurations={register.closedDurations}
        escalationDays={register.escalationDays}
        openEntryId={openEntryId}
      />

      {/* The conversation that existed before the register did. Kept, read
          only, rather than migrated: these comments belong to their sheets and
          moving them would break the sheet they were written on. */}
      <SheetComments projectId={projectId} reviewer={reviewer} />
    </div>
  )
}

async function SheetComments({ projectId, reviewer }: { projectId: string; reviewer: boolean }) {
  const { comments, mentionUsers, mentioningMe } = await loadProjectDiscussions(projectId, { includeInternal: reviewer })
  if (comments.length === 0) return null

  const ordered = [...comments].sort((a, b) =>
    Number(b.mentionsMe) - Number(a.mentionsMe) ||
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  return (
    <details className="rounded-lg border border-gray-200 bg-white">
      <summary className="px-4 py-3 cursor-pointer list-none flex items-center gap-2.5 min-h-[44px]">
        <MessageSquare className="h-4 w-4 text-gray-400 shrink-0" />
        <div>
          <p className="text-[13px] font-bold text-gray-900">
            Comments on budget sheets
            <span className="ml-2 text-[12px] font-normal text-gray-500">
              {comments.length}
              {mentioningMe > 0 && <span className="font-semibold text-blue-700"> · {mentioningMe} mentioning you</span>}
            </span>
          </p>
          <p className="text-[11px] text-gray-500">Written on this project&rsquo;s working sheets, before the register existed. Read only — reply on the sheet itself.</p>
        </div>
        <span className="ml-auto text-[12px] text-indigo-700 font-semibold">Show</span>
      </summary>
      <div className="border-t border-gray-100 divide-y divide-gray-100 max-h-[420px] overflow-y-auto">
        {ordered.map(c => (
          <div key={c.id} className={`px-4 py-3 ${c.mentionsMe ? 'bg-blue-50/50 border-l-2 border-l-blue-500' : ''}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <p className="text-[13px] font-semibold text-gray-900">
                {c.author}
                {c.mentionsMe && <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-bold text-blue-800 align-middle">mentions you</span>}
              </p>
              <p className="text-[11px] text-gray-400">{formatDateTime(c.createdAt)}</p>
            </div>
            <p className="text-[13px] text-gray-700 mt-1 whitespace-pre-wrap break-words">
              <MentionText text={c.body} users={mentionUsers} />
            </p>
            <Link href={`/cost-control/working-sheets/${c.wsId}`} className="inline-block mt-1.5 text-[12px] font-medium text-indigo-700 hover:underline">
              on {c.wsCode ?? 'a sheet'} →
            </Link>
          </div>
        ))}
      </div>
    </details>
  )
}
