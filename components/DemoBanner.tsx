import { IS_DEMO } from '@/lib/demo-mode'

/**
 * Trial-site marker. Renders nothing on the live site, so this component is
 * safe to leave in the layout permanently.
 *
 * Deliberately loud: the trial shows REAL projects and REAL money (it reads the
 * live database), so the one thing a viewer must never be unsure about is which
 * site they are looking at.
 */
export function DemoBanner() {
  if (!IS_DEMO) return null

  return (
    <div
      role="status"
      className="sticky top-0 z-50 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-amber-400 px-4 py-2 text-center text-amber-950"
    >
      <span className="text-sm font-bold tracking-tight">TRIAL SITE — nothing you do here is saved</span>
      <span className="text-xs opacity-90">
        Real projects and real figures, read-only. Every Save, Approve and Delete is blocked.
      </span>
      <a
        href="https://ct-hub.vercel.app"
        className="text-xs font-semibold underline underline-offset-2 hover:opacity-70"
      >
        Go to the live CT Hub →
      </a>
    </div>
  )
}
