import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { StatPill } from '@/components/ui/stat-pill'
import { BarChart3, FileText, Receipt, Wallet, ExternalLink } from 'lucide-react'
import { formatINR } from '@/lib/utils'

export const dynamic = 'force-dynamic'

type Project = { id: string; code: string; name: string; description: string | null; status: string | null }

export default async function BudgetPage() {
  await requirePermission('budget-vs-actual', 'view')
  const supabase = await createClient()

  // Pull what's actually in the DB. Budgets per project aren't stored anywhere
  // today (the old Budget Hub kept that in browser localStorage), so we derive
  // committed/invoiced/paid from POs, invoices, and payments. When you start
  // using Cost Control, its budget rows will plug in here too.
  const [projectsRes, posRes, invoicesRes, paymentsRes] = await Promise.all([
    supabase.from('projects').select('id, code, name, description, status').order('code'),
    supabase.from('purchase_orders').select('project_id, po_amount'),
    supabase.from('invoices').select('po_id, invoice_amount, purchase_orders(project_id)'),
    supabase.from('payments').select('amount, invoices(po_id, purchase_orders(project_id))'),
  ])

  const projects = (projectsRes.data ?? []) as Project[]

  // Aggregate per project
  const byProject = new Map<string, { committed: number; invoiced: number; paid: number }>()
  for (const p of projects) byProject.set(p.id, { committed: 0, invoiced: 0, paid: 0 })

  for (const po of posRes.data ?? []) {
    if (po.project_id && byProject.has(po.project_id)) {
      byProject.get(po.project_id)!.committed += Number(po.po_amount ?? 0)
    }
  }

  type InvRow = { invoice_amount: number; purchase_orders: { project_id: string } | { project_id: string }[] | null }
  for (const inv of (invoicesRes.data ?? []) as InvRow[]) {
    const po = Array.isArray(inv.purchase_orders) ? inv.purchase_orders[0] : inv.purchase_orders
    if (po?.project_id && byProject.has(po.project_id)) {
      byProject.get(po.project_id)!.invoiced += Number(inv.invoice_amount ?? 0)
    }
  }

  type PayRow = {
    amount: number
    invoices: {
      purchase_orders: { project_id: string } | { project_id: string }[] | null
    } | {
      purchase_orders: { project_id: string } | { project_id: string }[] | null
    }[] | null
  }
  for (const pay of (paymentsRes.data ?? []) as PayRow[]) {
    const inv = Array.isArray(pay.invoices) ? pay.invoices[0] : pay.invoices
    const po = inv ? (Array.isArray(inv.purchase_orders) ? inv.purchase_orders[0] : inv.purchase_orders) : null
    if (po?.project_id && byProject.has(po.project_id)) {
      byProject.get(po.project_id)!.paid += Number(pay.amount ?? 0)
    }
  }

  const portfolioTotals = Array.from(byProject.values()).reduce(
    (acc, v) => ({ committed: acc.committed + v.committed, invoiced: acc.invoiced + v.invoiced, paid: acc.paid + v.paid }),
    { committed: 0, invoiced: 0, paid: 0 },
  )

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      <PageHeader
        title="Budget vs Actual"
        subtitle="Portfolio committed/invoiced/paid — derived from POs, invoices, payments"
      >
        <Link
          href="/budget-hub.html"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600 hover:text-gray-900 px-3 h-8 rounded-md hover:bg-gray-100"
          title="Legacy Budget Hub — localStorage-based, supports JSON backup/restore"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Legacy Budget Hub
        </Link>
      </PageHeader>

      <Card className="border-blue-100 bg-blue-50/50 p-4 text-xs text-blue-900">
        <p className="font-semibold mb-1">About this view</p>
        <p>
          Project-level budget allocations weren&apos;t stored in the database in the old Budget Hub —
          that page kept everything in browser localStorage. This new view derives committed/invoiced/paid
          figures from your real POs, invoices, and payments. The Cost Control module (in development) will
          add explicit budget lines and a full event log on top.
        </p>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <StatPill
          label="Committed (PO total)"
          value={formatINR(portfolioTotals.committed)}
          icon={<FileText className="h-5 w-5" />}
          hint={`Across ${projects.length} project${projects.length === 1 ? '' : 's'}`}
        />
        <StatPill
          label="Invoiced"
          value={formatINR(portfolioTotals.invoiced)}
          icon={<Receipt className="h-5 w-5" />}
          hint={portfolioTotals.committed > 0 ? `${Math.round((portfolioTotals.invoiced / portfolioTotals.committed) * 100)}% of committed` : '—'}
        />
        <StatPill
          label="Paid"
          value={formatINR(portfolioTotals.paid)}
          icon={<Wallet className="h-5 w-5" />}
          hint={portfolioTotals.invoiced > 0 ? `${Math.round((portfolioTotals.paid / portfolioTotals.invoiced) * 100)}% of invoiced` : '—'}
        />
      </div>

      <Card className="overflow-hidden">
        {projects.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Project</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold text-right">Committed</th>
                  <th className="px-4 py-3 font-semibold text-right">Invoiced</th>
                  <th className="px-4 py-3 font-semibold text-right">Paid</th>
                  <th className="px-4 py-3 font-semibold text-right">Inv. %</th>
                </tr>
              </thead>
              <tbody>
                {projects.map(p => {
                  const t = byProject.get(p.id) ?? { committed: 0, invoiced: 0, paid: 0 }
                  const invPct = t.committed > 0 ? (t.invoiced / t.committed) * 100 : 0
                  const ragTone =
                    invPct > 95 ? 'bg-red-100 text-red-800' :
                    invPct > 80 ? 'bg-amber-100 text-amber-800' :
                    invPct > 0  ? 'bg-green-100 text-green-800' :
                                  'bg-gray-100 text-gray-500'
                  return (
                    <tr key={p.id} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <Link href={`/projects/${p.id}`} className="hover:underline">
                          <span className="font-mono text-xs text-blue-700 mr-2">{p.code}</span>
                          <span className="text-gray-700">{p.name}</span>
                        </Link>
                      </td>
                      <td className="px-4 py-3">{p.status && <Badge variant={p.status === 'active' ? 'success' : 'secondary'}>{p.status}</Badge>}</td>
                      <td className="px-4 py-3 font-semibold text-gray-900 text-right tabular-nums">{formatINR(t.committed)}</td>
                      <td className="px-4 py-3 text-gray-700 text-right tabular-nums">{formatINR(t.invoiced)}</td>
                      <td className="px-4 py-3 text-gray-700 text-right tabular-nums">{formatINR(t.paid)}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-semibold ${ragTone}`}>
                          {invPct.toFixed(0)}%
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={<BarChart3 className="h-10 w-10" />} title="No projects yet" />
        )}
      </Card>
    </div>
  )
}
