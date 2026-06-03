import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requirePermission, can } from '@/lib/auth'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Plus, Coins } from 'lucide-react'
import { formatINR, formatDateIN } from '@/lib/jmr/format'
import { AdminRowDeleteButton } from '@/components/jmr/AdminRowDeleteButton'

export const dynamic = 'force-dynamic'

export default async function JmrRateCardsPage() {
  const perms = await requirePermission('jmr-admin', 'view')
  const canEdit = can(perms, 'jmr-admin', 'edit')
  const supabase = await createClient()

  const { data: rates } = await supabase
    .from('jmr_rate_cards')
    .select(`
      id, rate_per_unit, valid_from, valid_till, project_id,
      jmr_contractors ( id, name ),
      jmr_items ( id, name, unit ),
      projects ( id, name )
    `)
    .order('valid_from', { ascending: false })

  return (
    <>
      <div className="flex justify-between items-center mb-3">
        <div>
          <p className="text-sm text-gray-500">{rates?.length ?? 0} rate card{rates?.length === 1 ? '' : 's'}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            Same item can have several cards with different <b>Valid from</b> / <b>Valid till</b> windows
            — e.g. ₹500 until 31 Mar, ₹600 from 1 Apr. Bills auto-split per rate.
          </p>
        </div>
        {canEdit && (
          <Button asChild size="sm">
            <Link href="/jmr/admin/rate-cards/new"><Plus className="h-4 w-4" />New rate</Link>
          </Button>
        )}
      </div>
      <Card className="overflow-hidden">
        {rates && rates.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Contractor</th>
                  <th className="px-4 py-3 font-semibold">Item</th>
                  <th className="px-4 py-3 font-semibold">Project</th>
                  <th className="px-4 py-3 font-semibold text-right">Rate</th>
                  <th className="px-4 py-3 font-semibold">Valid from</th>
                  <th className="px-4 py-3 font-semibold">Valid till</th>
                  {canEdit && <th className="px-4 py-3"></th>}
                </tr>
              </thead>
              <tbody>
                {rates.map((r) => {
                  // Supabase typed the relations as arrays; unwrap.
                  const contractor = Array.isArray(r.jmr_contractors) ? r.jmr_contractors[0] : r.jmr_contractors
                  const item = Array.isArray(r.jmr_items) ? r.jmr_items[0] : r.jmr_items
                  const project = Array.isArray(r.projects) ? r.projects[0] : r.projects
                  return (
                    <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <Link href={`/jmr/admin/rate-cards/${r.id}`} className="font-medium text-blue-700 hover:underline">
                          {contractor?.name ?? '—'}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-700">{item?.name ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-700 text-xs">
                        {project?.name ?? <span className="italic text-gray-500">All projects (default)</span>}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        {formatINR(Number(r.rate_per_unit))}
                        <span className="text-xs text-gray-500">/{(item as { unit?: string } | undefined)?.unit ?? ''}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-700">{formatDateIN(r.valid_from)}</td>
                      <td className="px-4 py-3 text-gray-700">{r.valid_till ? formatDateIN(r.valid_till) : <span className="italic text-gray-400">open</span>}</td>
                      {canEdit && (
                        <td className="px-4 py-3 text-right">
                          <AdminRowDeleteButton
                            table="jmr_rate_cards"
                            id={r.id}
                            label={`${contractor?.name ?? '?'} × ${item?.name ?? '?'}`}
                          />
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={<Coins className="h-10 w-10" />}
            title="No rate cards yet"
            action={canEdit ? <Button asChild size="sm"><Link href="/jmr/admin/rate-cards/new">Add first rate</Link></Button> : null}
          />
        )}
      </Card>
    </>
  )
}
