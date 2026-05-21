import { PageHeader } from '@/components/PageHeader'
import { Card, CardContent } from '@/components/ui/card'
import { Wrench, ClipboardCheck, FileBarChart, Camera } from 'lucide-react'
import { requirePermission } from '@/lib/auth'

export default async function JMRPage() {
  await requirePermission('jmr', 'view')
  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto">
      <PageHeader title="JMR" subtitle="Joint Measurement Records" />

      <Card>
        <CardContent className="py-10">
          <div className="text-center">
            <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-50 text-orange-700 mb-3">
              <Wrench className="h-6 w-6" />
            </div>
            <h2 className="text-lg font-bold text-gray-900">Coming Soon</h2>
            <p className="text-sm text-gray-500 max-w-md mx-auto mt-1">
              The JMR module will let site engineers record joint measurements with site engineer + contractor sign-off and feed certified quantities into the GRN flow.
            </p>
          </div>

          <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Step icon={<ClipboardCheck className="h-5 w-5" />} title="Capture" desc="Enter measured quantities against a BOQ / work order." />
            <Step icon={<Camera className="h-5 w-5" />} title="Sign-off" desc="Engineer + contractor confirm on-site via app." />
            <Step icon={<FileBarChart className="h-5 w-5" />} title="Report" desc="Certified quantities flow into bills and GRN." />
          </div>

          <p className="text-xs text-gray-400 text-center mt-8">
            Want to start defining JMR fields? Drop a sample format in /docs and we&apos;ll wire it up.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

function Step({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-orange-50 text-orange-700 mb-2">{icon}</div>
      <p className="text-sm font-semibold text-gray-900">{title}</p>
      <p className="text-xs text-gray-500 mt-1">{desc}</p>
    </div>
  )
}
