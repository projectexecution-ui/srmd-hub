import { notFound } from 'next/navigation'
import { findRegister, type RegisterFilter } from '@/lib/stores/registers'
import {
  loadRegister, loadRegisterParties, loadLists, listsOf, loadProjectOptions,
} from '@/lib/stores/queries'
import { RegisterClient } from '../RegisterClient'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * One of the mind map's four registers.
 *
 * A single route for all four — they differ only by which direction and which
 * register they read, and that is data (REGISTERS in lib/stores/registers.ts),
 * not four copies of a page.
 */
export default async function RegisterPage({
  params, searchParams,
}: {
  params: Promise<{ kind: string }>
  searchParams: Promise<{ from?: string; to?: string; party?: string; project?: string; discipline?: string }>
}) {
  const { kind } = await params
  const spec = findRegister(kind)
  if (!spec) notFound()

  const sp = await searchParams
  const iso = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null)
  const filter: RegisterFilter = {
    from: iso(sp.from), to: iso(sp.to),
    party: sp.party?.trim() || null,
    projectId: sp.project?.trim() || null,
    disciplineId: sp.discipline?.trim() || null,
  }

  const [rows, parties, lists, projects] = await Promise.all([
    loadRegister(spec, filter),
    loadRegisterParties(),
    loadLists(),
    loadProjectOptions(),
  ])

  const disciplines = listsOf(lists, 'discipline').filter(d => d.isActive).map(d => ({ id: d.id, name: d.name }))

  return (
    <RegisterClient
      spec={spec}
      rows={rows}
      filter={filter}
      parties={parties}
      projects={projects}
      disciplines={disciplines}
      names={{
        project: projects.find(p => p.id === filter.projectId)?.name,
        discipline: disciplines.find(d => d.id === filter.disciplineId)?.name,
      }}
    />
  )
}
