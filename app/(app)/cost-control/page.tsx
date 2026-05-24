import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requirePermission, can, getMyUser } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Calculator, Plus, FileText, Clock, Inbox, Upload, ClipboardList, Settings, ArrowRight } from 'lucide-react'
import { formatINR } from '@/lib/utils'

export const dynamic = 'force-dynamic'

type CCProject = {
  id: string
  code: string
  name: string
  cc_status: string | null
  setup_progress_pct: number | null
  built_up_sft: number | null
  parent_project_id: string | null
}

export default async function CostControlLandingPage() {
  const perms = await requirePermission('cost-control', 'view')
  const canWrite = can(perms, 'cost-control', 'edit')
  const canAdmin = can(perms, 'cost-control', 'admin')
  const supabase = await createClient()
  const user = await getMyUser()

  const [projectsRes, wsAllRes, myDraftsRes, pendingRes] = await Promise.all([
    supabase
      .from('projects')
      .select('id, code, name, cc_status, setup_progress_pct, built_up_sft, parent_project_id')
      .not('cc_status', 'is', null)
      .order('code'),
    supabase.from('cc_working_sheets').select('id, status, total_amount, project_id'),
    user
      ? supabase
          .from('cc_working_sheets')
          .select('id', { count: 'exact', head: true })
          .eq('engineer_id', user.id)
          .in('status', ['draft', 'returned'])
      : Promise.resolve({ count: 0 }),
    supabase
      .from('cc_working_sheets')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'submitted'),
  ])

  const ccProjects = (projectsRes.data ?? []) as CCProject[]
  const incompleteCount = ccProjects.filter(p => (p.setup_progress_pct ?? 0) < 100).length

  type WSRollup = { id: string; status: string; total_amount: number | null; project_id: string }
  const ws = (wsAllRes.data ?? []) as WSRollup[]
  const wsByProject = new Map<string, number>()
  for (const w of ws) {
    wsByProject.set(w.project_id, (wsByProject.get(w.project_id) ?? 0) + 1)
  }
  const totalWS = ws.length
  const approvedTotal = ws.filter(w => w.status === 'approved' || w.status === 'wo_issued' || w.status === 'paid')
    .reduce((s, w) => s + Number(w.total_amount ?? 0), 0)
  const myDraftsCount = (myDraftsRes as { count?: number }).count ?? 0
  const pendingCount = (pendingRes as { count?: number }).count ?? 0

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      <PageHeader
        title="Cost Control"
        subtitle={`SRASSK — ${ccProjects.length} project${ccProjects.length === 1 ? '' : 's'}${incompleteCount ? ` · ${incompleteCount} need setup` : ''}`}
      >
        <Button asChild size="sm" variant="outline">
          <Link href="/cost-control/working-sheets">
            <FileText className="h-4 w-4" /> All Working Sheets
          </Link>
        </Button>
        {canWrite && (
          <Button asChild size="sm">
            <Link href="/cost-control/projects/new"><Plus className="h-4 w-4" /> New Project</Link>
          </Button>
        )}
      </PageHeader>

      {/* Stat strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Projects" value={ccProjects.length} hint={incompleteCount ? `${incompleteCount} need setup` : 'all set up'} icon={<Calculator className="h-5 w-5" />} />
        <Link href="/cost-control/approvals" className="block">
          <Stat
            label="Pending approvals"
            value={pendingCount}
            hint={pendingCount > 0 ? 'submitted, awaiting head' : 'all clear'}
            icon={<Inbox className="h-5 w-5" />}
            tone={pendingCount > 0 ? 'amber' : 'default'}
          />
        </Link>
        <Link href="/cost-control/working-sheets" className="block">
          <Stat label="Your drafts" value={myDraftsCount} hint="draft + returned to you" icon={<Clock className="h-5 w-5" />} />
        </Link>
        <Stat label="Approved value" value={formatINR(approvedTotal)} hint={`${totalWS} sheet${totalWS === 1 ? '' : 's'} total`} icon={<FileText className="h-5 w-5" />} />
      </div>

      {/* Quick actions */}
      <Card className="p-4">
        <h3 className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-3">Tools</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <QuickAction
            href="/cost-control/approvals"
            label="Approvals inbox"
            hint={pendingCount > 0 ? `${pendingCount} pending` : 'all clear'}
            icon={<Inbox className="h-4 w-4" />}
            highlight={pendingCount > 0}
          />
          {canWrite && (
            <QuickAction
              href="/cost-control/import"
              label="Import Excel budget"
              hint="bulk-load ENGG report"
              icon={<Upload className="h-4 w-4" />}
            />
          )}
          <QuickAction
            href="/cost-control/audit"
            label="Audit log"
            hint="every edit & event"
            icon={<ClipboardList className="h-4 w-4" />}
          />
          {canAdmin && (
            <QuickAction
              href="/cost-control/admin/qty-templates"
              label="Quantification templates"
              hint="manage measurement shapes"
              icon={<Settings className="h-4 w-4" />}
            />
          )}
        </div>
      </Card>

      {projectsRes.error && (
        <Card className="border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">Cost Control tables not yet applied to the database.</p>
          <p className="mt-1">Run the migrations in <code>supabase/migrations/20260523_cost_control_*.sql</code> first.</p>
        </Card>
      )}

      {ccProjects.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {ccProjects.map(p => {
            const pct = p.setup_progress_pct ?? 0
            const isIncomplete = pct < 100
            const wsHere = wsByProject.get(p.id) ?? 0
            return (
              <Link key={p.id} href={`/cost-control/projects/${p.id}`}>
                <Card className="hover:shadow-md transition-shadow h-full">
                  <div className="p-5">
                    <div className="flex items-start justify-between mb-2">
                      <span className="text-xs font-mono font-bold text-indigo-700">{p.code}</span>
                      {p.cc_status && (
                        <Badge variant={p.cc_status === 'active' ? 'success' : 'secondary'}>
                          {p.cc_status.replace('_', ' ')}
                        </Badge>
                      )}
                    </div>
                    <h3 className="font-semibold text-gray-900">{p.name}</h3>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-xs text-gray-500">
                      {p.built_up_sft != null && <span>{p.built_up_sft.toLocaleString('en-IN')} Sft</span>}
                      <span>· {wsHere} WS</span>
                    </div>
                    {isIncomplete && (
                      <div className="mt-3">
                        <div className="flex items-center justify-between text-xs text-amber-700 mb-1">
                          <span>Setup {pct}% complete</span>
                          <span>{100 - pct}% remaining</span>
                        </div>
                        <div className="h-1.5 bg-amber-100 rounded-full overflow-hidden">
                          <div className="h-full bg-amber-500" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    )}
                  </div>
                </Card>
              </Link>
            )
          })}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={<Calculator className="h-10 w-10" />}
            title="No Cost Control projects yet"
            description="Start a new project to track Working Sheets, budgets, and approvals."
            action={canWrite ? <Button asChild size="sm"><Link href="/cost-control/projects/new">Create first project</Link></Button> : null}
          />
        </Card>
      )}
    </div>
  )
}

function QuickAction({
  href,
  label,
  hint,
  icon,
  highlight = false,
}: {
  href: string
  label: string
  hint?: string
  icon: React.ReactNode
  highlight?: boolean
}) {
  return (
    <Link
      href={href}
      className={`group flex items-center gap-2 p-3 rounded-lg border transition-colors ${
        highlight
          ? 'border-amber-200 bg-amber-50 hover:bg-amber-100'
          : 'border-gray-200 bg-white hover:bg-gray-50 hover:border-gray-300'
      }`}
    >
      <div
        className={`p-1.5 rounded-md ${
          highlight ? 'bg-amber-100 text-amber-700' : 'bg-indigo-50 text-indigo-700'
        }`}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-900 truncate">{label}</div>
        {hint && <div className="text-[10px] text-gray-500 truncate">{hint}</div>}
      </div>
      <ArrowRight className="h-3.5 w-3.5 text-gray-300 group-hover:text-gray-500 shrink-0" />
    </Link>
  )
}

function Stat({ label, value, hint, icon, tone = 'default' }: { label: string; value: React.ReactNode; hint?: string; icon?: React.ReactNode; tone?: 'default' | 'amber' }) {
  const wrap = tone === 'amber' ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-white'
  const iconWrap = tone === 'amber' ? 'bg-amber-100 text-amber-700' : 'bg-indigo-50 text-indigo-700'
  return (
    <div className={`rounded-xl border ${wrap} p-4`}>
      <div className="flex items-center gap-3">
        {icon && <div className={`p-2 rounded-lg ${iconWrap}`}>{icon}</div>}
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
          <p className="text-lg font-bold text-gray-900 truncate">{value}</p>
          {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
        </div>
      </div>
    </div>
  )
}
