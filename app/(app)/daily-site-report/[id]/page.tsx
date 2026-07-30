import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requirePermission, getMyProfile, getMyUser } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { StagePill } from '@/components/daily-site-report/StagePill'
import { AttentionBadge } from '@/components/daily-site-report/AttentionBadge'
import { deriveStage, deriveAttention } from '@/lib/daily-site-report/stages'
import { formatINR, formatDateIN } from '@/lib/jmr/format'
import type { DsrReport, DsrAttachment, Project, Vendor } from '@/lib/types'
import { StatusLadder } from './StatusLadder'

export const dynamic = 'force-dynamic'

type RelObj<T> = T | T[] | null | undefined
function unwrap<T>(v: RelObj<T>): T | null {
  if (!v) return null
  return Array.isArray(v) ? (v[0] ?? null) : v
}

export default async function SiteReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission('daily-site-report', 'view')
  const { id } = await params
  const [profile, user] = await Promise.all([getMyProfile(), getMyUser()])
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('dsr_reports')
    .select('*, projects ( id, code, name ), vendors ( id, name ), dsr_attachments ( id, path, name, kind )')
    .eq('id', id)
    .maybeSingle()
  if (error || !data) notFound()

  const report = data as DsrReport & { projects?: RelObj<Project>; vendors?: RelObj<Vendor>; dsr_attachments?: DsrAttachment[] }
  const project = unwrap(report.projects)
  const vendor = unwrap(report.vendors)
  const attachments = (report.dsr_attachments ?? []).filter(a => a.kind === 'material')

  // Sign the stamped bill + every material photo in one call.
  const paths = [report.stamped_bill_path, ...attachments.map(a => a.path)]
  const { data: signed } = await supabase.storage.from('site-reports').createSignedUrls(paths, 3600)
  const urlByPath = new Map<string, string>()
  for (const s of signed ?? []) if (s.signedUrl && s.path) urlByPath.set(s.path, s.signedUrl)
  const stampedUrl = urlByPath.get(report.stamped_bill_path) ?? null
  const materialUrls = attachments.map(a => urlByPath.get(a.path)).filter((u): u is string => !!u)

  const stage = deriveStage(report)
  const attention = deriveAttention(report)
  const supplierName = vendor?.name ?? report.supplier_name_text ?? '—'
  const canEdit = profile?.role === 'admin' || report.created_by === user?.id

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-6">
      <PageHeader
        title={report.material_description}
        subtitle={`${supplierName} · ${project?.code || project?.name || ''}`}
        back="/daily-site-report"
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StagePill stage={stage.key} />
        <AttentionBadge attention={attention} />
        <span className="text-sm text-gray-500">Received {formatDateIN(report.received_on)}</span>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="space-y-4 md:col-span-2">
          {/* Stamped bill — the proof, up top */}
          <Card className="p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Stamped bill</p>
            {stampedUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={stampedUrl} alt="Stamped bill" className="mx-auto max-h-[28rem] rounded" />
            ) : (
              <p className="py-6 text-center text-sm text-gray-400">Image unavailable</p>
            )}
          </Card>

          {materialUrls.length > 0 && (
            <Card className="p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Material photos</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {materialUrls.map((u, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={i} src={u} alt={`Material ${i + 1}`} className="h-32 w-full rounded object-cover" />
                ))}
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card className="space-y-2 p-4 text-sm">
            <Detail label="Site" value={project?.code || project?.name || '—'} />
            <Detail label="Supplier" value={supplierName} />
            <Detail label="Material" value={report.material_description} />
            {report.quantity != null && <Detail label="Quantity" value={`${report.quantity}${report.unit ? ' ' + report.unit : ''}`} />}
            {report.amount != null && <Detail label="Amount" value={formatINR(Number(report.amount))} />}
            <Detail label="Bill no." value={report.bill_number} />
            {report.bill_date && <Detail label="Bill date" value={formatDateIN(report.bill_date)} />}
            <Detail label="Received on" value={formatDateIN(report.received_on)} />
          </Card>

          <Card className="p-4">
            <h3 className="mb-1 text-sm font-bold text-gray-800">Status</h3>
            <p className="mb-3 text-xs text-gray-500">
              {canEdit ? 'Tap each step as it happens.' : 'Read-only — updated by the site engineer.'}
            </p>
            <StatusLadder reportId={report.id} report={report} canEdit={!!canEdit} />
          </Card>
        </div>
      </div>
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="text-right font-medium text-gray-900">{value}</span>
    </div>
  )
}
