'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { generateSmartWSCode } from '@/components/cost-control/ws-code-action'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Loader2, Send, Ruler } from 'lucide-react'

interface ProjectOpt { id: string; code: string; name: string; built_up_sft: number | null }
interface DRow      { id: string; code: string; name: string }
interface SRow      { id: string; discipline_id: string; code: string; name: string }

interface Props {
  projects: ProjectOpt[]
  projectDisciplines: Array<{ project_id: string; discipline: DRow; rate_per_sft: number | null; notes: string | null }>
  projectSubSkills: Array<{ project_id: string; sub_skill: SRow }>
  defaultProjectId?: string
  canSetDeadline?: boolean
}

function fmtINR(n: number): string {
  return n.toLocaleString('en-IN', { maximumFractionDigits: 0 })
}

export function NewWSThumbruleForm({
  projects, projectDisciplines, projectSubSkills, defaultProjectId, canSetDeadline = false,
}: Props) {
  const router = useRouter()
  const [projectId, setProjectId]     = useState(defaultProjectId ?? projects[0]?.id ?? '')
  const [disciplineId, setDisciplineId] = useState('')
  const [subSkillId, setSubSkillId]   = useState('')
  const [lineType, setLineType]       = useState<'work' | 'material'>('work')
  const [area, setArea]               = useState('')
  const [rate, setRate]               = useState('')
  const [notes, setNotes]             = useState('')
  const [deadline, setDeadline]       = useState('')
  const [busy, setBusy]               = useState(false)
  const [error, setError]             = useState<string | null>(null)

  const proj = projects.find(p => p.id === projectId)
  const disciplines = useMemo(
    () => projectDisciplines.filter(pd => pd.project_id === projectId),
    [projectDisciplines, projectId],
  )
  const subSkills = useMemo(
    () => projectSubSkills
      .filter(ps => ps.project_id === projectId && ps.sub_skill.discipline_id === disciplineId)
      .map(ps => ps.sub_skill),
    [projectSubSkills, projectId, disciplineId],
  )
  const pickedDiscipline = disciplines.find(d => d.discipline.id === disciplineId)

  // Auto-fill area from project's built-up sft + rate from discipline default
  useEffect(() => {
    if (!area && proj?.built_up_sft != null) setArea(String(proj.built_up_sft))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proj?.built_up_sft])
  useEffect(() => {
    if (pickedDiscipline?.rate_per_sft != null) setRate(String(pickedDiscipline.rate_per_sft))
    if (pickedDiscipline?.notes && !notes) setNotes(pickedDiscipline.notes)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedDiscipline])

  const total = useMemo(() => {
    const a = Number(area), r = Number(rate)
    if (!Number.isFinite(a) || !Number.isFinite(r) || a <= 0 || r <= 0) return null
    return a * r
  }, [area, rate])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!projectId || !disciplineId || !subSkillId) { setError('Pick project / discipline / sub-skill'); return }
    if (total == null) { setError('Enter a positive built-up area and rate'); return }
    setBusy(true); setError(null)

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setError('Not signed in'); setBusy(false); return }

    // Snapshot past approved spend in this sub-skill so the past-spend strip is right
    const { data: past } = await supabase
      .from('cc_working_sheets')
      .select('total_amount')
      .eq('project_id', projectId)
      .eq('sub_skill_id', subSkillId)
      .in('status', ['approved', 'wo_issued', 'paid'])
    const pastSnap = (past ?? []).reduce((s, r) => s + Number(r.total_amount ?? 0), 0)

    // Smart ws_code — e.g. P2A02-1102-T01 (Thumbrule mode).
    const wsCode = await generateSmartWSCode({
      project_id: projectId,
      sub_skill_id: subSkillId,
      entry_mode: 'thumbrule',
    })

    const summaryNotes = [
      `Thumbrule estimate: ${fmtINR(Number(area))} sft × ₹${fmtINR(Number(rate))}/sft`,
      notes.trim() ? `· ${notes.trim()}` : null,
    ].filter(Boolean).join(' ')

    const { data: ws, error: wsErr } = await supabase
      .from('cc_working_sheets')
      .insert({
        ws_code: wsCode,
        project_id: projectId,
        discipline_id: disciplineId,
        sub_skill_id: subSkillId,
        line_type: lineType,
        status: 'draft',
        engineer_id: user.id,
        total_amount: total,
        entry_mode: 'thumbrule',
        summary_total: total,
        summary_notes: summaryNotes,
        past_approved_in_subskill: pastSnap,
        ...(canSetDeadline && deadline ? { deadline_date: deadline } : {}),
      })
      .select('id')
      .single()
    if (wsErr || !ws) { setError(`Save failed: ${wsErr?.message ?? 'unknown'}`); setBusy(false); return }

    router.push(`/cost-control/working-sheets/${ws.id}`)
    router.refresh()
  }

  if (projects.length === 0) {
    return <p className="text-sm text-gray-600">No active Cost Control projects yet.</p>
  }
  if (projectDisciplines.length === 0) {
    return (
      <p className="text-sm text-gray-600">
        No disciplines on any project are flagged <b>thumbrule</b>. Open a project&apos;s setup wizard
        and switch the discipline mode to Thumbrule first.
      </p>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <Label>Project *</Label>
          <select value={projectId} onChange={e => { setProjectId(e.target.value); setDisciplineId(''); setSubSkillId('') }}
            required className="mt-1 flex h-10 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm">
            {projects.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
          </select>
        </div>
        <div>
          <Label>Line type *</Label>
          <select value={lineType} onChange={e => setLineType(e.target.value as 'work' | 'material')}
            className="mt-1 flex h-10 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm">
            <option value="work">Work</option>
            <option value="material">Material</option>
          </select>
        </div>
        <div>
          <Label>Discipline (thumbrule only) *</Label>
          <select value={disciplineId} onChange={e => { setDisciplineId(e.target.value); setSubSkillId('') }}
            required disabled={disciplines.length === 0}
            className="mt-1 flex h-10 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm">
            <option value="">— Select —</option>
            {disciplines.map(pd => <option key={pd.discipline.id} value={pd.discipline.id}>{pd.discipline.code} — {pd.discipline.name}</option>)}
          </select>
          {disciplines.length === 0 && (
            <p className="text-[11px] text-amber-700 mt-1">This project has no thumbrule disciplines. Switch a discipline&apos;s mode to Thumbrule via the setup wizard first.</p>
          )}
        </div>
        <div>
          <Label>Sub-skill *</Label>
          <select value={subSkillId} onChange={e => setSubSkillId(e.target.value)}
            required disabled={subSkills.length === 0}
            className="mt-1 flex h-10 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm">
            <option value="">— Select —</option>
            {subSkills.map(s => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
          </select>
        </div>
      </div>

      <div className="pt-2 border-t border-gray-100 space-y-3">
        <div className="rounded-lg bg-indigo-50/50 border border-indigo-200 p-3 inline-flex items-start gap-2">
          <Ruler className="h-4 w-4 text-indigo-600 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-indigo-900">
            Total = <b>built-up area × rate per sft</b>. Built-up area pre-fills from the project (editable);
            rate pre-fills from the discipline setup. Override either if your scope differs.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <Label>Built-up area (sft) *</Label>
            <Input type="number" step="any" inputMode="decimal" value={area} onChange={e => setArea(e.target.value)} placeholder="e.g. 42000" className="mt-1" />
            {proj?.built_up_sft != null && (
              <p className="text-[11px] text-gray-500 mt-1">Project default: {fmtINR(proj.built_up_sft)} sft</p>
            )}
          </div>
          <div>
            <Label>Rate (₹ / sft) *</Label>
            <Input type="number" step="any" inputMode="decimal" value={rate} onChange={e => setRate(e.target.value)} placeholder="e.g. 250" className="mt-1" />
            {pickedDiscipline?.rate_per_sft != null && (
              <p className="text-[11px] text-gray-500 mt-1">Discipline default: ₹{fmtINR(pickedDiscipline.rate_per_sft)}/sft</p>
            )}
          </div>
          <div>
            <Label>Computed total</Label>
            <div className="mt-1 flex h-10 items-center rounded-xl border border-indigo-200 bg-indigo-50 px-3 text-sm font-semibold text-indigo-900 font-mono">
              {total != null ? `₹${fmtINR(total)}` : '—'}
            </div>
          </div>
        </div>
      </div>

      <div>
        <Label>Notes</Label>
        <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Basis of rate / source / assumptions" className="mt-1" />
      </div>

      {canSetDeadline && (
        <div>
          <Label>Deadline</Label>
          <Input type="date" value={deadline} onChange={e => setDeadline(e.target.value)} className="mt-1" />
        </div>
      )}

      <Button type="submit" disabled={busy || total == null}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        Save thumbrule estimate
      </Button>
    </form>
  )
}
