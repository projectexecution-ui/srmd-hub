'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { createWorkingSheet } from '@/components/cost-control/ws-actions'

interface ProjectLite { id: string; code: string; name: string }
interface DRow { id: string; code: string; name: string }
interface SRow { id: string; discipline_id: string; code: string; name: string }

interface Props {
  projects: ProjectLite[]
  projectDisciplines: Array<{ project_id: string; discipline: DRow }>
  projectSubSkills: Array<{ project_id: string; sub_skill: SRow }>
  defaultProjectId?: string
  /** True when caller may set/change the WS deadline (Head / Admin). */
  canSetDeadline?: boolean
}

export function NewWSForm({ projects, projectDisciplines, projectSubSkills, defaultProjectId, canSetDeadline = false }: Props) {
  const router = useRouter()
  const [projectId, setProjectId] = React.useState(defaultProjectId ?? '')
  const [disciplineId, setDisciplineId] = React.useState('')
  const [subSkillId, setSubSkillId] = React.useState('')
  const [lineType, setLineType] = React.useState<'work' | 'material'>('work')
  const [deadline, setDeadline] = React.useState('')
  const [deadlineNotes, setDeadlineNotes] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const disciplinesForProject = React.useMemo(() => {
    if (!projectId) return [] as DRow[]
    const map = new Map<string, DRow>()
    for (const r of projectDisciplines) {
      if (r.project_id === projectId) map.set(r.discipline.id, r.discipline)
    }
    return Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code))
  }, [projectId, projectDisciplines])

  const subSkillsForChoice = React.useMemo(() => {
    if (!projectId || !disciplineId) return [] as SRow[]
    const out: SRow[] = []
    for (const r of projectSubSkills) {
      if (r.project_id === projectId && r.sub_skill.discipline_id === disciplineId) out.push(r.sub_skill)
    }
    return out.sort((a, b) => a.code.localeCompare(b.code))
  }, [projectId, disciplineId, projectSubSkills])

  // Reset cascade when parent changes
  React.useEffect(() => { setDisciplineId(''); setSubSkillId('') }, [projectId])
  React.useEffect(() => { setSubSkillId('') }, [disciplineId])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    const res = await createWorkingSheet({
      project_id: projectId,
      discipline_id: disciplineId,
      sub_skill_id: subSkillId,
      line_type: lineType,
      deadline_date: deadline || null,
      deadline_notes: deadlineNotes.trim() || null,
    })
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    router.push(`/cost-control/working-sheets/${res.id}`)
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-800">{error}</div>}

      <div>
        <Label htmlFor="project">Project *</Label>
        <select
          id="project"
          value={projectId}
          onChange={e => setProjectId(e.target.value)}
          required
          className="mt-1 flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
        >
          <option value="">— choose project —</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
        </select>
      </div>

      <div>
        <Label htmlFor="discipline">Discipline *</Label>
        <select
          id="discipline"
          value={disciplineId}
          onChange={e => setDisciplineId(e.target.value)}
          required
          disabled={!projectId}
          className="mt-1 flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm disabled:bg-gray-50"
        >
          <option value="">— choose discipline —</option>
          {disciplinesForProject.map(d => <option key={d.id} value={d.id}>{d.code} · {d.name}</option>)}
        </select>
        {projectId && disciplinesForProject.length === 0 && (
          <p className="mt-1 text-xs text-amber-700">No disciplines enabled on this project yet. Configure via the project setup wizard.</p>
        )}
      </div>

      <div>
        <Label htmlFor="sub_skill">Sub-skill *</Label>
        <select
          id="sub_skill"
          value={subSkillId}
          onChange={e => setSubSkillId(e.target.value)}
          required
          disabled={!disciplineId}
          className="mt-1 flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm disabled:bg-gray-50"
        >
          <option value="">— choose sub-skill —</option>
          {subSkillsForChoice.map(s => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
        </select>
        {disciplineId && subSkillsForChoice.length === 0 && (
          <p className="mt-1 text-xs text-amber-700">No sub-skills enabled in this discipline for this project.</p>
        )}
      </div>

      <div>
        <Label htmlFor="line_type">Type</Label>
        <div className="mt-1 flex gap-2">
          {(['work', 'material'] as const).map(opt => (
            <button
              key={opt}
              type="button"
              onClick={() => setLineType(opt)}
              className={`flex-1 h-10 rounded-md border text-sm font-semibold transition-colors ${lineType === opt ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}
            >
              {opt === 'work' ? 'Work (labour / service)' : 'Material (procurement)'}
            </button>
          ))}
        </div>
      </div>

      {canSetDeadline ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-gray-100">
          <div>
            <Label htmlFor="deadline">Deadline</Label>
            <input
              id="deadline"
              type="date"
              value={deadline}
              onChange={e => setDeadline(e.target.value)}
              className="mt-1 flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
            />
            <p className="text-[11px] text-gray-500 mt-1">When does this work need to be approved + WO issued by?</p>
          </div>
          <div>
            <Label htmlFor="deadline_notes">Deadline notes</Label>
            <input
              id="deadline_notes"
              type="text"
              value={deadlineNotes}
              onChange={e => setDeadlineNotes(e.target.value)}
              placeholder="optional — e.g. site mobilisation tied to this"
              className="mt-1 flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
            />
          </div>
        </div>
      ) : (
        <p className="text-xs text-gray-500 pt-2 border-t border-gray-100">
          Deadlines are set by the Head once the sheet is raised. You don&apos;t need to enter one here.
        </p>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={busy || !projectId || !disciplineId || !subSkillId}>
          {busy ? 'Creating…' : 'Create Working Sheet →'}
        </Button>
      </div>
    </form>
  )
}
