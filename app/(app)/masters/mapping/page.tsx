import Link from 'next/link'
import { requirePermission } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/PageHeader'
import { formatINR } from '@/lib/utils'
import { matchSubProjects, clean, type HubProject } from '@/lib/revamp/subproject-match'
import { PROJECT_ALIASES, DELIBERATELY_UNMAPPED } from '@/lib/revamp/alias-seed'

export const dynamic = 'force-dynamic'

/**
 * Why a project's Reports or Indent → PO tab is empty — answered on one page.
 *
 * IN4 names a sub-project "<Project> <Stage>" and spells the project its own
 * way. Nothing links those names to a hub project, so money can only be
 * attributed by matching text. This shows every sub-project, what it matched
 * (and how), what it did not, and how much money is sitting on each side.
 */
export default async function MappingPage() {
  await requirePermission('cost-control', 'view')
  const supabase = await createClient()

  const [cRes, sRes, pRes] = await Promise.all([
    supabase.from('contractor_report_state').select('state').limit(1).maybeSingle(),
    supabase.from('supplier_report_state').select('state').limit(1).maybeSingle(),
    supabase.from('projects').select('id, code, name').is('archived_at', null),
  ])

  const projects = (pRes.data ?? []) as HubProject[]
  const projName = new Map(projects.map(p => [p.id, `${p.code ? `${p.code} · ` : ''}${p.name}`]))

  // Sub-project → billed money, across both reports.
  const money = new Map<string, number>()
  for (const [state, partyKey] of [[cRes.data?.state, 'contractors'], [sRes.data?.state, 'suppliers']] as const) {
    const reports = (state as { reports?: unknown })?.reports
    for (const rep of (Array.isArray(reports) ? reports : []) as Array<Record<string, unknown>>) {
      for (const sp of (Array.isArray(rep.subprojects) ? rep.subprojects : []) as Array<Record<string, unknown>>) {
        const name = clean(String(sp.name ?? ''))
        if (!name) continue
        let sum = money.get(name) ?? 0
        for (const cat of (Array.isArray(sp.categories) ? sp.categories : []) as Array<Record<string, unknown>>) {
          for (const p of (Array.isArray(cat[partyKey]) ? cat[partyKey] : []) as Array<Record<string, unknown>>) {
            const v = p.billValue
            if (typeof v === 'number' && Number.isFinite(v)) sum += v
          }
        }
        money.set(name, sum)
      }
    }
  }

  const matches = matchSubProjects([...money.keys()], projects, PROJECT_ALIASES)
  const matched = matches.filter(m => m.projectId)
  const unmatched = matches.filter(m => !m.projectId)
  const billFor = (n: string) => money.get(n) ?? 0
  const sum = (list: typeof matches) => list.reduce((s, m) => s + billFor(m.subProjectName), 0)

  const viaCount = (v: string) => matched.filter(m => m.via === v).length
  const unmappedReason = new Map(DELIBERATELY_UNMAPPED.map(u => [u.in4.toLowerCase(), u.why]))

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <PageHeader
        title="Project name mapping"
        back="/masters"
        subtitle="Why a project's Reports or Indent → PO tab shows what it shows."
      />

      <div className="rounded-lg border border-gray-200 bg-gray-50/70 px-4 py-3">
        <p className="text-xs text-gray-600">
          IN4 writes a sub-project as <b>&ldquo;Project — Stage&rdquo;</b> and spells the project its own way.
          Nothing links those names to a project in CT Hub, so the money can only be attributed by
          matching text. Matched money appears on that project&apos;s Reports tab; unmatched money is
          held here rather than guessed onto a project.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Matched" value={String(matched.length)} sub={formatINR(sum(matched))} good />
        <Stat label="Not matched" value={String(unmatched.length)} sub={formatINR(sum(unmatched))} warn />
        <Stat label="By name / code" value={String(viaCount('name') + viaCount('code'))} sub="automatic" />
        <Stat label="By stated alias" value={String(viaCount('alias'))} sub="built in for the trial" />
      </div>

      <Section
        title={`Matched — ${matched.length}`}
        hint="These land on their project's Reports tab."
      >
        {matched
          .sort((a, b) => billFor(b.subProjectName) - billFor(a.subProjectName))
          .map(m => (
            <Row
              key={m.subProjectName}
              left={m.subProjectName}
              right={projName.get(m.projectId!) ?? '—'}
              money={billFor(m.subProjectName)}
              tag={m.via === 'alias' ? 'alias' : 'automatic'}
              tagTone={m.via === 'alias' ? 'indigo' : 'gray'}
              href={`/project/${m.projectId}/reports`}
            />
          ))}
      </Section>

      <Section
        title={`Not matched — ${unmatched.length}`}
        hint="Held here on purpose. Each attaches on its own once its project exists or its name is confirmed."
        warn
      >
        {unmatched
          .sort((a, b) => billFor(b.subProjectName) - billFor(a.subProjectName))
          .map(m => (
            <Row
              key={m.subProjectName}
              left={m.subProjectName}
              right={unmappedReason.get(m.base.toLowerCase()) ?? 'No project in CT Hub with this name'}
              money={billFor(m.subProjectName)}
              tag={m.stage ?? 'no stage'}
              tagTone="gray"
            />
          ))}
      </Section>

      <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
        <h2 className="text-sm font-bold text-gray-900">The aliases built in for this trial</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Stated one by one, with a reason each. Anything ambiguous was deliberately left out rather
          than guessed — a wrong alias moves real money onto the wrong building.
        </p>
        <ul className="mt-2 space-y-1.5">
          {PROJECT_ALIASES.map(a => (
            <li key={a.in4} className="text-xs flex flex-wrap items-baseline gap-x-2">
              <span className="font-mono text-gray-700">{a.in4}</span>
              <span className="text-gray-400">→</span>
              <span className="font-semibold text-gray-900">{a.hub}</span>
              <span className={`rounded px-1.5 py-0.5 text-[10px] ${
                a.confidence === 'certain' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
              }`}>{a.confidence}</span>
              <span className="text-gray-500 basis-full sm:basis-auto">{a.why}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function Stat({ label, value, sub, good, warn }: {
  label: string; value: string; sub: string; good?: boolean; warn?: boolean
}) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${
      warn ? 'border-amber-200 bg-amber-50/70' : good ? 'border-emerald-200 bg-emerald-50/60' : 'border-gray-200 bg-white'
    }`}>
      <p className="text-[10px] uppercase tracking-wide font-semibold text-gray-500">{label}</p>
      <p className="text-base font-bold tabular-nums mt-0.5 text-gray-900">{value}</p>
      <p className="text-[11px] text-gray-500 tabular-nums">{sub}</p>
    </div>
  )
}

function Section({ title, hint, warn, children }: {
  title: string; hint: string; warn?: boolean; children: React.ReactNode
}) {
  return (
    <details open className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <summary className="px-4 py-2.5 cursor-pointer list-none [&::-webkit-details-marker]:hidden border-b border-gray-100">
        <span className={`text-sm font-bold ${warn ? 'text-amber-900' : 'text-gray-900'}`}>{title}</span>
        <span className="block text-[11px] text-gray-500">{hint}</span>
      </summary>
      <div className="divide-y divide-gray-100">{children}</div>
    </details>
  )
}

function Row({ left, right, money, tag, tagTone, href }: {
  left: string; right: string; money: number; tag: string
  tagTone: 'indigo' | 'gray'; href?: string
}) {
  const body = (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5">
      <span className="min-w-0">
        <span className="block text-sm text-gray-900 truncate">{left}</span>
        <span className="block text-[11px] text-gray-500 truncate">{right}</span>
      </span>
      <span className="flex items-center gap-2.5 flex-shrink-0">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
          tagTone === 'indigo' ? 'bg-indigo-50 text-indigo-700' : 'bg-gray-100 text-gray-600'
        }`}>{tag}</span>
        <span className="tabular-nums text-sm text-gray-900">{money > 0 ? formatINR(money) : '—'}</span>
      </span>
    </div>
  )
  return href ? <Link href={href} className="block hover:bg-gray-50">{body}</Link> : body
}
