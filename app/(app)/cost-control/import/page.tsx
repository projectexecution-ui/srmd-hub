import { createClient } from '@/lib/supabase/server'
import { requirePermission, can } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Upload, FileSpreadsheet } from 'lucide-react'
import { ImportClient } from './ImportClient'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function CostControlImportPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>
}) {
  const perms = await requirePermission('cost-control', 'edit')
  const canImport = can(perms, 'cost-control', 'edit')
  const supabase = await createClient()
  const sp = await searchParams

  const [{ data: projects }, { data: imports }] = await Promise.all([
    supabase.from('projects').select('id, code, name, cc_status').order('code'),
    supabase
      .from('cc_excel_imports')
      .select('id, filename, lines_found, lines_imported, lines_skipped, import_status, created_at, project_id, projects(code, name)')
      .order('created_at', { ascending: false })
      .limit(20),
  ])

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <PageHeader
        title="Import Excel budget"
        subtitle="Drag-drop a budget spreadsheet (.xlsx) — auto-detect columns, preview, commit to a project"
        back="/cost-control"
      />

      {/* Highlight the BPH path — most PMs already upload weekly to /budget,
          so this is usually the better option than re-uploading the Excel. */}
      <Link
        href="/cost-control/import/bph"
        className="block rounded-lg border border-teal-300 bg-teal-50 px-4 py-3 hover:bg-teal-100 transition-colors"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-teal-900 inline-flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4" />
              Already uploaded to BPH this week? Pull from there instead.
            </p>
            <p className="text-xs text-teal-800/90 mt-0.5">
              Reuse your weekly /budget upload. Map BPH project → CT Hub project, click commit. No double-upload.
            </p>
          </div>
          <ArrowRight className="h-4 w-4 text-teal-700" />
        </div>
      </Link>

      {canImport ? (
        <ImportClient
          defaultProjectId={sp.project ?? ''}
          projects={(projects ?? []).map(p => ({
            id: p.id,
            code: p.code,
            name: p.name,
            cc_status: p.cc_status,
          }))}
        />
      ) : (
        <Card className="p-5 border-amber-200 bg-amber-50 text-sm text-amber-900">
          You need <b>edit</b> permission on cost-control to import budgets.
        </Card>
      )}

      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">Recent imports</h3>
          <span className="text-xs text-gray-500">{(imports ?? []).length} entries</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="text-left px-4 py-2 font-medium">File</th>
                <th className="text-left px-3 py-2 font-medium">Project</th>
                <th className="text-right px-3 py-2 font-medium">Found</th>
                <th className="text-right px-3 py-2 font-medium">Imported</th>
                <th className="text-right px-3 py-2 font-medium">Skipped</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="text-left px-3 py-2 font-medium">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(imports ?? []).map(imp => {
                const projRaw = (imp as unknown as { projects: { code: string; name: string } | { code: string; name: string }[] | null }).projects
                const proj = Array.isArray(projRaw) ? projRaw[0] : projRaw
                return (
                  <tr key={imp.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2 text-gray-900 text-sm">
                      <FileSpreadsheet className="h-3.5 w-3.5 text-gray-400 inline mr-1" />
                      {imp.filename}
                    </td>
                    <td className="px-3 py-2 text-gray-700 text-xs">
                      {proj ? `${proj.code} — ${proj.name}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-700">{imp.lines_found ?? 0}</td>
                    <td className="px-3 py-2 text-right text-green-700 font-semibold">{imp.lines_imported ?? 0}</td>
                    <td className="px-3 py-2 text-right text-amber-700">{imp.lines_skipped ?? 0}</td>
                    <td className="px-3 py-2">
                      <Badge variant={imp.import_status === 'committed' ? 'default' : 'secondary'}>
                        {imp.import_status}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-gray-500 text-xs">
                      {imp.created_at ? new Date(imp.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                    </td>
                  </tr>
                )
              })}
              {(!imports || imports.length === 0) && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-gray-500">
                    <Upload className="h-8 w-8 mx-auto text-gray-300 mb-2" />
                    <div className="text-sm">No imports yet — drop your first ENGG_CONSOLIDATED_BUDGET_REPORT above.</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
