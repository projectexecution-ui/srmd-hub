import { AlertTriangle } from 'lucide-react'
import type { In4State } from '@/lib/revamp/masters-in4'

/** One line, only when IN4 was not reached: what came from the mirror instead
 *  and why. Silent when everything is live, so a working page carries no
 *  banner. */
export function In4Note({ in4, error, what }: { in4: In4State; error?: string; what: string }) {
  if (in4 === 'live') return null
  return (
    <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900 flex items-start gap-2">
      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
      <span>
        {in4 === 'not-configured'
          ? `IN4 is not connected on this deployment, so ${what} could not be read live; what the mirror holds is shown.`
          : `IN4 did not answer just now (${error ?? 'no detail'}), so ${what} could not be read live; what the mirror holds is shown.`}
      </span>
    </p>
  )
}
