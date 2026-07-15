import { createClient as createServiceClient } from '@supabase/supabase-js'
import { requirePermission, can } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Link2, AlertTriangle } from 'lucide-react'
import RefreshButton from './refresh-button'
import ZohoToast from './zoho-toast'
import ReportTabs, { type ReportTab } from './report-tabs'
import StuckBills, { type StuckBillRow, type ChecklistState } from './stuck-bills'
import ProjectSettings from './project-settings'
import Cockpit from './cockpit'
import type { CockpitBill } from '@/lib/bills-pipeline/transform'

export const dynamic = 'force-dynamic'

interface Props {
  searchParams: Promise<{ zoho?: string; reason?: string }>
}

export default async function BillsPipelinePage({ searchParams }: Props) {
  const perms    = await requirePermission('bills-pipeline', 'view')
  const canEdit  = can(perms, 'bills-pipeline', 'edit')
  const canAdmin = can(perms, 'bills-pipeline', 'admin')

  const sp = await searchParams

  // Service-role client for storage signed URL + app_settings
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!

  let meta: Record<string, string | number> | null = null
  let hasZohoToken = false
  let cardUrl: string | null = null
  let scorecardUrl: string | null = null
  let stuckBills: StuckBillRow[] = []
  let cockpitBills: CockpitBill[] = []
  const checklist: Record<string, ChecklistState> = {}

  if (serviceKey) {
    const sb = createServiceClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

    const { data: settings } = await sb
      .from('app_settings')
      .select('key, value')
      .in('key', ['bills_pipeline_last', 'zoho_bp_refresh_token', 'bills_pipeline_stuck', 'bills_pipeline_cockpit'])

    const rows = (settings ?? []) as Array<{ key: string; value: string }>
    const metaRow  = rows.find(r => r.key === 'bills_pipeline_last')
    const tokenRow = rows.find(r => r.key === 'zoho_bp_refresh_token')
    const stuckRow = rows.find(r => r.key === 'bills_pipeline_stuck')
    const cockRow  = rows.find(r => r.key === 'bills_pipeline_cockpit')

    hasZohoToken = !!tokenRow?.value

    if (metaRow?.value) {
      try { meta = JSON.parse(metaRow.value) as Record<string, string | number> } catch { /* ignore */ }
    }
    if (stuckRow?.value) {
      try { stuckBills = JSON.parse(stuckRow.value) as StuckBillRow[] } catch { /* ignore */ }
    }
    if (cockRow?.value) {
      try { cockpitBills = JSON.parse(cockRow.value) as CockpitBill[] } catch { /* ignore */ }
    }

    // Saved checklist ticks + remarks, keyed by bill id.
    const { data: checks } = await sb
      .from('bp_bill_checklist')
      .select('bill_id, ms_sheet, abstract_sheet, po_wo, drawing, note')
    for (const c of (checks ?? []) as Array<{ bill_id: string; note: string | null } & ChecklistState>) {
      checklist[c.bill_id] = {
        ms_sheet: !!c.ms_sheet, abstract_sheet: !!c.abstract_sheet,
        po_wo: !!c.po_wo, drawing: !!c.drawing, note: c.note ?? '',
      }
    }

    const sign = async (file?: string | number | null) => {
      if (!file || typeof file !== 'string') return null
      const { data } = await sb.storage.from('bills-pipeline').createSignedUrl(file, 3600)
      return data?.signedUrl ?? null
    }
    cardUrl      = await sign(meta?.file)
    scorecardUrl = await sign(meta?.scorecardFile)
  }

  const showConnectBanner = canAdmin && !hasZohoToken
  const asOf = (meta?.asOf as string) ?? 'latest'
  const tabs: ReportTab[] = [
    {
      key: 'cockpit', label: 'Cockpit', url: null, filename: '',
      content: <Cockpit bills={cockpitBills} asOf={asOf} />,
    },
    { key: 'card',      label: 'Weekly Card',       url: cardUrl,      filename: `sra-bills-weekly-${asOf}.png` },
    { key: 'scorecard', label: 'Project Scorecard', url: scorecardUrl, filename: `sra-project-scorecard-${asOf}.png` },
    {
      key: 'stuck', label: 'Stuck Bills', url: null, filename: '',
      content: <StuckBills bills={stuckBills} initialChecklist={checklist} canEdit={canEdit} />,
    },
  ]

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <ZohoToast zoho={sp.zoho} reason={sp.reason} />

      <PageHeader
        title="Bills Pipeline"
        subtitle="Weekly SRA contractor bills — management reports"
      >
        <div className="flex items-center gap-2">
          {canAdmin && <ProjectSettings />}
          {canEdit && <RefreshButton />}
        </div>
      </PageHeader>

      {showConnectBanner && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
          <div className="space-y-2">
            <p className="text-sm font-medium text-amber-800">Zoho not connected</p>
            <p className="text-sm text-amber-700">
              Connect your Zoho account to enable automatic bill fetching.
              Make sure <code className="text-xs bg-amber-100 px-1 rounded">ZOHO_BP_CLIENT_ID</code> and{' '}
              <code className="text-xs bg-amber-100 px-1 rounded">ZOHO_BP_CLIENT_SECRET</code> are set in Vercel.
            </p>
            <Button asChild size="sm" variant="outline" className="border-amber-300 text-amber-800 hover:bg-amber-100">
              <a href="/api/zoho/bp-connect">
                <Link2 className="h-4 w-4 mr-2" />
                Connect Zoho
              </a>
            </Button>
          </div>
        </div>
      )}

      {meta && (
        <div className="flex gap-4 text-sm text-muted-foreground">
          <span>Generated: {new Date(meta.generatedAt as string).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })}</span>
          <span>·</span>
          <span>{meta.billCount} live bills</span>
          {meta.stalled != null && <><span>·</span><span>{meta.stalled} stalled</span></>}
        </div>
      )}

      <ReportTabs tabs={tabs} canEdit={canEdit} />
    </div>
  )
}
