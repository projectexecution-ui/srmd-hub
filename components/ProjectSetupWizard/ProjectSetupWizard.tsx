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
  /** Shown under the name to disambiguate similar names. */
  email?: string | null
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

/** Per-discipline mode preset used when resuming a half-finished setup. */
export interface DisciplineModePreset {
  discipline_id: string
  mode: 'detailed' | 'thumbrule'
  rate: string
  notes: string
}

interface ProjectSetupWizardProps {
  parentProjects: ParentProjectOption[]
  users: UserOption[]
  disciplines: DisciplineOption[]
  /** All sub-skills across all disciplines; wizard filters by picked disciplines in Step 3 */
  subSkills: SubSkillOption[]
  // ---- Resume props (all optional). When initialProjectId is set we skip
  // Step 1 entirely — the project basics row already exists. The wizard
  // opens on the first incomplete step.
  initialProjectId?: string
  initialStep?: 1 | 2 | 3
  initialPickedDisciplines?: string[]
  initialDisciplineModes?: DisciplineModePreset[]
  initialPickedSubSkills?: string[]
}

type Step = 1 | 2 | 3

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
  initialProjectId,
  initialStep,
  initialPickedDisciplines,
  initialDisciplineModes,
  initialPickedSubSkills,
}: ProjectSetupWizardProps) {
  const router = useRouter()
  // When resuming, seed step from the saved state. Default to step 1 for
  // brand-new flows.
  const [step, setStep] = React.useState<Step>(initialStep ?? 1)
  const [projectId, setProjectId] = React.useState<string | null>(initialProjectId ?? null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({})

  // Step 2 selection — when resuming, use what's saved. Otherwise default-
  // tick the "common 19" flagged disciplines.
  const [pickedDisciplines, setPickedDisciplines] = React.useState<Set<string>>(
    initialPickedDisciplines && initialPickedDisciplines.length > 0
      ? new Set(initialPickedDisciplines)
      : new Set(disciplines.filter(d => d.commonByDefault).map(d => d.id)),
  )
  // Mode + thumbrule rate per discipline. Default 'detailed' (= drawings
  // available, full BOQ). Toggling to 'thumbrule' enables a rate-per-sft
  // input. Only persisted for ticked disciplines.
  const [disciplineModes, setDisciplineModes] = React.useState<Map<string, { mode: 'detailed' | 'thumbrule'; rate: string; notes: string }>>(
    new Map((initialDisciplineModes ?? []).map(m => [m.discipline_id, { mode: m.mode, rate: m.rate, notes: m.notes }])),
  )

  // Step 3 selection — when resuming use saved; else empty (Step 2 will
  // pre-tick all sub-skills under picked disciplines).
  const [pickedSubSkills, setPickedSubSkills] = React.useState<Set<string>>(
    new Set(initialPickedSubSkills ?? []),
  )

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
    const configs = Array.from(pickedDisciplines).map(id => {
      const m = disciplineModes.get(id)
      const mode = m?.mode ?? 'detailed'
      const rate = m?.rate ? Number(m.rate) : null
      return {
        discipline_id: id,
        estimation_mode: mode,
        thumbrule_rate_per_sft: mode === 'thumbrule' && rate != null && Number.isFinite(rate) ? rate : null,
        thumbrule_notes: mode === 'thumbrule' ? (m?.notes ?? null) : null,
      }
    })
    const res = await setProjectDisciplines(projectId, configs)
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
    if (!res.ok) {
      setBusy(false)
      setError(res.error ?? 'Failed to save sub-skills')
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
      <StepRail step={step} onGo={setStep} />
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
          modes={disciplineModes}
          setModes={setDisciplineModes}
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
    </div>
  )
}

// ============================================================
// Step rail (1 / 2 / 3)
// ============================================================

function StepRail({ step, onGo }: { step: Step; onGo: (n: Step) => void }) {
  const items: Array<{ n: Step; label: string }> = [
    { n: 1, label: 'Basics' },
    { n: 2, label: 'Disciplines' },
    { n: 3, label: 'Sub-skills' },
  ]
  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-2">
      {items.map((it, i) => {
        const done = it.n < step
        const current = it.n === step
        // You can click any step you've already reached to jump back and edit
        // it (e.g. Sub-skills → Disciplines). Moving FORWARD stays via each
        // step's "Continue" button so its data is saved on the way — so future
        // steps aren't clickable here.
        const clickable = it.n <= step
        return (
          <React.Fragment key={it.n}>
            <button
              type="button"
              onClick={() => { if (clickable) onGo(it.n) }}
              disabled={!clickable}
              title={clickable ? `Go to ${it.label}` : 'Finish the current step to continue'}
              className={`flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                current
                  ? 'bg-blue-600 text-white'
                  : done
                    ? 'bg-green-100 text-green-800 hover:bg-green-200 cursor-pointer'
                    : 'bg-gray-100 text-gray-400 cursor-not-allowed'
              }`}
            >
              {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
              {it.n}. {it.label}
            </button>
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

// Derive a short code from the project name's word initials:
// "Admin Block Ground Floor" → "ABGF", "Admin Block 1st Floor" → "AB1F".
// Teams pick these exact codes by hand, so the field just fills itself in.
function deriveCode(name: string): string {
  return name
    .trim()
    .split(/[\s\-_/.,]+/)
    .filter(Boolean)
    .map(w => w[0])
    .join('')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, 12)
}

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
  // Main vs sub — the one choice people kept getting lost on. Make it an
  // explicit, up-front pick instead of a quiet "optional parent" dropdown.
  const [isSub, setIsSub] = React.useState(false)
  const [name, setName] = React.useState('')
  const [codeText, setCodeText] = React.useState('')
  const [codeEdited, setCodeEdited] = React.useState(false)
  const [parentId, setParentId] = React.useState('')

  // Auto-fill the code from the name until the user overrides it.
  const codeValue = codeEdited ? codeText : deriveCode(name)
  const parent = parentProjects.find(p => p.id === parentId) ?? null

  function err(field: string) {
    const e = fieldErrors[field]
    return e && e.length > 0 ? <p className="mt-1 text-xs text-red-600">{e[0]}</p> : null
  }

  return (
    <Card className="p-5">
      <h2 className="text-lg font-semibold text-gray-900 mb-1">Project basics</h2>
      <p className="text-sm text-gray-500 mb-4">Takes ~30 seconds. You can finish the rest later.</p>

      {/* The main/sub choice, up front and obvious. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-5">
        <TypeChoice
          active={!isSub}
          title="Main project"
          hint="A top-level project — e.g. Admin Block"
          onClick={() => { setIsSub(false); setParentId('') }}
          disabled={busy}
        />
        <TypeChoice
          active={isSub}
          title="Sub-project"
          hint="A part of an existing project — e.g. its Ground Floor"
          onClick={() => setIsSub(true)}
          disabled={busy}
        />
      </div>

      <form
        action={onSubmit}
        className="grid grid-cols-1 md:grid-cols-2 gap-4"
      >
        {isSub && (
          <div className="md:col-span-2">
            <Label htmlFor="parent_project_id">Part of which project? *</Label>
            <select
              id="parent_project_id"
              name="parent_project_id"
              required
              value={parentId}
              onChange={e => setParentId(e.target.value)}
              className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
              disabled={busy}
            >
              <option value="">— choose the parent project —</option>
              {parentProjects.map(p => (
                <option key={p.id} value={p.id}>{p.code} · {p.name}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-500">
              It shows grouped under {parent ? <b>{parent.name}</b> : 'this project'} on the Internal Estimate.
            </p>
          </div>
        )}

        <div className="md:col-span-2">
          <Label htmlFor="name">{isSub ? 'Sub-project name *' : 'Project name *'}</Label>
          <Input
            id="name" name="name" required disabled={busy}
            value={name} onChange={e => setName(e.target.value)}
            placeholder={isSub ? 'e.g. Admin Block Ground Floor' : 'e.g. Admin Block'}
          />
          <p className="mt-1 text-xs text-gray-500">
            {isSub
              ? 'Keep the parent name in front so lists stay clear — e.g. “Admin Block Ground Floor”, “Admin Block 1st Floor”.'
              : 'The building or scope this project covers.'}
          </p>
          {err('name')}
        </div>

        <div>
          <Label htmlFor="code">Short code *</Label>
          <Input
            id="code" name="code" required disabled={busy}
            value={codeValue}
            onChange={e => { setCodeText(e.target.value.toUpperCase()); setCodeEdited(true) }}
            placeholder="auto from name"
          />
          <p className="mt-1 text-xs text-gray-500">Fills in from the name — edit if you like. Must be unique.</p>
          {err('code')}
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
            {busy ? 'Creating…' : (isSub ? 'Create sub-project' : 'Create project')}
          </Button>
        </div>
      </form>
    </Card>
  )
}

function TypeChoice({
  active, title, hint, onClick, disabled,
}: {
  active: boolean
  title: string
  hint: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg border p-3 text-left transition-colors disabled:opacity-60 ${
        active ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500' : 'border-gray-200 bg-white hover:bg-gray-50'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={`h-3.5 w-3.5 rounded-full border-2 flex-shrink-0 ${active ? 'border-blue-600 bg-blue-600' : 'border-gray-300'}`} />
        <span className="text-sm font-semibold text-gray-900">{title}</span>
      </div>
      <p className="text-xs text-gray-500 mt-1 ml-5">{hint}</p>
    </button>
  )
}

// ============================================================
// Step 2 — Disciplines
// ============================================================

function Step2Disciplines({
  disciplines,
  picked,
  setPicked,
  modes,
  setModes,
  busy,
  onSaveAndContinue,
  onSkip,
}: {
  disciplines: DisciplineOption[]
  picked: Set<string>
  setPicked: (next: Set<string>) => void
  modes: Map<string, { mode: 'detailed' | 'thumbrule'; rate: string; notes: string }>
  setModes: (next: Map<string, { mode: 'detailed' | 'thumbrule'; rate: string; notes: string }>) => void
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

  function setMode(id: string, mode: 'detailed' | 'thumbrule') {
    const next = new Map(modes)
    const prev = next.get(id) ?? { mode: 'detailed', rate: '', notes: '' }
    next.set(id, { ...prev, mode })
    setModes(next)
  }

  function setRate(id: string, rate: string) {
    const next = new Map(modes)
    const prev = next.get(id) ?? { mode: 'thumbrule', rate: '', notes: '' }
    next.set(id, { ...prev, rate })
    setModes(next)
  }

  function setNotes(id: string, notes: string) {
    const next = new Map(modes)
    const prev = next.get(id) ?? { mode: 'thumbrule', rate: '', notes: '' }
    next.set(id, { ...prev, notes })
    setModes(next)
  }

  return (
    <Card className="p-5">
      <h2 className="text-lg font-semibold text-gray-900 mb-1">Applicable disciplines</h2>
      <p className="text-sm text-gray-500 mb-4">
        Tick the disciplines this project covers. For each, choose:
        <b className="ml-1">Detailed BOQ</b> when drawings are available,
        or <b>Thumbrule</b> when you only have a rate-per-sft estimate
        (drawings not ready yet).
      </p>

      <div className="space-y-2 mb-4">
        {disciplines.map(d => {
          const on = picked.has(d.id)
          const m = modes.get(d.id) ?? { mode: 'detailed' as const, rate: '', notes: '' }
          return (
            <div
              key={d.id}
              className={`rounded-md border transition-colors ${
                on ? 'border-blue-300 bg-blue-50/40' : 'border-gray-200 bg-white'
              }`}
            >
              <button
                type="button"
                onClick={() => toggle(d.id)}
                className="w-full flex items-center gap-2 p-3 text-left text-sm"
              >
                <input type="checkbox" checked={on} onChange={() => {}} className="pointer-events-none" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-xs text-gray-500">{d.code}</span>
                    <span className="font-semibold">{d.name}</span>
                  </div>
                </div>
              </button>

              {on && (
                <div className="px-3 pb-3 space-y-2">
                  <div className="flex gap-2">
                    <ModeChip
                      label="Detailed BOQ"
                      hint="Drawings available"
                      active={m.mode === 'detailed'}
                      onClick={() => setMode(d.id, 'detailed')}
                    />
                    <ModeChip
                      label="Thumbrule"
                      hint="No drawings — estimate by rate/sft"
                      active={m.mode === 'thumbrule'}
                      onClick={() => setMode(d.id, 'thumbrule')}
                    />
                  </div>
                  {m.mode === 'thumbrule' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <input
                        type="number" step="any" inputMode="decimal"
                        value={m.rate} onChange={e => setRate(d.id, e.target.value)}
                        placeholder="Rate (₹ / sft) — optional default"
                        className="flex h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm"
                      />
                      <input
                        type="text"
                        value={m.notes} onChange={e => setNotes(d.id, e.target.value)}
                        placeholder="Source of rate (optional)"
                        className="flex h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
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

function ModeChip({ label, hint, active, onClick }: { label: string; hint: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-md border px-3 py-2 text-left text-xs transition-colors ${
        active
          ? 'border-blue-500 bg-blue-100 text-blue-900'
          : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
      }`}
    >
      <div className="font-semibold">{label}</div>
      <div className="text-[11px] text-gray-500 mt-0.5">{hint}</div>
    </button>
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
          {busy ? 'Finishing…' : 'Finish setup'}
        </Button>
      </div>
    </Card>
  )
}
