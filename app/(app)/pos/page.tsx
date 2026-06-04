import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { QueryError } from '@/components/ui/query-error'
import { FileText } from 'lucide-react'
import { formatDate, formatINR } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export default async function POsPage({
  searchParams,
}: {
  searchParams: Promise<{ vendor?: string; project?: string; status?: string }>
}) {
  await requirePermission('pos', 'view')
  const sp = await searchParams
  const supabase = await createClient()

  let query = supabase
    .from('purchase_orders')
    .select('id, po_no, po_date, po_amount, vendors(id, name), projects(id, code), po_lines(count)')
    .order('po_date', { ascending: false })
    .limit(300)

  if (sp.vendor) query = query.eq('vendor_id', sp.vendor)
  if (sp.project) query = query.eq('project_id', sp.project)

  const { data: pos, error: posError } = await query
  const { data: vendors } = await supabase.from('vendors').select('id, name').order('name')
  const { data: projects } = await supabase.from('projects').select('id, code, name').order('code')

  // status filter (client-derived via po_no startswith)
  const filtered = sp.status === 'draft'
    ? pos?.filter(p => p.po_no?.startsWith('DRAFT-'))
    : sp.status === 'issued'
    ? pos?.filter(p => !p.po_no?.startsWith('DRAFT-'))
    : pos

  const total = filtered?.reduce((sum, p) => sum + Number(p.po_amount ?? 0), 0) ?? 0

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Purchase Orders"
        subtitle={`${filtered?.length ?? 0} PO${filtered?.length === 1 ? '' : 's'} · ${formatINR(total)}`}
      />

      {posError && <QueryError what="purchase orders" message={posError.message} />}

      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <FilterChip href="/pos" label="All" active={!sp.status} />
        <FilterChip href="/pos?status=issued" label="Issued" active={sp.status === 'issued'} />
        <FilterChip href="/pos?status=draft" label="Draft" active={sp.status === 'draft'} />
        <form action="/pos" method="get" className="w-full sm:w-auto sm:ml-auto flex items-center gap-2 flex-wrap">
          {sp.status && <input type="hidden" name="status" value={sp.status} />}
          <select
            name="project"
            defaultValue={sp.project ?? ''}
            className="h-8 rounded-xl border border-gray-300 bg-white px-2 text-xs text-gray-700 w-full sm:w-auto min-w-0"
          >
            <option value="">All projects</option>
            {projects?.map(p => <option key={p.id} value={p.id}>{p.code}</option>)}
          </select>
          <select
            name="vendor"
            defaultValue={sp.vendor ?? ''}
            className="h-8 rounded-xl border border-gray-300 bg-white px-2 text-xs text-gray-700 w-full sm:w-auto sm:max-w-[200px] min-w-0"
          >
            <option value="">All vendors</option>
            {vendors?.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <button className="h-8 px-3 rounded-xl bg-gray-100 hover:bg-gray-200 text-xs font-semibold text-gray-700 w-full sm:w-auto">Apply</button>
        </form>
      </div>

      <Card className="overflow-hidden">
        {filtered && filtered.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">PO No.</th>
                  <th className="px-4 py-3 font-semibold">Date</th>
                  <th className="px-4 py-3 font-semibold">Vendor</th>
                  <th className="px-4 py-3 font-semibold">Project</th>
                  <th className="px-4 py-3 font-semibold text-right">Lines</th>
                  <th className="px-4 py-3 font-semibold text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p: { id: string; po_no: string; po_date: string; po_amount: number; vendors: { name: string } | { name: string }[] | null; projects: { code: string } | { code: string }[] | null; po_lines: { count: number }[] }) => {
                  const v = Array.isArray(p.vendors) ? p.vendors[0] : p.vendors
                  const proj = Array.isArray(p.projects) ? p.projects[0] : p.projects
                  const isDraft = p.po_no?.startsWith('DRAFT-')
                  return (
                    <tr key={p.id} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <Link href={`/pos/${p.id}`} className="font-semibold text-blue-700 hover:underline inline-flex items-center gap-2">
                          {isDraft && <Badge variant="warning" className="text-[10px]">Draft</Badge>}
                          {p.po_no}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-700">{formatDate(p.po_date)}</td>
                      <td className="px-4 py-3 text-gray-700 max-w-[260px] truncate">{v?.name || '—'}</td>
                      <td className="px-4 py-3 text-gray-700">{proj?.code || '—'}</td>
                      <td className="px-4 py-3 text-gray-700 text-right tabular-nums">{p.po_lines?.[0]?.count ?? 0}</td>
                      <td className="px-4 py-3 font-semibold text-gray-900 text-right tabular-nums">{formatINR(p.po_amount)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={<FileText className="h-10 w-10" />} title="No POs found" />
        )}
      </Card>
    </div>
  )
}

function FilterChip({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={
        'inline-flex items-center px-3 h-8 rounded-full text-xs font-semibold transition-colors ' +
        (active ? 'bg-blue-600 text-white' : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50')
      }
    >
      {label}
    </Link>
  )
}
