'use client'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Loader2, Check, Plus, Trash2, X, Power, PowerOff, ArrowRight, ShieldAlert,
  Flag, Square,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { RoleLabelMap } from '@/lib/role-labels'

interface Rule {
  id: string
  module_slug: string
  doc_type: string
  from_stage: string
  to_stage: string
  approver_role: string
  override_role: string | null
  amount_cap_max: number | null
  requires_remarks: boolean
  is_active: boolean
  notes: string | null
}

interface Stage {
  id: string
  module_slug: string
  doc_type: string
  stage: string
  sequence: number
  is_initial: boolean
  is_terminal: boolean
}

interface Props {
  initial: Rule[]
  initialStages: Stage[]
  roles: string[]
  roleLabels: RoleLabelMap
  moduleLabels: Record<string, string>
}

type DraftRule = {
  tempId: string
  module_slug: string
  doc_type: string
  from_stage: string
  to_stage: string
  approver_role: string
  override_role: string
  amount_cap_max: string
  notes: string
}

function newDraft(module_slug: string, doc_type: string): DraftRule {
  return {
    tempId: crypto.randomUUID(),
    module_slug,
    doc_type,
    from_stage: '',
    to_stage: '',
    approver_role: '',
    override_role: '',
    amount_cap_max: '',
    notes: '',
  }
}

function fmtRoleLabel(role: string | null | undefined, labels: RoleLabelMap): string {
  if (!role) return '—'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (labels as any)[role]?.label || role
}

export default function ApprovalsMatrix({ initial, initialStages, roles, roleLabels, moduleLabels }: Props) {
  const router = useRouter()
  const [rules, setRules]   = useState<Rule[]>(initial)
  const [stages, setStages] = useState<Stage[]>(initialStages)
  const [drafts, setDrafts] = useState<DraftRule[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [error, setError]   = useState<string | null>(null)

  // Group by module → doc_type for display
  const grouped = useMemo(() => {
    const map = new Map<string, Map<string, Rule[]>>()
    for (const r of rules) {
      if (!map.has(r.module_slug)) map.set(r.module_slug, new Map())
      const sub = map.get(r.module_slug)!
      if (!sub.has(r.doc_type)) sub.set(r.doc_type, [])
      sub.get(r.doc_type)!.push(r)
    }
    return map
  }, [rules])

  // Stages keyed by `${module}::${doc_type}` — sorted by sequence
  const stagesByDoc = useMemo(() => {
    const map = new Map<string, Stage[]>()
    for (const s of stages) {
      const k = `${s.module_slug}::${s.doc_type}`
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(s)
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => a.sequence - b.sequence || a.stage.localeCompare(b.stage))
    }
    return map
  }, [stages])

  const stageNamesFor = (mod: string, doc: string): string[] =>
    (stagesByDoc.get(`${mod}::${doc}`) ?? []).map(s => s.stage)

  // ------- Mutators -------

  async function updateRule(id: string, patch: Partial<Rule>) {
    setBusyId(id); setError(null)
    const prev = rules
    setRules(rs => rs.map(r => r.id === id ? { ...r, ...patch } : r))
    const supabase = createClient()
    const { error } = await supabase.from('approval_rules').update(patch).eq('id', id)
    setBusyId(null)
    if (error) {
      setError(error.message)
      setRules(prev)
      return
    }
    setSavedId(id)
    setTimeout(() => setSavedId(s => s === id ? null : s), 1500)
    router.refresh()
  }

  async function deleteRule(id: string) {
    if (!confirm('Delete this rule?')) return
    setBusyId(id); setError(null)
    const prev = rules
    setRules(rs => rs.filter(r => r.id !== id))
    const supabase = createClient()
    const { error } = await supabase.from('approval_rules').delete().eq('id', id)
    setBusyId(null)
    if (error) { setError(error.message); setRules(prev); return }
    router.refresh()
  }

  function startNewRule(module_slug: string, doc_type: string) {
    setDrafts(ds => [...ds, newDraft(module_slug, doc_type)])
  }

  function patchDraft(tempId: string, patch: Partial<DraftRule>) {
    setDrafts(ds => ds.map(d => d.tempId === tempId ? { ...d, ...patch } : d))
  }

  function cancelDraft(tempId: string) {
    setDrafts(ds => ds.filter(d => d.tempId !== tempId))
  }

  async function saveDraft(tempId: string) {
    const d = drafts.find(x => x.tempId === tempId)
    if (!d) return
    if (!d.from_stage.trim() || !d.to_stage.trim() || !d.approver_role) {
      setError('From, To, and Approver are required')
      return
    }
    setBusyId(tempId); setError(null)
    const supabase = createClient()
    const cap = d.amount_cap_max.trim() === '' ? null : Number(d.amount_cap_max)
    const payload = {
      module_slug:   d.module_slug,
      doc_type:      d.doc_type,
      from_stage:    d.from_stage.trim(),
      to_stage:      d.to_stage.trim(),
      approver_role: d.approver_role,
      override_role: d.override_role || null,
      amount_cap_max: cap,
      notes:         d.notes.trim() || null,
      is_active:     true,
    }
    const { data, error } = await supabase
      .from('approval_rules')
      .insert(payload)
      .select('*')
      .single()
    setBusyId(null)
    if (error) { setError(error.message); return }
    setRules(rs => [...rs, data as Rule].sort((a, b) =>
      a.module_slug.localeCompare(b.module_slug) ||
      a.doc_type.localeCompare(b.doc_type) ||
      a.from_stage.localeCompare(b.from_stage) ||
      a.to_stage.localeCompare(b.to_stage),
    ))
    setDrafts(ds => ds.filter(x => x.tempId !== tempId))
    router.refresh()
  }

  // ------- Stage mutators -------

  async function addStage(module_slug: string, doc_type: string, stage: string) {
    const name = stage.trim()
    if (!name) return
    setBusyId(`stage:${module_slug}:${doc_type}:new`); setError(null)
    const supabase = createClient()
    const { data, error } = await supabase
      .from('approval_stages')
      .insert({ module_slug, doc_type, stage: name, sequence: (stagesByDoc.get(`${module_slug}::${doc_type}`)?.length ?? 0) * 10 + 10 })
      .select('*')
      .single()
    setBusyId(null)
    if (error) { setError(error.message); return }
    setStages(ss => [...ss, data as Stage])
    router.refresh()
  }

  async function renameStage(s: Stage, next: string) {
    const name = next.trim()
    if (!name || name === s.stage) return
    setBusyId(`stage:${s.id}`); setError(null)
    const prev = stages
    setStages(ss => ss.map(x => x.id === s.id ? { ...x, stage: name } : x))
    const supabase = createClient()
    // Cascade-rename: any approval_rule referencing the old stage in
    // this (module, doc_type) gets updated to the new name.
    const { error: stErr } = await supabase
      .from('approval_stages')
      .update({ stage: name })
      .eq('id', s.id)
    if (stErr) { setStages(prev); setBusyId(null); setError(stErr.message); return }
    const { error: rfErr } = await supabase
      .from('approval_rules')
      .update({ from_stage: name })
      .eq('module_slug', s.module_slug)
      .eq('doc_type', s.doc_type)
      .eq('from_stage', s.stage)
    if (rfErr) { setBusyId(null); setError(rfErr.message); return }
    const { error: rtErr } = await supabase
      .from('approval_rules')
      .update({ to_stage: name })
      .eq('module_slug', s.module_slug)
      .eq('doc_type', s.doc_type)
      .eq('to_stage', s.stage)
    setBusyId(null)
    if (rtErr) { setError(rtErr.message); return }
    setRules(rs => rs.map(r => ({
      ...r,
      from_stage: r.module_slug === s.module_slug && r.doc_type === s.doc_type && r.from_stage === s.stage ? name : r.from_stage,
      to_stage:   r.module_slug === s.module_slug && r.doc_type === s.doc_type && r.to_stage   === s.stage ? name : r.to_stage,
    })))
    router.refresh()
  }

  async function deleteStage(s: Stage) {
    // Block delete if any rule references this stage
    const inUse = rules.some(r =>
      r.module_slug === s.module_slug && r.doc_type === s.doc_type &&
      (r.from_stage === s.stage || r.to_stage === s.stage))
    if (inUse) {
      setError(`Cannot delete "${s.stage}" — used by one or more rules. Edit or delete those rules first.`)
      return
    }
    if (!confirm(`Delete stage "${s.stage}"?`)) return
    setBusyId(`stage:${s.id}`); setError(null)
    const supabase = createClient()
    const { error } = await supabase.from('approval_stages').delete().eq('id', s.id)
    setBusyId(null)
    if (error) { setError(error.message); return }
    setStages(ss => ss.filter(x => x.id !== s.id))
    router.refresh()
  }

  // ------- Render -------

  const moduleKeys = Array.from(grouped.keys()).sort()
  const draftsBy = (mod: string, doc: string) => drafts.filter(d => d.module_slug === mod && d.doc_type === doc)

  return (
    <div className="space-y-5">
      {error && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-sm text-rose-700">{error}</div>
      )}

      {moduleKeys.length === 0 && drafts.length === 0 && (
        <Card className="p-6 text-sm text-gray-500 text-center">
          No approval rules yet.
        </Card>
      )}

      {moduleKeys.map(modKey => {
        const subMap = grouped.get(modKey)!
        const docKeys = Array.from(subMap.keys()).sort()
        return (
          <Card key={modKey}>
            <CardContent className="pt-5">
              <div className="flex items-baseline justify-between mb-3">
                <h2 className="text-base font-bold text-gray-900">
                  {moduleLabels[modKey] || modKey}
                </h2>
                <span className="text-[11px] font-mono text-gray-400">{modKey}</span>
              </div>

              {docKeys.map(docKey => {
                const rs = subMap.get(docKey)!
                const docDrafts = draftsBy(modKey, docKey)
                const docStages = stagesByDoc.get(`${modKey}::${docKey}`) ?? []
                return (
                  <div key={docKey} className="mb-5 last:mb-0">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs uppercase tracking-wide font-semibold text-gray-500">
                        {docKey}
                      </p>
                      <Button size="sm" variant="outline" onClick={() => startNewRule(modKey, docKey)}>
                        <Plus className="h-4 w-4" /> Add rule
                      </Button>
                    </div>

                    {/* Stages chip row */}
                    <StagesEditor
                      stages={docStages}
                      busyKeyPrefix={`stage:`}
                      busyKey={busyId}
                      onRename={(s, next) => renameStage(s, next)}
                      onDelete={(s) => deleteStage(s)}
                      onAdd={(name) => addStage(modKey, docKey, name)}
                    />

                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <thead className="bg-gray-50">
                          <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500">
                            <th className="px-2 py-2">From stage</th>
                            <th className="px-2 py-2"></th>
                            <th className="px-2 py-2">To stage</th>
                            <th className="px-2 py-2">Approver</th>
                            <th className="px-2 py-2">Override</th>
                            <th className="px-2 py-2 text-right">Amount cap</th>
                            <th className="px-2 py-2 text-center w-14">Active</th>
                            <th className="px-2 py-2 w-10"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {rs.map(r => (
                            <RuleRow key={r.id}
                              rule={r}
                              roles={roles}
                              roleLabels={roleLabels}
                              stageOptions={stageNamesFor(modKey, docKey)}
                              busy={busyId === r.id}
                              saved={savedId === r.id}
                              onUpdate={(patch) => updateRule(r.id, patch)}
                              onDelete={() => deleteRule(r.id)}
                            />
                          ))}
                          {docDrafts.map(d => (
                            <DraftRow key={d.tempId}
                              draft={d}
                              roles={roles}
                              roleLabels={roleLabels}
                              stageOptions={stageNamesFor(modKey, docKey)}
                              busy={busyId === d.tempId}
                              onPatch={(patch) => patchDraft(d.tempId, patch)}
                              onSave={() => saveDraft(d.tempId)}
                              onCancel={() => cancelDraft(d.tempId)}
                            />
                          ))}
                          {rs.length === 0 && docDrafts.length === 0 && (
                            <tr>
                              <td colSpan={8} className="px-2 py-3 text-xs text-gray-400 italic">No rules yet for this document type.</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )
              })}
            </CardContent>
          </Card>
        )
      })}

      {/* Drafts for empty modules (none currently exists). Not exposed in
          this V1 to keep the UI focused on existing module workflows. */}
    </div>
  )
}

// ─── Editable row ───────────────────────────────────────────────────────────
function RuleRow({ rule, roles, roleLabels, stageOptions, busy, saved, onUpdate, onDelete }: {
  rule: Rule
  roles: string[]
  roleLabels: RoleLabelMap
  stageOptions: string[]
  busy: boolean
  saved: boolean
  onUpdate: (patch: Partial<Rule>) => void
  onDelete: () => void
}) {
  return (
    <tr className={cn('border-t border-gray-100', saved && 'bg-green-50 transition-colors', !rule.is_active && 'opacity-60')}>
      <td className="px-2 py-2">
        <StageSelect
          value={rule.from_stage}
          options={stageOptions}
          onChange={(v) => { if (v !== rule.from_stage) onUpdate({ from_stage: v }) }}
        />
      </td>
      <td className="px-2 py-2 text-gray-400"><ArrowRight className="h-4 w-4" /></td>
      <td className="px-2 py-2">
        <StageSelect
          value={rule.to_stage}
          options={stageOptions}
          onChange={(v) => { if (v !== rule.to_stage) onUpdate({ to_stage: v }) }}
        />
      </td>
      <td className="px-2 py-2">
        <RoleSelect value={rule.approver_role} roles={roles} roleLabels={roleLabels} onChange={(v) => onUpdate({ approver_role: v })} />
      </td>
      <td className="px-2 py-2">
        <RoleSelect value={rule.override_role ?? ''} roles={roles} roleLabels={roleLabels} allowEmpty onChange={(v) => onUpdate({ override_role: v || null })} />
      </td>
      <td className="px-2 py-2 text-right">
        <Input
          type="number" inputMode="decimal" step="any" min="0"
          defaultValue={rule.amount_cap_max ?? ''}
          onBlur={e => {
            const raw = e.target.value.trim()
            const next = raw === '' ? null : Number(raw)
            if (next !== rule.amount_cap_max) onUpdate({ amount_cap_max: next })
          }}
          placeholder="no cap"
          className="h-8 text-xs w-28 ml-auto text-right tabular-nums"
        />
      </td>
      <td className="px-2 py-2 text-center">
        <button
          type="button"
          onClick={() => onUpdate({ is_active: !rule.is_active })}
          title={rule.is_active ? 'Active — click to disable' : 'Disabled — click to enable'}
          className={cn(
            'inline-flex items-center justify-center h-7 w-7 rounded-md',
            rule.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-400',
          )}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : rule.is_active ? <Power className="h-4 w-4" /> : <PowerOff className="h-4 w-4" />}
        </button>
        {saved && (
          <div className="text-[10px] text-green-700 font-semibold mt-0.5 inline-flex items-center gap-0.5"><Check className="h-2.5 w-2.5" /> saved</div>
        )}
      </td>
      <td className="px-2 py-2 text-right">
        <Button type="button" size="sm" variant="ghost" onClick={onDelete}
          className="text-rose-600 hover:bg-rose-50 h-7 w-7 p-0">
          <Trash2 className="h-4 w-4" />
        </Button>
      </td>
    </tr>
  )
}

// ─── New-rule draft row ─────────────────────────────────────────────────────
function DraftRow({ draft, roles, roleLabels, stageOptions, busy, onPatch, onSave, onCancel }: {
  draft: DraftRule
  roles: string[]
  roleLabels: RoleLabelMap
  stageOptions: string[]
  busy: boolean
  onPatch: (patch: Partial<DraftRule>) => void
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <tr className="border-t border-blue-200 bg-blue-50/40">
      <td className="px-2 py-2">
        <StageSelect value={draft.from_stage} options={stageOptions} allowPickPrompt onChange={(v) => onPatch({ from_stage: v })} />
      </td>
      <td className="px-2 py-2 text-blue-500"><ArrowRight className="h-4 w-4" /></td>
      <td className="px-2 py-2">
        <StageSelect value={draft.to_stage} options={stageOptions} allowPickPrompt onChange={(v) => onPatch({ to_stage: v })} />
      </td>
      <td className="px-2 py-2">
        <RoleSelect value={draft.approver_role} roles={roles} roleLabels={roleLabels} onChange={(v) => onPatch({ approver_role: v })} />
      </td>
      <td className="px-2 py-2">
        <RoleSelect value={draft.override_role} roles={roles} roleLabels={roleLabels} allowEmpty onChange={(v) => onPatch({ override_role: v })} />
      </td>
      <td className="px-2 py-2 text-right">
        <Input type="number" inputMode="decimal" step="any" min="0"
          value={draft.amount_cap_max} onChange={e => onPatch({ amount_cap_max: e.target.value })}
          placeholder="no cap" className="h-8 text-xs w-28 ml-auto text-right tabular-nums" />
      </td>
      <td className="px-2 py-2 text-center">
        <Badge variant="default" className="text-[10px]"><ShieldAlert className="h-3 w-3 mr-0.5 inline" />new</Badge>
      </td>
      <td className="px-2 py-2 flex items-center gap-1 justify-end">
        <Button type="button" size="sm" onClick={onSave} disabled={busy} className="h-7 w-7 p-0">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} className="h-7 w-7 p-0">
          <X className="h-4 w-4" />
        </Button>
      </td>
    </tr>
  )
}

function RoleSelect({ value, roles, roleLabels, allowEmpty, onChange }: {
  value: string
  roles: string[]
  roleLabels: RoleLabelMap
  allowEmpty?: boolean
  onChange: (v: string) => void
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="h-8 rounded-lg border border-gray-300 bg-white px-2 text-xs"
    >
      {allowEmpty && <option value="">— none —</option>}
      {!allowEmpty && !value && <option value="">— pick role —</option>}
      {roles.map(r => (
        <option key={r} value={r}>{fmtRoleLabel(r, roleLabels)}</option>
      ))}
    </select>
  )
}

// ─── Stage select (used by rule rows) ───────────────────────────────────────
// Always shows the current value even if it's not in the master stages list
// (e.g. a legacy stage that hasn't been migrated yet). Falls back to a free-
// text-style "(legacy)" option.
function StageSelect({ value, options, allowPickPrompt, onChange }: {
  value: string
  options: string[]
  allowPickPrompt?: boolean
  onChange: (v: string) => void
}) {
  const inMaster = options.includes(value)
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className={cn(
        'h-8 rounded-lg border bg-white px-2 text-xs font-mono',
        !inMaster && value ? 'border-rose-300 text-rose-700' : 'border-gray-300',
      )}
      title={!inMaster && value ? 'This stage is not in the Stages list — add it above to keep it' : undefined}
    >
      {allowPickPrompt && !value && <option value="">— pick stage —</option>}
      {!inMaster && value && <option value={value}>{value} (legacy)</option>}
      {options.map(s => (
        <option key={s} value={s}>{s}</option>
      ))}
    </select>
  )
}

// ─── Stages chip row + add input ────────────────────────────────────────────
function StagesEditor({ stages, busyKey, busyKeyPrefix, onRename, onDelete, onAdd }: {
  stages: Stage[]
  busyKey: string | null
  busyKeyPrefix: string
  onRename: (s: Stage, next: string) => void
  onDelete: (s: Stage) => void
  onAdd: (name: string) => void
}) {
  const [newName, setNewName] = useState('')

  return (
    <div className="mb-3 p-3 rounded-xl border border-gray-200 bg-gray-50">
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-[10px] uppercase tracking-wide font-semibold text-gray-500">Stages</p>
        <p className="text-[10px] text-gray-400">click a chip to rename · × to delete</p>
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        {stages.length === 0 ? (
          <p className="text-xs text-gray-400 italic">No stages defined.</p>
        ) : (
          stages.map(s => (
            <StageChip
              key={s.id}
              stage={s}
              busy={busyKey === `${busyKeyPrefix}${s.id}`}
              onRename={(next) => onRename(s, next)}
              onDelete={() => onDelete(s)}
            />
          ))
        )}
        <form
          onSubmit={(e) => { e.preventDefault(); onAdd(newName); setNewName('') }}
          className="inline-flex items-center gap-1"
        >
          <Input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="add stage…"
            className="h-7 text-xs font-mono w-32"
          />
          <Button type="submit" size="sm" variant="outline" disabled={!newName.trim()} className="h-7 px-2">
            <Plus className="h-3 w-3" />
          </Button>
        </form>
      </div>
    </div>
  )
}

function StageChip({ stage, busy, onRename, onDelete }: {
  stage: Stage
  busy: boolean
  onRename: (next: string) => void
  onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(stage.stage)

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-white border border-blue-300 px-2 py-0.5 text-xs">
        <Input
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { onRename(draft); setEditing(false) }
            if (e.key === 'Escape') { setDraft(stage.stage); setEditing(false) }
          }}
          onBlur={() => { onRename(draft); setEditing(false) }}
          className="h-6 text-xs font-mono w-28 px-1"
        />
      </span>
    )
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-mono cursor-pointer',
        stage.is_initial && 'border-blue-300 bg-blue-50 text-blue-800',
        stage.is_terminal && 'border-emerald-300 bg-emerald-50 text-emerald-800',
        !stage.is_initial && !stage.is_terminal && 'border-gray-300 bg-white text-gray-700',
      )}
      onClick={() => { setDraft(stage.stage); setEditing(true) }}
      title={
        stage.is_initial ? 'Initial stage — first state of a new doc'
          : stage.is_terminal ? 'Terminal stage — final state'
          : 'Click to rename'
      }
    >
      {stage.is_initial && <Flag className="h-3 w-3" />}
      {stage.is_terminal && <Square className="h-3 w-3" />}
      {stage.stage}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onDelete() }}
        className="hover:text-rose-600 ml-0.5"
        disabled={busy}
        title="Delete stage"
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
      </button>
    </span>
  )
}
