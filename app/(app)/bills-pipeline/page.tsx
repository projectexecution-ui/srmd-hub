'use server'

import { createClient as createServiceClient } from '@supabase/supabase-js'
import { requirePermission, can } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { Activity, Download, Link2, AlertTriangle } from 'lucide-react'
import RefreshButton from './refresh-button'
import ZohoToast from './zoho-toast'

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

  let signedUrl: string | null  = null
  let meta: Record<string, string | number> | null = null
  let hasZohoToken = false

  if (serviceKey) {
    const sb = createServiceClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

    const { data: settings } = await sb
      .from('app_settings')
      .select('key, value')
      .in('key', ['bills_pipeline_last', 'zoho_bp_refresh_token'])

    const rows = (settings ?? []) as Array<{ key: string; value: string }>
    const metaRow  = rows.find(r => r.key === 'bills_pipeline_last')
    const tokenRow = rows.find(r => r.key === 'zoho_bp_refresh_token')

    hasZohoToken = !!tokenRow?.value

    if (metaRow?.value) {
      try {
        meta = JSON.parse(metaRow.value) as Record<string, string | number>
      } catch { /* ignore bad JSON */ }
    }

    if (meta?.file) {
      const { data: signed } = await sb.storage
        .from('bills-pipeline')
        .createSignedUrl(meta.file as string, 3600)
      signedUrl = signed?.signedUrl ?? null
    }
  }

  const showConnectBanner = canAdmin && !hasZohoToken

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <ZohoToast zoho={sp.zoho} reason={sp.reason} />

      <PageHeader
        title="Bills Pipeline"
        subtitle="Weekly SRA contractor bills command card"
      >
        <div className="flex items-center gap-2">
          {canEdit && <RefreshButton />}
          {signedUrl && (
            <Button asChild variant="outline" size="sm">
              <a href={signedUrl} download={`bills-pipeline-${meta?.weekOf ?? 'latest'}.png`}>
                <Download className="h-4 w-4 mr-2" />
                Download
              </a>
            </Button>
          )}
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
          <span>{meta.billCount} active bills</span>
          <span>·</span>
          <span>{meta.stalled} stalled</span>
        </div>
      )}

      {signedUrl ? (
        <div className="rounded-xl border border-gray-200 overflow-hidden shadow-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={signedUrl}
            alt="Bills Pipeline Command Card"
            className="w-full h-auto block"
          />
        </div>
      ) : (
        <EmptyState
          icon={<Activity className="h-10 w-10" />}
          title="No card yet"
          description={
            canEdit
              ? 'Click "Refresh Card" to generate the first command card.'
              : 'The weekly command card will appear here after the first run.'
          }
        />
      )}
    </div>
  )
}
