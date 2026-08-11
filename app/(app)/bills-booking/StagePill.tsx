import { stageDef, type BbStage } from '@/lib/bills-booking/stages'

const TONE: Record<string, string> = {
  slate: 'bg-slate-100 text-slate-700',
  blue: 'bg-blue-100 text-blue-700',
  indigo: 'bg-indigo-100 text-indigo-700',
  violet: 'bg-violet-100 text-violet-700',
  amber: 'bg-amber-100 text-amber-800',
  teal: 'bg-teal-100 text-teal-700',
  cyan: 'bg-cyan-100 text-cyan-700',
  green: 'bg-green-100 text-green-700',
  gray: 'bg-gray-100 text-gray-600',
  rose: 'bg-rose-100 text-rose-700',
}

export function StagePill({ stage }: { stage: BbStage }) {
  const d = stageDef(stage)
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold ${TONE[d.tone] ?? TONE.gray}`}>
      {d.label}
    </span>
  )
}
