'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Loader2, Copy, Check } from 'lucide-react'
import { toast } from 'sonner'
import { confirm } from '@/components/ui/confirm-dialog'
import { copyProjectSetup, type SetupSourceOption } from './copy-setup-actions'

export function CopySetupPanel({
  targetProjectId, targetProjectName, sources,
}: {
  targetProjectId: string
  targetProjectName: string
  sources: SetupSourceOption[]
}) {
  const router = useRouter()
  const [sourceId, setSourceId] = useState('')
  const [withDisciplines, setWithDisciplines] = useState(true)
  const [withApprovers, setWithApprovers] = useState(true)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  const source = sources.find(s => s.id === sourceId)

  async function run() {
    if (!source) { toast.error('Pick a project to copy from.'); return }
    if (!withDisciplines && !withApprovers) { toast.error('Pick at least one thing to copy.'); return }

    const parts: string[] = []
    if (withDisciplines) parts.push(`${source.disciplines} work categories and ${source.subSkills} sub-skills`)
    if (withApprovers) parts.push(`${source.approvers} approver${source.approvers === 1 ? '' : 's'}`)

    const ok = await confirm({
      title: `Copy setup from ${source.label}?`,
      message: `This adds ${parts.join(' and ')} to ${targetProjectName}. Nothing already set up here is removed or changed, and no budgets or working sheets are touched.`,
      confirmLabel: 'Copy it',
      danger: false,
    })
    if (!ok) return

    setBusy(true)
    const r = await copyProjectSetup({
      sourceProjectId: sourceId,
      targetProjectId,
      includeDisciplines: withDisciplines,
      includeApprovers: withApprovers,
    })
    setBusy(false)
    if (!r.ok) { toast.error(r.error); return }

    const s = r.summary
    const added: string[] = []
    if (s.disciplinesAdded) added.push(`${s.disciplinesAdded} work categor${s.disciplinesAdded === 1 ? 'y' : 'ies'}`)
    if (s.subSkillsAdded) added.push(`${s.subSkillsAdded} sub-skill${s.subSkillsAdded === 1 ? '' : 's'}`)
    if (s.approversAdded) added.push(`${s.approversAdded} approver${s.approversAdded === 1 ? '' : 's'}`)

    if (added.length === 0) {
      toast.message(`Nothing to add — ${targetProjectName} already had everything ${source.label} has.`)
    } else {
      toast.success(`Added ${added.join(', ')}${s.alreadyThere > 0 ? ` · ${s.alreadyThere} already here` : ''}.`)
      setDone(true); setTimeout(() => setDone(false), 2500)
    }
    router.refresh()
  }

  return (
    <Card className="p-4 space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
          <Copy className="h-4 w-4 text-indigo-600" /> Copy setup from another project
        </h2>
        <p className="text-xs text-gray-500 mt-1">
          Set one project up properly, then reuse it. This only <b>adds</b> — nothing already ticked here is removed,
          and budgets, working sheets and approvals are never touched.
        </p>
      </div>

      {sources.length === 0 ? (
        <p className="text-xs text-gray-500 rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
          No other project has a setup to copy yet. Once one does, it will appear here.
        </p>
      ) : (
        <>
          <label className="block text-xs">
            <span className="font-semibold text-gray-600">Copy from</span>
            <select
              value={sourceId}
              onChange={e => setSourceId(e.target.value)}
              className="mt-1 w-full min-h-[44px] rounded-lg border border-gray-300 bg-white px-2 text-sm"
            >
              <option value="">Choose a project…</option>
              {sources.map(s => (
                <option key={s.id} value={s.id}>
                  {s.label} — {s.disciplines} categories · {s.subSkills} sub-skills{s.approvers > 0 ? ` · ${s.approvers} approvers` : ''}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <label className="inline-flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
              <input type="checkbox" checked={withDisciplines} onChange={e => setWithDisciplines(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
              Work categories &amp; sub-skills
              {source && <span className="text-gray-400">({source.disciplines} + {source.subSkills})</span>}
            </label>
            <label className="inline-flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
              <input type="checkbox" checked={withApprovers} onChange={e => setWithApprovers(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
              Approvers
              {source && <span className="text-gray-400">({source.approvers})</span>}
            </label>
          </div>

          <div className="flex items-center gap-2">
            <Button onClick={run} disabled={busy || !sourceId}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : done ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {done ? 'Copied' : 'Copy setup'}
            </Button>
            {!sourceId && <span className="text-xs text-gray-400">Pick a project first.</span>}
          </div>
        </>
      )}
    </Card>
  )
}
