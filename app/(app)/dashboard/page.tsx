import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { TileLauncher } from '@/components/TileLauncher'
import { StatPill } from '@/components/ui/stat-pill'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { IndentStagePill } from '@/components/IndentStagePill'
import { Badge } from '@/components/ui/badge'
import { formatDate, formatINR } from '@/lib/utils'
import { ClipboardList, FileText, PackageCheck, Receipt } from 'lucide-react'
import { getMyProfile, getMyPermissions, getDisabledModuleSlugs, isPortalOwner } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const [profile, permissions, disabledSlugs, portalOwner] = await Promise.all([
    getMyProfile(),
    getMyPermissions(),
    getDisabledModuleSlugs(),
    isPortalOwner(),
  ])
  if (!profile) redirect('/login')
  const supabase = await createClient()

  // Counts (lightweight, head:true)
  const [indents, pos, grns, invoices, recentIndents, recentPos] = await Promise.all([
    supabase.from('indents').select('id', { count: 'exact', head: true }),
    supabase.from('purchase_orders').select('id', { count: 'exact', head: true }),
    supabase.from('grns').select('id', { count: 'exact', head: true }),
    supabase.from('invoices').select('id', { count: 'exact', head: true }),
    supabase
      .from('indents')
      .select('id, indent_no, indent_date, stage, sub_project, projects(code, name)')
      .order('indent_date', { ascending: false })
      .limit(5),
    supabase
      .from('purchase_orders')
      .select('id, po_no, po_date, po_amount, vendors(name), projects(code)')
      .order('po_date', { ascending: false })
      .limit(5),
  ])

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : 'Evening'

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Good {greeting}, {profile.name || profile.full_name?.split(' ')[0] || 'there'}</h1>
        <p className="text-gray-500 text-sm">
          {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </div>

      {/* Stat strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatPill label="Indents" value={indents.count ?? 0} icon={<ClipboardList className="h-5 w-5" />} />
        <StatPill label="Purchase Orders" value={pos.count ?? 0} icon={<FileText className="h-5 w-5" />} />
        <StatPill label="GRN" value={grns.count ?? 0} icon={<PackageCheck className="h-5 w-5" />} />
        <StatPill label="Invoices" value={invoices.count ?? 0} icon={<Receipt className="h-5 w-5" />} />
      </div>

      {/* Module tiles — Odoo style */}
      <section>
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500 mb-3">Apps</h2>
        <TileLauncher
          permissions={permissions}
          disabledSlugs={Array.from(disabledSlugs)}
          isPortalOwner={portalOwner}
        />
      </section>

      {/* Recent activity */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Recent Indents</CardTitle>
              <Link href="/indents" className="text-xs text-blue-600 font-semibold">View all</Link>
            </div>
          </CardHeader>
          <CardContent>
            {recentIndents.data && recentIndents.data.length > 0 ? (
              <div className="space-y-2">
                {recentIndents.data.map((i: { id: string; indent_no: string; indent_date: string; stage: string; sub_project: string | null; projects: { code: string; name: string } | { code: string; name: string }[] | null }) => {
                  const proj = Array.isArray(i.projects) ? i.projects[0] : i.projects
                  return (
                    <Link
                      key={i.id}
                      href={`/indents/${i.id}`}
                      className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0 hover:bg-gray-50 -mx-2 px-2 rounded-lg"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900 truncate">{i.indent_no}</p>
                        <p className="text-xs text-gray-500 truncate">
                          {proj?.code} {i.sub_project ? `· ${i.sub_project}` : ''}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        <IndentStagePill stage={i.stage} />
                        <span className="text-xs text-gray-400">{formatDate(i.indent_date)}</span>
                      </div>
                    </Link>
                  )
                })}
              </div>
            ) : (
              <p className="text-sm text-gray-500 py-4 text-center">No indents yet</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Recent POs</CardTitle>
              <Link href="/pos" className="text-xs text-blue-600 font-semibold">View all</Link>
            </div>
          </CardHeader>
          <CardContent>
            {recentPos.data && recentPos.data.length > 0 ? (
              <div className="space-y-2">
                {recentPos.data.map((p: { id: string; po_no: string; po_date: string; po_amount: number; vendors: { name: string } | { name: string }[] | null; projects: { code: string } | { code: string }[] | null }) => {
                  const v = Array.isArray(p.vendors) ? p.vendors[0] : p.vendors
                  const proj = Array.isArray(p.projects) ? p.projects[0] : p.projects
                  const isDraft = p.po_no?.startsWith('DRAFT-')
                  return (
                    <Link
                      key={p.id}
                      href={`/pos/${p.id}`}
                      className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0 hover:bg-gray-50 -mx-2 px-2 rounded-lg"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900 truncate flex items-center gap-1.5">
                          {isDraft && <Badge variant="warning" className="text-[10px]">Draft</Badge>}
                          {p.po_no}
                        </p>
                        <p className="text-xs text-gray-500 truncate">
                          {v?.name} {proj?.code ? `· ${proj.code}` : ''}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        <span className="text-sm font-semibold text-gray-900">{formatINR(p.po_amount)}</span>
                        <span className="text-xs text-gray-400">{formatDate(p.po_date)}</span>
                      </div>
                    </Link>
                  )
                })}
              </div>
            ) : (
              <p className="text-sm text-gray-500 py-4 text-center">No POs yet</p>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
