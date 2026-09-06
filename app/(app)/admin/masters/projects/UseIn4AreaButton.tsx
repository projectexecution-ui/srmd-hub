'use client'
import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Download } from 'lucide-react'
import { toast } from 'sonner'
import { formatNumber } from '@/lib/utils'
import { useIn4Area } from '../actions'

export function UseIn4AreaButton({ projectId, sft }: { projectId: string; sft: number }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(async () => {
        const r = await useIn4Area(projectId, sft)
        if (!r.ok) toast.error(r.error ?? 'Could not save'); else { toast.success(`Area set to ${formatNumber(Math.round(sft))} sft from IN4`); router.refresh() }
      })}
      className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2 min-h-[44px] md:min-h-[28px] text-[11px] font-medium text-indigo-800 hover:bg-indigo-100 whitespace-nowrap"
      title="Copy IN4's construction area onto this project"
    >
      {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />} Use IN4 area
    </button>
  )
}
