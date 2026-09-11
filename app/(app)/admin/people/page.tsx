import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getMyProfile, isPortalOwner } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { loadPeopleData } from './load'
import { PeopleClient } from './PeopleClient'

export const dynamic = 'force-dynamic'

/**
 * People — the first of the three Admin doors (11 Sep 2026).
 *
 * Default: one card per person — role, powers, projects, indents, bills e-mail,
 * alert channels. "Grid view" is the six matrices from 10 Sep, for changing many
 * people at once. Both write the same tables the older screens wrote, so those
 * screens stay correct.
 */
export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ tab?: string; person?: string }> }) {
  const [profile, owner] = await Promise.all([getMyProfile(), isPortalOwner()])
  if (!profile || !(owner || profile.role === 'admin')) redirect('/admin')
  const { tab, person } = await searchParams
  const data = await loadPeopleData()

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      <PageHeader
        title="People"
        back="/admin"
        subtitle="Who is in the hub, what each person may open and do, and how they are alerted."
      />
      <p className="text-[12px] text-gray-500">
        Per-project view: <Link href="/admin/projects" className="text-indigo-700 hover:underline">Projects</Link>. Accounts and access requests: <Link href="/admin/users" className="text-indigo-700 hover:underline">Users &amp; roles</Link>. What a role may open: <Link href="/admin/permissions" className="text-indigo-700 hover:underline">What each role can open</Link>.
      </p>
      <PeopleClient data={data} initialTab={tab} initialPerson={person} />
    </div>
  )
}
