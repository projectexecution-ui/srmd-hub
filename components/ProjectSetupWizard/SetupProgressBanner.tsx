import Link from 'next/link'
import { CheckCircle2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface SetupProgressBannerProps {
  projectId: string
  /** 0-100 */
  progressPct: number
  /** Where "Continue Setup" links to. Default: /cost-control/projects/[id]/setup */
  continueHref?: string
}

/**
 * Soft yellow banner shown on a project's landing/detail page when its setup
 * is incomplete. Never blocks work — engineers can keep working in configured
 * disciplines while the PM finishes the rest.
 *
 * Shared component — any module that uses the project-setup pattern reuses
 * this. See docs/cost-control-roadmap.md for the cross-module setup plan.
 */
export function SetupProgressBanner({
  projectId,
  progressPct,
  continueHref,
}: SetupProgressBannerProps) {
  if (progressPct >= 100) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
        <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
        <span>Setup complete</span>
      </div>
    )
  }

  // Resumable setup lives at /cost-control/projects/[id]/setup. The page
  // loads everything saved so far and drops the wizard onto the first
  // incomplete step.
  const href = continueHref ?? `/cost-control/projects/${projectId}/setup`

  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-start gap-3">
        <AlertCircle className="h-5 w-5 flex-shrink-0 text-amber-600 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-amber-900">
            Setup is {progressPct}% complete — finish anytime
          </p>
          <p className="mt-1 text-xs text-amber-700">
            Engineers can start creating Working Sheets in configured disciplines while you finish the rest. This banner won&apos;t block any work.
          </p>
          <div className="mt-3 h-1.5 w-full bg-amber-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-500 transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button asChild size="sm">
              <Link href={href}>Continue Setup →</Link>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link href={`/cost-control/projects/${projectId}`}>Remind Me Tomorrow</Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
