// A tiny labelled value block for the mobile (stacked-card) layouts of the
// procurement-tracker views. On phones the wide tables become card lists;
// each numeric column is shown as a CardField so it stays scannable without
// horizontal scrolling.
import { cn } from '@/lib/utils'

export function CardField({
  label, className, children,
}: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-stone-400 leading-none">{label}</div>
      <div className={cn('text-xs tabular-nums mt-0.5 truncate', className)}>{children}</div>
    </div>
  )
}
