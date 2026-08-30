'use client'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Loader2, Check, CalendarClock, Sparkles, Info } from 'lucide-react'
import { toast } from 'sonner'
import { addDays, workBackDeadlines } from '@/lib/schedule/formula'
import { formatDate } from '@/lib/utils'
import type { LeadDays } from '@/lib/schedule/types'
import { saveScheduleSettings } from './actions'

interface ProjectOpt { id: string; code: string | null; name: string; itemCount: number }

/** A date far enough ahead that every work-back step still lands in the future,
 *  so the worked example below reads naturally. */
function defaultSampleStart(): string {
  const now = new Date()
  const iso = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
  return addDays(iso, 90)
}

export function ScheduleSettingsForm({
  initialLeads, initialAiProjects, projects, canEdit,
}: {
  initialLeads: LeadDays
  initialAiProjects: string[]
  projects: ProjectOpt[]
  canEdit: boolean
}) {
  const router = useRouter()
  const [procurement, setProcurement] = useState(initialLeads.procurement)
  const [approval, setApproval] = useState(initialLeads.approval)
  const [drawing, setDrawing] = useState(initialLeads.drawing)
  const [aiIds, setAiIds] = useState<string[]>(initialAiProjects)
  const [sampleStart, setSampleStart] = useState(defaultSampleStart)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const leads: LeadDays = { procurement, approval, drawing }
  const example = useMemo(() => workBackDeadlines(sampleStart, leads),
    [sampleStart, procurement, approval, drawing]) // eslint-disable-line react-hooks/exhaustive-deps

  const totalLead = procurement + approval + drawing

  async function save() {
    setSaving(true)
    const r = await saveScheduleSettings({
      procurementDays: procurement,
      approvalDays: approval,
      drawingDays: drawing,
      aiAssistProjectIds: aiIds,
    })
    setSaving(false)
    if (!r.ok) { toast.error(r.error); return }
    setSaved(true); setTimeout(() => setSaved(false), 1800)
    toast.success('Saved')
    router.refresh()
  }

  function toggleAi(id: string) {
    setAiIds(cur => cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id])
  }

  const numberField = (
    label: string, hint: string, value: number, set: (n: number) => void,
  ) => (
    <label className="text-xs block">
      <span className="font-semibold text-gray-700">{label}</span>
      <div className="mt-1 flex items-center gap-2">
        <input
          type="number" min={0} max={365} value={value}
          disabled={!canEdit}
          onChange={e => set(Math.max(0, Math.min(365, Number(e.target.value))))}
          className="w-full min-h-[44px] rounded-lg border border-gray-300 px-3 text-sm tabular-nums disabled:bg-gray-50 disabled:text-gray-400"
        />
        <span className="text-gray-500 whitespace-nowrap">days</span>
      </div>
      <span className="block text-[11px] text-gray-500 mt-1">{hint}</span>
    </label>
  )

  return (
    <div className="space-y-4">
      {!canEdit && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900 flex items-start gap-2">
          <Info className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <span>You can see these but not change them. Schedule <b>admin</b> permission is needed — ask a project head or an admin.</span>
        </div>
      )}

      {/* ── Lead times ── */}
      <Card className="p-4 md:p-5 space-y-4">
        <div>
          <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-indigo-700" /> Lead times
          </h3>
          <p className="text-xs text-gray-500 mt-1 max-w-2xl">
            Work backwards from the day work starts on site. Each step has to be finished this many days before the one after it.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {numberField('Work Order before site start', 'The WO must be issued this long before work starts.', procurement, setProcurement)}
          {numberField('Budget approved before the WO', 'The approval chain has to finish this long before the WO goes out.', approval, setApproval)}
          {numberField('Drawing ready before the budget', 'GFC drawing in hand this long before the budget is raised.', drawing, setDrawing)}
        </div>

        {/* Worked example — the numbers above are abstract until you see dates. */}
        <div className="rounded-lg border border-indigo-100 bg-indigo-50/40 p-3 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-indigo-900">If work starts on site on</span>
            <input
              type="date" value={sampleStart}
              onChange={e => setSampleStart(e.target.value || defaultSampleStart())}
              className="min-h-[36px] rounded-lg border border-indigo-200 bg-white px-2 text-sm"
            />
          </div>
          <ol className="space-y-1.5">
            {[
              ['Drawing ready by', example.drawingBy, `${totalLead} days before`],
              ['Budget approved by', example.budgetBy, `${procurement + approval} days before`],
              ['Work Order issued by', example.woBy, `${procurement} days before`],
              ['Work starts', sampleStart, 'day 0'],
            ].map(([label, date, rel]) => (
              <li key={String(label)} className="flex items-baseline justify-between gap-3 text-xs">
                <span className="text-indigo-900 font-medium">{label}</span>
                <span className="flex-1 border-b border-dotted border-indigo-200 translate-y-[-2px]" />
                <span className="tabular-nums font-semibold text-indigo-900 whitespace-nowrap">
                  {date ? formatDate(String(date)) : '—'}
                </span>
                <span className="text-[11px] text-indigo-600 whitespace-nowrap hidden sm:inline">{rel}</span>
              </li>
            ))}
          </ol>
          <p className="text-[11px] text-indigo-700">
            So planning has to begin <b>{totalLead} days</b> ({(totalLead / 30).toFixed(1)} months) before anyone can start on site.
          </p>
        </div>
      </Card>

      {/* ── AI assist ── */}
      <Card className="p-4 md:p-5 space-y-3">
        <div>
          <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-violet-700" /> AI assist — per project
          </h3>
          <p className="text-xs text-gray-500 mt-1 max-w-2xl">
            Marks which projects are opted in. <b className="text-gray-700">Nothing reads this flag yet</b> — the schedule
            loads it but no feature uses it. Ticking a project changes nothing today; it is here so the choice is yours
            and not the code&apos;s when the feature lands.
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 max-h-72 overflow-auto">
          {projects.length === 0 && <p className="px-3 py-2 text-xs text-gray-400">No projects yet.</p>}
          {projects.map(p => {
            const on = aiIds.includes(p.id)
            return (
              <button
                key={p.id} type="button" disabled={!canEdit} onClick={() => toggleAi(p.id)}
                className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-gray-50 disabled:hover:bg-transparent disabled:cursor-not-allowed min-h-[44px]"
              >
                <span className="min-w-0 flex items-center gap-2">
                  {p.code && <span className="inline-flex rounded bg-indigo-50 text-indigo-700 text-[11px] font-bold px-1.5 py-0.5 whitespace-nowrap">{p.code}</span>}
                  <span className="text-sm text-gray-900 truncate">{p.name}</span>
                  <span className="text-[11px] text-gray-400 whitespace-nowrap">
                    {p.itemCount > 0 ? `${p.itemCount} items` : 'no schedule yet'}
                  </span>
                </span>
                <span className={`inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border ${on ? 'bg-violet-600 border-violet-600 text-white' : 'border-gray-300 bg-white'}`}>
                  {on && <span className="text-[10px] leading-none">✓</span>}
                </span>
              </button>
            )
          })}
        </div>
      </Card>

      {canEdit && (
        <div className="flex items-center gap-2">
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : null}
            {saved ? 'Saved' : 'Save settings'}
          </Button>
          <span className="text-xs text-gray-400">Applies to every project&apos;s schedule.</span>
        </div>
      )}
    </div>
  )
}
