import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { TemplateEditor } from '../TemplateEditor'

export const dynamic = 'force-dynamic'

export default async function EditQtyTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission('cost-control', 'admin')
  const { id } = await params
  const supabase = await createClient()

  const [{ data: template }, { data: disciplines }, { data: subSkills }] = await Promise.all([
    supabase.from('cc_qty_templates').select('*').eq('id', id).single(),
    supabase.from('cc_disciplines').select('id, code, name').order('display_order'),
    supabase.from('cc_sub_skills').select('id, code, name, discipline_id').order('code'),
  ])

  if (!template) notFound()

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
      <PageHeader
        title={template.name}
        subtitle={`Edit template · ${template.is_seed ? 'seed' : 'custom'}`}
        back="/cost-control/admin/qty-templates"
      />
      <TemplateEditor
        initial={{
          id: template.id,
          scope: template.scope,
          scope_id: template.scope_id,
          name: template.name,
          columns: template.columns,
          formula: template.formula,
          default_unit: template.default_unit,
          is_active: template.is_active,
        }}
        disciplines={disciplines ?? []}
        subSkills={subSkills ?? []}
        isSeed={template.is_seed}
      />
    </div>
  )
}
