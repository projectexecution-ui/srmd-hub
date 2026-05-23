'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CheckCircle2, Circle } from 'lucide-react'
import {
  createProjectBasics,
  setProjectDisciplines,
  setProjectSubSkills,
  assignProjectEngineers,
  finalizeProjectSetup,
} from './actions'

export interface ParentProjectOption {
  id: string
  code: string
  name: string
}

export interface UserOption {
  id: string
  name: string
}

export interface DisciplineOption {
  id: string
  code: string
  name: string
  /** Pre-tick the "common 19" disciplines */
  commonByDefault?: boolean
}

export interface SubSkillOption {
  id: string
  discipline_id: string
  code: string
  name: string
}

interface ProjectSetupWizardProps {
  parentProjects: ParentProjectOption[]
  users: UserOption[]
  disciplines: DisciplineOption[]
  /** All sub-skills across all disciplines; wizard filters by picked disciplines in Step 3 */
  subSkills: SubSkillOption[]
}

type Step = 1 | 2 | 3 | 4

/**
 * Shared Project Setup Wizard. Used by Cost Control today; reusable by any
 * future module that follows the project-setup pattern (Attendance integration,
 * JMR, etc.) Pass it module-specific dropdowns + discipline list.
 *
 * Spec: docs/cost-control-spec.md section 4
 */
export function ProjectSetupWizard({
  parentProjects,
  users,
  disciplines,
  subSkills,
}: ProjectSetupWizardProps) {
  const router = useRouter()
  const [step, setStep] = React.useState<Step>(1)
  const [projectId, setProjectId] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({})

  // Step 2 selection — default-tick the disciplines flagged as common.
  const [pickedDisciplines, setPickedDisciplines] = React.useState<Set<string>>(
    new Set(disciplines.filter(d => d.commonByDefault).map(d => d.id)),
  )

  // Step 3 selection — all sub-skills of picked disciplines, pre-ticked.
  const [pickedSubSkills, setPickedSubSkills] = React.useState<Set<string>>(new Set())

  // Step 4 — engineer assignments: userId → set of disciplineIds
  const [engineerPicks, setEngineerPicks] = React.useState<Map<string, Set<string>>>(new Map())

  async function handleStep1(formData: FormData) {
    setBusy(true)
    setError(null)
    setFieldErrors({})
    const res = await createProjectBasics(formData)
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      if (res.fieldErrors) setFieldErrors(res.fieldErrors)
      return
    }
    setProjectId(res.projectId)
    setStep(2)
  }

  async function handleStep2() {
    if (!projectId) return
    setBusy(true)
    setError(null)
    const res = await setProjectDisciplines(projectId, Array.from(pickedDisciplines))
    setBusy(false)
    if (!res.ok) {
      setError(res.error ?? 'Failed to save disciplines')
      return
    }
    // Pre-tick all sub-skills of picked disciplines for Step 3
    const subForPicked = subSkills.filter(s => pickedDisciplines.has(s.discipline_id))
    setPickedSubSkills(new Set(subForPicked.map(s => s.id)))
    setStep(3)
  }

  async function handleStep3() {
    if (!projectId) return
    setBusy(true)
    setError(null)
    const res = await setProjectSubSkills(projectId, Array.from(pickedSubSkills))
    setBusy(false)
    if (!res.ok) {
      setError(res.error ?? 'Failed to save sub-skills')
      return
    }
    setStep(4)
  }

  async function handleStep4() {
    if (!projectId) return
    setBusy(true)
    setError(null)
    const assignments = Array.from(engineerPicks.entries())
      .filter(([, dids]) => dids.size > 0)
      .map(([user_id, dids]) => ({ user_id, discipline_ids: Array.from(dids) }))
    const res = await assignProjectEngineers(projectId, assignments)
    if (!res.ok) {
      setBusy(false)
      setError(res.error ?? 'Failed to save engineer assignments')
      return
    }
    await finalizeProjectSetup(projectId)
    // finalize calls redirect()
  }

  function handleSkipToProject() {
    if (!projectId) return
    // Don't 100% — leave it incomplete so the banner nudges later.
    router.push(`/cost-control/projects/${projectId}`)
  }

  return (
    <div className="space-y-4">
      <StepRail step={step} />
      {error && (
        <Card className="border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</Card>
      )}

      {step === 1 && (
        <Step1Basics
          parentProjects={parentProjects}
          users={users}
          busy={busy}
          fieldErrors={fieldErrors}
          onSubmit={handleStep1}
        />
      )}

      {step === 2 && (
        <Step2Disciplines
          disciplines={disciplines}
          picked={pickedDisciplines}
          setPicked={setPickedDisciplines}
          busy={busy}
          onSaveAndContinue={handleStep2}
          onSkip={handleSkipToProject}
        />
      )}

      {step === 3 && (
        <Step3SubSkills
          disciplines={disciplines.filter(d => pickedDisciplines.has(d.id))}
          subSkills={subSkills.filter(s => pickedDisciplines.has(s.discipline_id))}
          picked={pickedSubSkills}
          setPicked={setPickedSubSkills}
          busy={busy}
          onContinue={handleStep3}
          onSkip={handleSkipToProject}
        />
      )}

      {step === 4 && (
        <Step4Engineers
          users={users}
          disciplines={disciplines.filter(d => pickedDisciplines.has(d.id))}
          picks={engineerPicks}
          setPicks={setEngineerPicks}
          busy={busy}
          onFinish={handleStep4}
          onSkip={handleSkipToProject}
        />
      )}
    </div>
  )
}

// ============================================================
// Step rail (1 / 2 / 3 / 4)
// ============================================================

function StepRail({ step }: { step: Step }) {
  const items: Array<{ n: Step; label: string }> = [
    { n: 1, label: 'Basics' },
    { n: 2, label: 'Disciplines' },
    { n: 3, label: 'Sub-skills' },
    { n: 4, label: 'Engineers' },
  ]
  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-2">
      {items.map((it, i) => {
        const done = it.n < step
        const current = it.n === step
        return (
          <React.Fragment key={it.n}>
            <div
              className={`flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${
                current
                  ? 'bg-blue-600 text-white'
                  : done
                    ? 'bg-green-100 text-green-800'
                    : 'bg-gray-100 text-gray-500'
              }`}
            >
              {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
              {it.n}. {it.label}
            </div>
            {i < items.length - 1 && <div className="h-px w-4 bg-gray-200" />}
          </React.Fragment>
        )
      })}
    </div>
  )
}

// ============================================================
// Step 1 — Basics
// ============================================================

function Step1Basics({
  parentProjects,
  users,
  busy,
  fieldErrors,
  onSubmit,
}: {
  parentProjects: ParentProjectOption[]
  users: UserOption[]
  busy: boolean
  fieldErrors: Record<string, string[]>
  onSubmit: (fd: FormData) => Promise<void>
}) {
  function err(name: string) {
    const e = fieldErrors[name]
    return e && e.length > 0 ? <p className="mt-1 text-xs text-red-600">{e[0]}</p> : null
  }
  return (
    <Card className="p-5">
      <h2 className="text-lg font-semibold text-gray-900 mb-1">Project basics</h2>
      <p className="text-sm text-gray-500 mb-4">Takes ~30 seconds. You can finish the rest later.</p>

      <form
        action={onSubmit}
        className="grid grid-cols-1 md:grid-cols-2 gap-4"
      >
        <div className="md:col-span-2">
          <Label htmlFor="name">Project name *</Label>
          <Input id="name" name="name" required placeholder="e.g. NGH D" disabled={busy} />
          {err('name')}
        </div>

        <div>
          <Label htmlFor="code">Short code *</Label>
          <Input id="code" name="code" required placeholder="NGH-D" disabled={busy} />
          {err('code')}
        </div>

        <div>
          <Label htmlFor="parent_project_id">Parent project (optional)</Label>
          <select
            id="parent_project_id"
            name="parent_project_id"
            className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
            disabled={busy}
          >
            <option value="">— top-level —</option>
            {parentProjects.map(p => (
              <option key={p.id} value={p.id}>{p.code} · {p.name}</option>
            ))}
          </select>
        </div>

        <div>
          <Label htmlFor="built_up_sft">Built-up Sft</Label>
          <Input id="built_up_sft" name="built_up_sft" type="number" placeholder="e.g. 12000" disabled={busy} />
        </div>

        <div>
          <Label htmlFor="pm_user_id">Project Manager</Label>
          <select
            id="pm_user_id"
            name="pm_user_id"
            className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
            disabled={busy}
          >
            <option value="">— assign later —</option>
            {users.map(u => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </div>

        <div>
          <Label htmlFor="start_date">Start date</Label>
          <Input id="start_date" name="start_date" type="date" disabled={busy} />
        </div>

        <div>
          <Label htmlFor="target_completion">Target completion</Label>
          <Input id="target_completion" name="target_completion" type="date" disabled={busy} />
        </div>

        <div className="md:col-span-2 flex justify-end">
          <Button type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create Project'}
          </Button>
        </div>
      </form>
    </Card>
  )
}

// ============================================================
// Step 2 — Disciplines
// ============================================================

function Step2Disciplines({
  disciplines,
  picked,
  setPicked,
  busy,
  onSaveAndContinue,
  onSkip,
}: {
  disciplines: DisciplineOption[]
  picked: Set<string>
  setPicked: (next: Set<string>) => void
  busy: boolean
  onSaveAndContinue: () => Promise<void>
  onSkip: () => void
}) {
  function toggle(id: string) {
    const next = new Set(picked)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setPicked(next)
  }

  return (
    <Card className="p-5">
      <h2 className="text-lg font-semibold text-gray-900 mb-1">Applicable disciplines</h2>
      <p className="text-sm text-gray-500 mb-4">
        Common disciplines are pre-ticked. Untick the ones not applicable.
        You can add more anytime from the project page.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 mb-4">
        {disciplines.map(d => {
          const on = picked.has(d.id)
          return (
            <button
              key={d.id}
              type="button"
              onClick={() => toggle(d.id)}
              className={`flex items-start gap-2 rounded-md border p-3 text-left text-sm transition-colors ${
                on
                  ? 'border-blue-300 bg-blue-50 text-blue-900'
                  : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              <input
                type="checkbox"
                checked={on}
                onChange={() => {}}
                className="mt-0.5 pointer-events-none"
              />
              <div className="min-w-0">
                <div className="font-mono text-xs text-gray-500">{d.code}</div>
                <div className="font-semibold truncate">{d.name}</div>
              </div>
            </button>
          )
        })}
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onSkip} disabled={busy}>Skip — I&apos;ll do this later</Button>
        <Button onClick={onSaveAndContinue} disabled={busy}>
          {busy ? 'Saving…' : 'Save and Continue →'}
        </Button>
      </div>
    </Card>
  )
}

// ============================================================
// Step 3 — Sub-skills per discipline
// ============================================================

function Step3SubSkills({
  disciplines,
  subSkills,
  picked,
  setPicked,
  busy,
  onContinue,
  onSkip,
}: {
  disciplines: DisciplineOption[]
  subSkills: SubSkillOption[]
  picked: Set<string>
  setPicked: (next: Set<string>) => void
  busy: boolean
  onContinue: () => Promise<void>
  onSkip: () => void
}) {
  function toggle(id: string) {
    const next = new Set(picked)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setPicked(next)
  }

  function setAllForDiscipline(disciplineId: string, on: boolean) {
    const next = new Set(picked)
    for (const s of subSkills) {
      if (s.discipline_id !== disciplineId) continue
      if (on) next.add(s.id)
      else next.delete(s.id)
    }
    setPicked(next)
  }

  return (
    <Card className="p-5">
      <h2 className="text-lg font-semibold text-gray-900 mb-1">Sub-skills per discipline</h2>
      <p className="text-sm text-gray-500 mb-4">
        Untick anything that doesn&apos;t apply. All are pre-ticked. You can also add or remove sub-skills later from the project page.
      </p>

      <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
        {disciplines.length === 0 && (
          <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 p-6 text-center text-sm text-gray-500">
            You didn&apos;t pick any disciplines in Step 2. Skip this step or go back and pick at least one.
          </div>
        )}
        {disciplines.map(d => {
          const skillsOfD = subSkills.filter(s => s.discipline_id === d.id)
          const allOn = skillsOfD.length > 0 && skillsOfD.every(s => picked.has(s.id))
          const someOn = skillsOfD.some(s => picked.has(s.id))
          return (
            <div key={d.id} className="rounded-md border border-gray-200 bg-white">
              <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2 bg-gray-50 rounded-t-md">
                <div className="text-sm">
                  <span className="font-mono text-xs text-gray-500 mr-2">{d.code}</span>
                  <span className="font-semibold text-gray-900">{d.name}</span>
                  <span className="ml-2 text-xs text-gray-500">
                    {skillsOfD.filter(s => picked.has(s.id)).length} of {skillsOfD.length} picked
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setAllForDiscipline(d.id, !allOn)}
                  className="text-xs font-semibold text-blue-700 hover:underline"
                >
                  {allOn ? 'Uncheck all' : someOn ? 'Check all' : 'Check all'}
                </button>
              </div>
              {skillsOfD.length === 0 ? (
                <p className="px-3 py-3 text-xs text-gray-500 italic">
                  No sub-skills seeded for this discipline yet.
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-1 p-2">
                  {skillsOfD.map(s => {
                    const on = picked.has(s.id)
                    return (
                      <label
                        key={s.id}
                        className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer ${on ? 'bg-blue-50 text-blue-900' : 'hover:bg-gray-50 text-gray-700'}`}
                      >
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => toggle(s.id)}
                          className="h-3.5 w-3.5"
                        />
                        <span className="font-mono text-xs text-gray-500">{s.code}</span>
                        <span className="truncate">{s.name}</span>
                      </label>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onSkip} disabled={busy}>Skip — Configure As I Go</Button>
        <Button onClick={onContinue} disabled={busy}>
          {busy ? 'Saving…' : 'Save and Continue →'}
        </Button>
      </div>
    </Card>
  )
}

// ============================================================
// Step 4 — Engineer assignments
// ============================================================

function Step4Engineers({
  users,
  disciplines,
  picks,
  setPicks,
  busy,
  onFinish,
  onSkip,
}: {
  users: UserOption[]
  disciplines: DisciplineOption[]
  picks: Map<string, Set<string>>
  setPicks: (next: Map<string, Set<string>>) => void
  busy: boolean
  onFinish: () => Promise<void>
  onSkip: () => void
}) {
  function toggleUser(userId: string) {
    const next = new Map(picks)
    if (next.has(userId)) next.delete(userId)
    else next.set(userId, new Set())
    setPicks(next)
  }
  function toggleDiscipline(userId: string, disciplineId: string) {
    const next = new Map(picks)
    const set = new Set(next.get(userId) ?? [])
    if (set.has(disciplineId)) set.delete(disciplineId)
    else set.add(disciplineId)
    next.set(userId, set)
    setPicks(next)
  }

  return (
    <Card className="p-5">
      <h2 className="text-lg font-semibold text-gray-900 mb-1">Assign engineers</h2>
      <p className="text-sm text-gray-500 mb-4">
        Pick engineers and, for each, the disciplines they own on this project. You can leave this empty and assign later from the project page.
      </p>

      {users.length === 0 ? (
        <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 p-6 text-center text-sm text-gray-500">
          No active users in the system yet. Skip for now — invite engineers from /admin/users then come back.
        </div>
      ) : (
        <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
          {users.map(u => {
            const on = picks.has(u.id)
            const userDisciplines = picks.get(u.id) ?? new Set<string>()
            return (
              <div key={u.id} className={`rounded-md border ${on ? 'border-blue-200 bg-blue-50/40' : 'border-gray-200 bg-white'}`}>
                <label className="flex items-center gap-2 px-3 py-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggleUser(u.id)}
                    className="h-4 w-4"
                  />
                  <span className="text-sm font-semibold text-gray-900">{u.name}</span>
                  {on && (
                    <span className="ml-auto text-xs text-blue-700">
                      {userDisciplines.size} of {disciplines.length} disciplines
                    </span>
                  )}
                </label>
                {on && disciplines.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-1 px-3 pb-3 pt-1 border-t border-blue-100">
                    {disciplines.map(d => {
                      const dOn = userDisciplines.has(d.id)
                      return (
                        <label
                          key={d.id}
                          className={`flex items-center gap-2 rounded-md px-2 py-1 text-xs cursor-pointer ${dOn ? 'bg-blue-100 text-blue-900' : 'text-gray-700 hover:bg-gray-50'}`}
                        >
                          <input
                            type="checkbox"
                            checked={dOn}
                            onChange={() => toggleDiscipline(u.id, d.id)}
                            className="h-3.5 w-3.5"
                          />
                          <span className="font-mono text-[10px] text-gray-500">{d.code}</span>
                          <span className="truncate">{d.name}</span>
                        </label>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onSkip} disabled={busy}>Skip — Open Project</Button>
        <Button onClick={onFinish} disabled={busy}>
          {busy ? 'Finishing…' : 'Finish Setup & Open Project'}
        </Button>
      </div>
    </Card>
  )
}
