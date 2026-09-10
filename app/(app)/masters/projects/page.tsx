import Link from 'next/link'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { RowDetailProvider, RowDetailToggle, RowDetail } from '@/components/cost-control/project-tree'
import { loadProjectMaster, matchesQuery, type MainProject, type SubProject } from '@/lib/revamp/masters-in4'
import { loadProjectMaster as loadHubRegistry } from '@/lib/masters'
import { formatDate, formatINR, formatNumber, todayIST } from '@/lib/utils'
import { In4Note } from '../In4Note'
import { MasterSearchBox } from '../MasterSearchBox'
import { MasterTable, type MasterRow } from '../MasterTable'
import { ViewPills } from '../ViewPills'
import { UseIn4AreaButton } from './UseIn4AreaButton'
import { canEditMasters } from '../admin'

export const dynamic = 'force-dynamic'

/**
 * Project Master — IN4's projects and sub-projects (NGH → NGH A-Execution,
 * NGH B-Execution, NGH B-Design …) with start and end dates, the paying
 * trust, the site address, IN4's own status, work orders counted against
 * each, and which CT Hub project the sub-project feeds. Buildings with work
 * orders come first; IN4's placeholder projects (named after the trusts,
 * Warehouse, Fixed Assets) sit below, collapsed. A search narrows both, and
 * shows matching sub-projects open.
 *
 * Second view — "CT Hub registry": the hub's own projects with their IN4
 * side beside them (which sub-projects feed each, IN4's area and budget) and
 * the fields still empty; where the hub has no area and IN4 has one, an admin
 * copies it across with one click, and ₹/sft appears everywhere.
 */
export default async function ProjectsMasterPage({ searchParams }: { searchParams: Promise<{ q?: string; view?: string }> }) {
  await requirePermission('cost-control', 'view')
  const { q = '', view } = await searchParams
  const hub = view === 'hub'
  const pills = (
    <ViewPills base="/masters/projects" view={hub ? 'hub' : 'in4'} keep={{ q }} options={[
      { key: 'in4', label: 'IN4 projects' },
      { key: 'hub', label: 'CT Hub registry' },
    ]} />
  )
  if (hub) return <HubRegistry q={q} pills={pills} />

  const { projects, in4, in4Error } = await loadProjectMaster()
  const today = todayIST()

  const needle = q.trim()
  const filtered = needle
    ? projects.map(p => matchesQuery(needle, p.name, p.code)
        ? p
        : { ...p, subs: p.subs.filter(x => matchesQuery(needle, x.name, x.code)) })
      .filter(p => matchesQuery(needle, p.name, p.code) || p.subs.length > 0)
    : projects
  const withWos = filtered.filter(p => p.workOrders > 0)
  const without = filtered.filter(p => p.workOrders === 0)

  const subs = projects.reduce((t, p) => t + p.subs.length, 0)
  const active = projects.reduce((t, p) => t + p.subs.filter(x => x.isActive).length, 0)
  const wos = projects.reduce((t, p) => t + p.workOrders, 0)
  const unlinked = projects.reduce((t, p) => t + p.subs.filter(x => isUnlinked(x)).length, 0)
  const late = projects.reduce((t, p) => t + (isLate(p, today) ? 1 : 0) + p.subs.filter(x => isLate(x, today)).length, 0)

  return (
    <RowDetailProvider>
      <div className="space-y-4">
        <PageHeader
          title="Project Master"
          subtitle="Main projects and their sub-projects, as IN4 holds them — dates, paying trust, site address."
        />
        {pills}
        <In4Note in4={in4} error={in4Error} what="dates, addresses and status" />
        <MasterSearchBox action="/masters/projects" initial={q} placeholder="Search a project or sub-project by name or code…" />

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          <Kpi label="Main projects" value={projects.length} />
          <Kpi label="Sub-projects" value={subs} />
          <Kpi label="Active sub-projects" value={active} />
          <Kpi label="Work orders" value={wos} />
          <Kpi label="Past their end date" value={late} tone={late > 0 ? 'amber' : undefined} />
          <Kpi label="With WOs, not linked in CT Hub" value={unlinked} tone={unlinked > 0 ? 'amber' : undefined} />
        </div>

        {needle && filtered.length === 0 && (
          <p className="rounded-lg border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-500">
            No project or sub-project matches “{needle}”. <Link href={`/masters/search?q=${encodeURIComponent(needle)}`} className="text-indigo-700 hover:underline">Search all masters</Link>.
          </p>
        )}

        {withWos.length > 0 && (
          <section className="rounded-lg border border-gray-200 bg-white">
            <h2 className="px-3 py-2 text-[12px] uppercase tracking-wide text-gray-500 border-b border-gray-100">Projects with work orders · {withWos.length}</h2>
            <div className="divide-y divide-gray-100">
              {withWos.map(p => <ProjectRow key={p.id} p={p} open={!!needle} today={today} />)}
            </div>
          </section>
        )}

        {without.length > 0 && (
          <section className="rounded-lg border border-gray-200 bg-white">
            <div className="px-3 py-2 flex items-center gap-1 text-[12px] uppercase tracking-wide text-gray-500 border-b border-gray-100">
              <RowDetailToggle id="proj:others" count={without.length} label="the other IN4 projects" />
              Other IN4 projects — no work orders · {without.length}
              <span className="ml-auto normal-case tracking-normal text-gray-400 hidden sm:inline">IN4 files the trusts themselves, the warehouse and fixed assets as projects too</span>
            </div>
            <RowDetail id="proj:others">
              <div className="divide-y divide-gray-100">
                {without.map(p => <ProjectRow key={p.id} p={p} open={!!needle} today={today} />)}
              </div>
            </RowDetail>
          </section>
        )}
      </div>
    </RowDetailProvider>
  )
}

/** CT Hub's own project registry, with its IN4 side beside it. */
async function HubRegistry({ q, pills }: { q: string; pills: React.ReactNode }) {
  const [{ rows: projects, in4Unmapped }, canEdit] = await Promise.all([loadHubRegistry(), canEditMasters()])
  const missing = (f: (r: typeof projects[number]) => boolean) => projects.filter(f).length
  const gaps = [
    { label: 'No area', n: missing(r => !r.builtUpSft), sub: `${missing(r => !r.builtUpSft && !!r.in4?.areaFt)} fixable from IN4` },
    { label: 'No IN4 link', n: missing(r => !r.in4) },
    { label: 'No target date', n: missing(r => !r.targetDate) },
    { label: 'No manager', n: missing(r => !r.hasPm) },
  ]
  const miss = { text: 'missing', tone: 'missing' as const }
  const rows: MasterRow[] = projects.map(p => ({
    id: p.id,
    href: `/project/${p.id}`,
    tone: p.filled < 50 ? 'warn' : undefined,
    cells: {
      name: { text: p.name, tone: 'strong', sub: [p.code, p.parent].filter(Boolean).join(' · ') || undefined },
      in4: p.in4
        ? { text: p.in4.subprojects.length === 1 ? p.in4.subprojects[0] : `${p.in4.subprojects.length} sub-projects`, tone: 'muted', sub: p.in4.subprojects.length > 1 ? p.in4.subprojects.join(' · ') : (p.in4.exCodes[0] ?? undefined) }
        : { text: 'not linked', tone: 'missing' },
      area: p.builtUpSft ? { text: formatNumber(p.builtUpSft, 0), sub: 'sft' } : miss,
      in4area: p.in4?.areaFt ? { text: formatNumber(p.in4.areaFt, 0), sub: 'sft in IN4', tone: 'muted' } : { text: '' },
      budget: p.in4?.budget ? { text: formatINR(p.in4.budget), tone: 'muted' } : { text: '' },
      type: p.projectType ? { text: p.projectType, tone: 'muted' } : miss,
      start: p.startDate ? { text: formatDate(p.startDate) } : miss,
      target: p.targetDate ? { text: formatDate(p.targetDate) } : miss,
      filled: { text: `${p.filled}%`, tone: p.filled >= 80 ? 'good' : p.filled >= 50 ? 'warn' : 'missing' },
    },
    action: canEdit && !p.builtUpSft && p.in4?.areaFt ? <UseIn4AreaButton projectId={p.id} sft={p.in4.areaFt} /> : undefined,
  }))
  return (
    <div className="space-y-4">
      <PageHeader title="Project Master" subtitle={`CT Hub’s registry — ${projects.length} live projects, ${projects.filter(p => p.in4).length} linked to IN4 sub-projects.`} />
      {pills}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {gaps.map(g => (
          <div key={g.label} className="rounded-lg border border-gray-200 bg-white px-3 py-2">
            <p className="text-[12px] text-gray-500">{g.label}</p>
            <p className={`text-[15px] font-semibold tabular-nums ${g.n > 0 ? 'text-amber-700' : 'text-gray-900'}`}>{g.n}</p>
            <p className="text-[12px] text-gray-400">{g.sub ?? `of ${projects.length}`}</p>
          </div>
        ))}
      </div>
      {in4Unmapped.length > 0 && (
        <p className="rounded-lg border border-blue-200 bg-blue-50/60 px-3 py-2 text-[12px] text-blue-900">
          <b>{in4Unmapped.length} active IN4 sub-project{in4Unmapped.length === 1 ? ' is' : 's are'} not mapped to any CT Hub project</b> (and not marked “not ours”): {in4Unmapped.map(s => s.name).join(', ')}.
          {' '}Decide each on <Link href="/masters/mapping" className="underline">Name mapping</Link>.
        </p>
      )}
      <MasterTable
        columns={[
          { key: 'name', label: 'Project' },
          { key: 'in4', label: 'IN4 sub-projects' },
          { key: 'area', label: 'Area', align: 'right', width: 'w-24' },
          { key: 'in4area', label: 'IN4 area', align: 'right', width: 'w-24', desktopOnly: true },
          { key: 'budget', label: 'IN4 budget', align: 'right', width: 'w-28', desktopOnly: true },
          { key: 'type', label: 'Type', width: 'w-24', desktopOnly: true },
          { key: 'start', label: 'Start', width: 'w-28' },
          { key: 'target', label: 'Target', width: 'w-28' },
          { key: 'filled', label: 'Filled', align: 'right', width: 'w-20' },
        ]}
        sortableKeys={['name', 'area', 'start', 'target', 'filled']}
        rows={rows}
        filters={[
          { key: 'unlinked', label: 'Not linked to IN4', test: r => r.cells.in4.text === 'not linked' },
          { key: 'no-area', label: 'No area', test: r => r.cells.area.text === 'missing' },
          { key: 'gaps', label: 'Under half filled', test: r => r.tone === 'warn' },
        ]}
        initialQuery={q}
        exportName="ct-hub-projects"
        searchPlaceholder="Search a CT Hub project by name or code…"
        emptyMessage="No projects in CT Hub yet."
      />
    </div>
  )
}

const isLate = (x: { end: string | null; status: string | null } & Partial<Pick<SubProject, 'isActive'>>, today: string) =>
  !!x.end && x.end < today && (x.isActive ?? true) && (x.status == null || x.status === 'Approved')
const isUnlinked = (x: SubProject) => x.isActive && x.workOrders > 0 && x.hubProjects.length === 0

function Kpi({ label, value, tone }: { label: string; value: number; tone?: 'amber' }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
      <p className="text-[12px] text-gray-500">{label}</p>
      <p className={`text-[15px] font-semibold tabular-nums ${tone === 'amber' ? 'text-amber-700' : 'text-gray-900'}`}>{value.toLocaleString('en-IN')}</p>
    </div>
  )
}

const span = (a: string | null, b: string | null) =>
  a || b ? `${a ? formatDate(a) : '…'} → ${b ? formatDate(b) : '…'}` : null

function Tag({ tone, children }: { tone: 'amber' | 'grey' | 'rose'; children: React.ReactNode }) {
  const cls = tone === 'amber' ? 'border-amber-200 bg-amber-50 text-amber-800' : tone === 'rose' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-gray-300 text-gray-500'
  return <span className={`text-[11px] rounded border px-1 ${cls}`}>{children}</span>
}

function SubList({ p, today }: { p: MainProject; today: string }) {
  return (
    <ul className="bg-slate-50/60 border-t border-gray-100 divide-y divide-gray-100">
      {p.subs.map(x => {
        const d = span(x.start, x.end)
        return (
          <li key={x.id} className={`pl-10 pr-3 py-1.5 text-[12px] ${x.isActive ? '' : 'text-gray-400'}`}>
            <p className="flex items-center gap-2 flex-wrap">
              {x.code && <span className="font-mono text-gray-500">{x.code}</span>}
              <span className={x.isActive ? 'font-medium text-gray-900' : 'font-medium'}>{x.name}</span>
              {!x.isActive && <Tag tone="grey">inactive</Tag>}
              {x.status && x.status !== 'Approved' && x.isActive && <Tag tone="amber">{x.status}</Tag>}
              {isLate(x, today) && <Tag tone="amber">end date passed</Tag>}
              {isUnlinked(x) && <Link href="/masters/mapping" className="text-[11px] rounded border border-rose-200 bg-rose-50 text-rose-800 px-1 hover:underline">not linked to a CT Hub project</Link>}
              <span className="ml-auto tabular-nums text-gray-500">{x.workOrders.toLocaleString('en-IN')} WO{x.workOrders === 1 ? '' : 's'}</span>
            </p>
            <p className="text-gray-500 flex flex-wrap gap-x-3">
              {d && <span>{d}</span>}
              {x.hubProjects.length > 0 && <span>CT Hub: {x.hubProjects.join(', ')}</span>}
            </p>
          </li>
        )
      })}
      {p.subs.length === 0 && <li className="pl-10 pr-3 py-1.5 text-[12px] text-gray-500 italic">IN4 holds no sub-project under this project.</li>}
    </ul>
  )
}

function ProjectRow({ p, open, today }: { p: MainProject; open: boolean; today: string }) {
  const dates = span(p.start, p.end)
  return (
    <div id={`p-${p.id}`}>
      <div className="px-3 py-2 flex items-start gap-1 text-[13px]">
        {open ? <span className="inline-block h-5 w-5 mr-1" aria-hidden /> : <RowDetailToggle id={`proj:${p.id}`} count={p.subs.length} label="sub-projects" />}
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 flex-wrap">
            {p.code && <span className="font-mono text-[12px] text-gray-500">{p.code}</span>}
            <span className="font-semibold text-gray-900">{p.name}</span>
            {p.trustCode && <span className="font-mono text-[11px] text-indigo-800 bg-indigo-50 border border-indigo-100 rounded px-1" title={p.trustName ?? undefined}>{p.trustCode}</span>}
            {p.status && p.status !== 'Approved' && <Tag tone="amber">{p.status}</Tag>}
            {isLate(p, today) && <Tag tone="amber">end date passed</Tag>}
          </p>
          <p className="text-[12px] text-gray-500 mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
            {dates && <span>{dates}</span>}
            <span>{p.subs.length} sub-project{p.subs.length === 1 ? '' : 's'}</span>
            <span>{p.workOrders.toLocaleString('en-IN')} WO{p.workOrders === 1 ? '' : 's'}</span>
            {p.hubProjects.length > 0 && <span>CT Hub: {p.hubProjects.join(', ')}</span>}
          </p>
          {p.address && <p className="text-[12px] text-gray-600 mt-0.5">{p.address}{p.city || p.pin ? ` · ${[p.city, p.pin].filter(Boolean).join(' ')}` : ''}</p>}
        </div>
      </div>
      {open ? <SubList p={p} today={today} /> : <RowDetail id={`proj:${p.id}`}><SubList p={p} today={today} /></RowDetail>}
    </div>
  )
}
