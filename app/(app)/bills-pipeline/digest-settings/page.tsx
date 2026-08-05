import { redirect } from 'next/navigation'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getMyProfile } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { parseBillsDigestConfig, BILLS_PROJECT_CODES } from '@/lib/bills-pipeline/digest-settings'
import { BillsDigestForm } from './BillsDigestForm'

export const dynamic = 'force-dynamic'

const FALLBACK_STAGES = ['Under: Site Head', 'Under: CT Head', 'Under: CT Billing', 'Under: CT Disc Head']

export default async function BillsDigestSettingsPage() {
  const profile = await getMyProfile()
  if (!profile || profile.role !== 'admin') redirect('/bills-pipeline')

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const sb = createServiceClient(url, serviceKey!, { auth: { persistSession: false } })

  const [{ data: settings }, { data: users }, { data: stuckRow }] = await Promise.all([
    sb.from('app_settings').select('key, value').like('key', 'bills_digest_%'),
    sb.from('profiles').select('id, full_name, email, role').eq('is_active', true).order('full_name', { ascending: true }),
    sb.from('app_settings').select('value').eq('key', 'bills_pipeline_stuck').maybeSingle(),
  ])

  const cfg = parseBillsDigestConfig((settings ?? []) as Array<{ key: string; value: string }>)

  // Available internal stages come live from the last bills snapshot (they're
  // not hardcoded — the Zoho blueprint can change them).
  let availableStages: string[] = []
  try {
    const arr = JSON.parse((stuckRow?.value as string) ?? '[]') as Array<{ status?: string }>
    availableStages = [...new Set(arr.map(b => String(b.status ?? '')).filter(Boolean))].sort()
  } catch { /* ignore */ }
  if (availableStages.length === 0) availableStages = FALLBACK_STAGES

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
      <PageHeader
        title="Bills digest — daily email"
        back="/bills-pipeline"
        subtitle="One 9 AM email per Atm Head with a card per their project — pick projects AND which desk-stage each person sees (default: Site Head only)."
      />
      <BillsDigestForm
        initial={cfg}
        users={(users ?? []).map(u => ({ id: u.id as string, full_name: (u.full_name as string | null) ?? null, email: u.email as string, role: u.role as string }))}
        projectCodes={BILLS_PROJECT_CODES}
        availableStages={availableStages}
      />
    </div>
  )
}
