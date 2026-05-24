import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { TemplateEditor } from '../TemplateEditor'

export const dynamic = 'force-dynamic'

export default async function NewQtyTemplatePage() {
  await requirePermission('cost-control', 'admin')
  const supabase = await createClient()

  const [{ data: disciplines }, { data: subSkills }] = await Promise.all([
    supabase.from('cc_disciplines').select('id, code, name').order('display_order'),
    supabase.from('cc_sub_skills').select('id, code, name, discipline_id').order('code'),
  ])

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
      <PageHeader
        title="New quantification template"
        subtitle="Define a measurement shape engineers can pick from when starting a working"
        back="/cost-control/admin/qty-templates"
      />
      <TemplateEditor
        initial={{
          scope: 'global',
          scope_id: null,
          name: '',
          columns: [
            { key: 'nos', label: 'Nos', type: 'number', required: true },
            { key: 'L', label: 'L', type: 'number', required: true },
          ],
          formula: 'nos*L',
          default_unit: 'RMT',
          is_active: true,
        }}
        disciplines={disciplines ?? []}
        subSkills={subSkills ?? []}
      />
    </div>
  )
}
