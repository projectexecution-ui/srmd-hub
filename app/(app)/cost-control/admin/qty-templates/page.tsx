import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requirePermission, can } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Plus, Calculator } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function QtyTemplatesListPage() {
  const perms = await requirePermission('cost-control', 'admin')
  const canEdit = can(perms, 'cost-control', 'admin')
  const supabase = await createClient()

  const { data: templates } = await supabase
    .from('cc_qty_templates')
    .select('*')
    .order('is_seed', { ascending: false })
    .order('scope')
    .order('name')

  const { data: disciplines } = await supabase.from('cc_disciplines').select('id, code, name')
  const { data: subSkills } = await supabase.from('cc_sub_skills').select('id, code, name')
  const discById = new Map((disciplines ?? []).map(d => [d.id, `${d.code} ${d.name}`]))
  const ssById = new Map((subSkills ?? []).map(s => [s.id, `${s.code} ${s.name}`]))

  function describeScope(t: {
    scope: 'global' | 'discipline' | 'sub_skill'
    scope_id: string | null
  }): string {
    if (t.scope === 'global') return 'All disciplines'
    if (t.scope === 'discipline') return discById.get(t.scope_id ?? '') ?? '— discipline —'
    return ssById.get(t.scope_id ?? '') ?? '— sub-skill —'
  }

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <PageHeader
        title="Quantification Templates"
        subtitle="Reusable measurement shapes engineers pick when starting a working — columns + formula + default unit"
        back="/cost-control"
      >
        {canEdit && (
          <Link href="/cost-control/admin/qty-templates/new">
            <Button size="sm">
              <Plus className="h-4 w-4" /> New template
            </Button>
          </Link>
        )}
      </PageHeader>

      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Name</th>
                <th className="text-left px-3 py-2 font-medium">Scope</th>
                <th className="text-left px-3 py-2 font-medium">Columns</th>
                <th className="text-left px-3 py-2 font-medium">Formula</th>
                <th className="text-left px-3 py-2 font-medium">Default unit</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(templates ?? []).map(t => (
                <tr key={t.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/cost-control/admin/qty-templates/${t.id}`}
                      className="font-medium text-gray-900 hover:text-blue-700"
                    >
                      {t.name}
                    </Link>
                    {t.is_seed && (
                      <Badge variant="secondary" className="ml-2 text-[10px]">
                        Seed
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-gray-700 text-xs">{describeScope(t)}</td>
                  <td className="px-3 py-2.5 text-gray-600 text-xs">
                    {(t.columns as { label: string }[]).map(c => c.label).join(' · ') || '—'}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs text-gray-700">
                    {t.formula ?? <span className="text-gray-400 italic">manual qty</span>}
                  </td>
                  <td className="px-3 py-2.5 text-gray-700">{t.default_unit}</td>
                  <td className="px-3 py-2.5">
                    {t.is_active ? (
                      <Badge variant="default">Active</Badge>
                    ) : (
                      <Badge variant="secondary">Disabled</Badge>
                    )}
                  </td>
                </tr>
              ))}
              {(!templates || templates.length === 0) && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-gray-500">
                    <Calculator className="h-8 w-8 mx-auto text-gray-300 mb-2" />
                    <div className="text-sm">No templates yet.</div>
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
