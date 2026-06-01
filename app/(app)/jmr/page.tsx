import Link from 'next/link'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardContent } from '@/components/ui/card'
import { Wrench, ClipboardCheck, Receipt, BarChart3, Settings, Grid, User } from 'lucide-react'
import { requirePermission, can, getMyProfile } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export default async function JMRPage() {
  const perms = await requirePermission('jmr', 'view')
  const profile = await getMyProfile()
  const role = profile?.role

  const tiles = [
    {
      slug: 'entry', label: 'Daily Entry', href: '/jmr/entry',
      icon: ClipboardCheck, tone: 'bg-blue-50 text-blue-700',
      desc: 'Log machine hours or manpower for today',
      show: can(perms, 'jmr', 'edit'),
    },
    {
      slug: 'my', label: 'My JMR', href: '/jmr/my',
      icon: User, tone: 'bg-indigo-50 text-indigo-700',
      desc: 'Your entries · pending approval · flagged',
      show: can(perms, 'jmr', 'view'),
    },
    {
      slug: 'bill', label: 'New Bill', href: '/jmr/bill',
      icon: Receipt, tone: 'bg-rose-50 text-rose-700',
      desc: 'Submit a contractor bill with photo + qty',
      show: can(perms, 'jmr-bills', 'edit'),
    },
    {
      slug: 'matrix', label: 'JMR Matrix', href: '/jmr/matrix',
      icon: Grid, tone: 'bg-emerald-50 text-emerald-700',
      desc: 'Equipment & manpower summary, sub-project × item',
      show: can(perms, 'jmr', 'view'),
    },
    {
      slug: 'bills', label: 'Bills Review', href: '/jmr/bills',
      icon: Receipt, tone: 'bg-amber-50 text-amber-700',
      desc: 'Review, approve, mark paid',
      show: can(perms, 'jmr-bills', 'view') && (role === 'admin' || role === 'head' || role === 'founder'),
    },
    {
      slug: 'dashboard', label: 'PM Dashboard', href: '/jmr/dashboard',
      icon: BarChart3, tone: 'bg-purple-50 text-purple-700',
      desc: 'Spend · Billed · Paid + alerts',
      show: can(perms, 'jmr', 'view') && (role === 'admin' || role === 'head' || role === 'founder'),
    },
    {
      slug: 'admin', label: 'JMR Admin', href: '/jmr/admin',
      icon: Settings, tone: 'bg-slate-100 text-slate-700',
      desc: 'Items, rate cards, contractors, settings',
      show: can(perms, 'jmr-admin', 'view'),
    },
  ].filter(t => t.show)

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <PageHeader
        title="JMR / Machinery"
        subtitle="Site machinery hours, bills, and JMR reports"
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        {tiles.map(t => (
          <Link key={t.slug} href={t.href} className="group">
            <Card className="hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className={`inline-flex h-11 w-11 items-center justify-center rounded-xl mb-3 ${t.tone}`}>
                  <t.icon className="h-5 w-5" />
                </div>
                <p className="font-semibold text-gray-900">{t.label}</p>
                <p className="text-xs text-gray-500 mt-1">{t.desc}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
        {tiles.length === 0 && (
          <div className="col-span-full">
            <Card>
              <CardContent className="py-10 text-center">
                <Wrench className="h-8 w-8 text-gray-400 mx-auto mb-2" />
                <p className="text-sm text-gray-500">You don&apos;t have access to any JMR screens yet. Ask an admin.</p>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}
