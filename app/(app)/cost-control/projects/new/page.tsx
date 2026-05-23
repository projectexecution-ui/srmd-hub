import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { AlertTriangle } from 'lucide-react'
import {
  ProjectSetupWizard,
  type ParentProjectOption,
  type UserOption,
  type DisciplineOption,
  type SubSkillOption,
} from '@/components/ProjectSetupWizard'

export const dynamic = 'force-dynamic'

// The "common 19" disciplines that should be pre-ticked on new projects.
// Based on spec section 4 step 2. Tweak in cc_disciplines after seeding.
const COMMON_DISCIPLINE_CODES = new Set([
  '01', '02', '03', '04', '05', '06', '07', '08', '09', '11', '12', '13', '17', '19',
])

export default async function NewCostControlProjectPage() {
  await requirePermission('cost-control', 'edit')
  const supabase = await createClient()

  const [parentsRes, usersRes, disciplinesRes, subSkillsRes] = await Promise.all([
    supabase.from('projects').select('id, code, name').order('code'),
    supabase.from('profiles').select('id, full_name, name').eq('is_active', true),
    supabase.from('cc_disciplines').select('id, code, name').order('display_order'),
    supabase.from('cc_sub_skills').select('id, discipline_id, code, name').order('code'),
  ])

  const tablesMissing = !!disciplinesRes.error

  const parentProjects: ParentProjectOption[] = (parentsRes.data ?? []) as ParentProjectOption[]
  const users: UserOption[] = (usersRes.data ?? []).map(p => ({
    id: p.id,
    name: p.full_name ?? p.name ?? '(unnamed)',
  }))
  const disciplines: DisciplineOption[] = (disciplinesRes.data ?? []).map(d => ({
    id: d.id,
    code: d.code,
    name: d.name,
    commonByDefault: COMMON_DISCIPLINE_CODES.has(d.code),
  }))
  const subSkills: SubSkillOption[] = (subSkillsRes.data ?? []) as SubSkillOption[]

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4">
      <PageHeader
        title="New Cost Control project"
        subtitle="Multi-step setup — skip anything; finish later."
        back="/cost-control"
      />

      {tablesMissing && (
        <Card className="border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-5 w-5 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-semibold">Cost Control tables not yet applied.</p>
              <p className="mt-1">
                The Supabase migration at <code>supabase/migrations/20260523_cost_control_foundation.sql</code>{' '}
                (and its seed) hasn&apos;t been run yet. Step 1 (basics) will still work because it writes to the existing <code>projects</code> table — but disciplines won&apos;t load until the migration is applied.
              </p>
            </div>
          </div>
        </Card>
      )}

      <ProjectSetupWizard
        parentProjects={parentProjects}
        users={users}
        disciplines={disciplines}
        subSkills={subSkills}
      />
    </div>
  )
}
