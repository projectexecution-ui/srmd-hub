import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Upload } from 'lucide-react'
import { formatDateTime } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export default async function UploadsPage() {
  await requirePermission('uploads', 'view')
  const supabase = await createClient()

  const { data: uploads } = await supabase
    .from('uploads')
    .select('*, profiles:uploaded_by(name, email)')
    .order('created_at', { ascending: false })
    .limit(50)

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <PageHeader title="Uploads" subtitle="Excel imports history (read-only)" />

      <Card className="mb-4 bg-amber-50 border-amber-200">
        <CardContent className="pt-5">
          <p className="text-sm text-amber-900">
            <strong>Note:</strong> Excel uploads are currently processed by the existing tool. This page is read-only — it shows the history of imports. The new-app upload pipeline is planned for v2.
          </p>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        {uploads && uploads.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">File</th>
                  <th className="px-4 py-3 font-semibold">Type</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold text-right">Parsed / Total</th>
                  <th className="px-4 py-3 font-semibold">Uploaded by</th>
                  <th className="px-4 py-3 font-semibold">At</th>
                </tr>
              </thead>
              <tbody>
                {uploads.map((u: { id: string; file_name: string; upload_type: string; status: string; parsed_rows: number; total_rows: number; error_rows: number; created_at: string | null; profiles: { name: string | null; email: string } | { name: string | null; email: string }[] | null }) => {
                  const profile = Array.isArray(u.profiles) ? u.profiles[0] : u.profiles
                  return (
                    <tr key={u.id} className="border-t border-gray-100">
                      <td className="px-4 py-3 text-gray-900 font-medium max-w-[260px] truncate">{u.file_name}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{u.upload_type}</td>
                      <td className="px-4 py-3">
                        <Badge variant={u.status === 'completed' ? 'success' : u.status === 'failed' ? 'destructive' : 'secondary'}>
                          {u.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700 tabular-nums">
                        {u.parsed_rows} / {u.total_rows}
                        {u.error_rows > 0 && <span className="text-red-600 ml-1">({u.error_rows} err)</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-700">{profile?.name || profile?.email || '—'}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{formatDateTime(u.created_at)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={<Upload className="h-10 w-10" />} title="No uploads yet" />
        )}
      </Card>
    </div>
  )
}
