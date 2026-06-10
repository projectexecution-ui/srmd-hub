'use client'
// Layman-friendly approval rules. One card per REAL module (the blueprint-demo
// sandbox is hidden). Each rule reads as a sentence: "When <stage>, <role> can
// move it to <next stage>." By default only the essentials show — stage names
// (read-only, friendly), the approver role, and an On/Off switch. The rarely-
// needed knobs (override role, ₹ cap, require-comment, require-file) hide
// behind a single "Show advanced options" switch and a per-row edit mode.
//
// Editing/insert/delete logic is unchanged from the original matrix.

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2, Check, Plus, Trash2, X, ArrowRight, MessageSquare, Paperclip, Pencil, SlidersHorizontal } from 'lucide-react'
import { confirm } from '@/components/ui/confirm-dialog'
import { cn } from '@/lib/utils'
import { MoneyInput } from '@/components/ui/money-input'
import type { RoleLabelMap } from '@/lib/role-labels'

// Modules that are sandboxes / demos — never shown on this real-config page.
const HIDDEN_MODULES = new Set(['blueprint-demo'])

interface Rule {
  id: string
  module_slug: string
  doc_type: string
  from_stage: string
  to_stage: string
  approver_role: string
  override_role: string | null
  amount_cap_max: number | null
  is_active: boolean
  requires_remarks?: boolean
  requires_attachment?: boolean
}

interface Props {
  initial: Rule[]
  roles: string[]
  roleLabels: RoleLabelMap
  moduleLabels: Record<string, string>
}

type Draft = {
  tempId: string
  module_slug: string
  from_stage: string
  to_stage: string
  approver_role: string
  override_role: string
  amount_cap_max: string
}

function newDraft(module_slug: string): Draft {
  return {
    tempId: crypto.randomUUID(),
    module_slug,
    from_stage: '',
    to_stage: '',
    approver_role: '',
    override_role: '',
    amount_cap_max: '',
  }
}

function fmtRole(r: string | null | undefined, labels: RoleLabelMap): string {
  if (!r) return '—'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (labels as any)[r]?.label || r
}

// Raw stage code → readable label. "partially_approved" → "Partially Approved".
function prettyStage(s: string | null | undefined): string {
  if (!s) return '—'
  return s.trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// Order a module's rules by the ACTUAL document flow instead of A–Z:
// start stages (never a destination) first, then each stage they lead to, and
// so on (topological sort, Kahn's algorithm). Self-loops are ignored for
// ordering; any leftover (cycles) keep their original order. Within the same
// from→to step, original order is preserved (stable).
function flowOrder(modRules: Rule[]): Rule[] {
  const indeg = new Map<string, number>()
  const adj = new Map<string, Set<string>>()
  const discovery: string[] = []
  const seen = new Set<string>()
  const touch = (s: string) => {
    if (!seen.has(s)) { seen.add(s); discovery.push(s); indeg.set(s, 0); adj.set(s, new Set()) }
  }
  for (const r of modRules) { touch(r.from_stage); touch(r.to_stage) }
  for (const r of modRules) {
    if (r.from_stage === r.to_stage) continue // self-loop: not a forward edge
    const dests = adj.get(r.from_stage)!
    if (!dests.has(r.to_stage)) { dests.add(r.to_stage); indeg.set(r.to_stage, (indeg.get(r.to_stage) ?? 0) + 1) }
  }
  const rank = new Map<string, number>()
  let next = 0
  const queue = discovery.filter(s => (indeg.get(s) ?? 0) === 0)
  while (queue.length) {
    queue.sort((a, b) => discovery.indexOf(a) - discovery.indexOf(b))
    const s = queue.shift()!
    if (rank.has(s)) continue
    rank.set(s, next++)
    for (const nb of adj.get(s) ?? []) {
      indeg.set(nb, (indeg.get(nb) ?? 0) - 1)
      if ((indeg.get(nb) ?? 0) <= 0 && !rank.has(nb)) queue.push(nb)
    }
  }
  for (const s of discovery) if (!rank.has(s)) rank.set(s, next++)
  const idx = (s: string) => rank.get(s) ?? 9999
  return modRules
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (idx(a.r.from_stage) - idx(b.r.from_stage)) || (idx(a.r.to_stage) - idx(b.r.to_stage)) || (a.i - b.i))
    .map(x => x.r)
}

export default function ApprovalsMatrix({ initial, roles, roleLabels, moduleLabels }: Props) {
  const router = useRouter()
  const [rules, setRules] = useState<Rule[]>(initial)
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  // Rows currently in inline-edit mode (stage names become editable). Keyed by rule id.
  const [editing, setEditing] = useState<Set<string>>(new Set())
  const toggleEditing = (id: string) => setEditing(p => {
    const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n
  })

  // Group by module — real modules only (sandbox hidden).
  const groups = useMemo(() => {
    const m = new Map<string, Rule[]>()
    for (const r of rules) {
      if (HIDDEN_MODULES.has(r.module_slug)) continue
      if (!m.has(r.module_slug)) m.set(r.module_slug, [])
      m.get(r.module_slug)!.push(r)
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [rules])

  const hiddenCount = useMemo(
    () => new Set(rules.filter(r => HIDDEN_MODULES.has(r.module_slug)).map(r => r.module_slug)).size,
    [rules],
  )

  function defaultDocType(module_slug: string): string {
    const r = rules.find(x => x.module_slug === module_slug)
    return r?.doc_type ?? module_slug
  }

  // Existing stage names within a module — fed to the Add-step autocomplete.
  function stagesForModule(modSlug: string): string[] {
    const set = new Set<string>()
    for (const r of rules) {
      if (r.module_slug !== modSlug) continue
      if (r.from_stage) set.add(r.from_stage)
      if (r.to_stage) set.add(r.to_stage)
    }
    return Array.from(set).sort()
  }

  async function save(id: string, patch: Partial<Rule>) {
    setBusyId(id); setError(null)
    const prev = rules
    setRules(rs => rs.map(r => r.id === id ? { ...r, ...patch } : r))
    const { error } = await createClient().from('approval_rules').update(patch).eq('id', id)
    setBusyId(null)
    if (error) { setError(error.message); setRules(prev); return }
    setSavedId(id)
    setTimeout(() => setSavedId(s => s === id ? null : s), 1200)
    router.refresh()
  }

  async function remove(id: string) {
    if (!(await confirm('Delete this approval step? People will no longer be able to make this move (Admin can still do everything).'))) return
    setBusyId(id); setError(null)
    const prev = rules
    setRules(rs => rs.filter(r => r.id !== id))
    const { error } = await createClient().from('approval_rules').delete().eq('id', id)
    setBusyId(null)
    if (error) { setError(error.message); setRules(prev); return }
    router.refresh()
  }

  async function commitDraft(tempId: string) {
    const d = drafts.find(x => x.tempId === tempId)
    if (!d) return
    if (!d.from_stage.trim() || !d.to_stage.trim() || !d.approver_role) {
      setError('Please fill: the stage it starts at, the stage it moves to, and who can approve.'); return
    }
    setBusyId(tempId); setError(null)
    const cap = d.amount_cap_max.trim() === '' ? null : Number(d.amount_cap_max)
    const { data, error } = await createClient().from('approval_rules').insert({
      module_slug:   d.module_slug,
      doc_type:      defaultDocType(d.module_slug),
      from_stage:    d.from_stage.trim(),
      to_stage:      d.to_stage.trim(),
      approver_role: d.approver_role,
      override_role: d.override_role || null,
      amount_cap_max: cap,
      is_active:     true,
    }).select('*').single()
    setBusyId(null)
    if (error) { setError(error.message); return }
    setRules(rs => [...rs, data as Rule])
    setDrafts(ds => ds.filter(x => x.tempId !== tempId))
    router.refresh()
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-sm text-rose-700">{error}</div>
      )}

      {/* Advanced toggle */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-gray-500">
          {hiddenCount > 0 && <span>{hiddenCount} test module hidden. </span>}
          Each row is one step. Admin can always approve everything.
        </p>
        <label className="inline-flex items-center gap-2 text-xs font-medium text-gray-600 cursor-pointer select-none">
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Show advanced options
          <input
            type="checkbox"
            checked={showAdvanced}
            onChange={e => setShowAdvanced(e.target.checked)}
            className="h-4 w-4 accent-blue-600"
          />
        </label>
      </div>

      {groups.map(([modSlug, modRules]) => {
        const draftsForMod = drafts.filter(d => d.module_slug === modSlug)
        const knownStages = stagesForModule(modSlug)
        return (
          <Card key={modSlug}>
            <CardContent className="pt-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-base font-bold text-gray-900">
                  {moduleLabels[modSlug] ?? prettyStage(modSlug)}
                </h2>
                <Button size="sm" variant="outline"
                  onClick={() => setDrafts(ds => [...ds, newDraft(modSlug)])}>
                  <Plus className="h-4 w-4" /> Add step
                </Button>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500">
                      <th className="px-2 py-2">When (stage)</th>
                      <th className="px-2 py-2 w-6"></th>
                      <th className="px-2 py-2">Moves to</th>
                      <th className="px-2 py-2">Who can approve</th>
                      {showAdvanced && <th className="px-2 py-2">Or (override)</th>}
                      {showAdvanced && <th className="px-2 py-2 text-right w-32">₹ cap</th>}
                      {showAdvanced && <th className="px-2 py-2 text-center w-14" title="Require approver to leave a comment">Needs note</th>}
                      {showAdvanced && <th className="px-2 py-2 text-center w-14" title="Require approver to attach a file">Needs file</th>}
                      <th className="px-2 py-2 text-center w-16">On</th>
                      <th className="px-2 py-2 w-16"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {flowOrder(modRules).map(r => (
                      <Row key={r.id}
                        rule={r}
                        roles={roles}
                        roleLabels={roleLabels}
                        showAdvanced={showAdvanced}
                        editing={editing.has(r.id)}
                        onToggleEdit={() => toggleEditing(r.id)}
                        busy={busyId === r.id}
                        saved={savedId === r.id}
                        onSave={(p) => save(r.id, p)}
                        onRemove={() => remove(r.id)}
                      />
                    ))}

                    {draftsForMod.map(d => (
                      <DraftRow key={d.tempId}
                        draft={d}
                        roles={roles}
                        roleLabels={roleLabels}
                        showAdvanced={showAdvanced}
                        knownStages={knownStages}
                        busy={busyId === d.tempId}
                        onPatch={(p) => setDrafts(ds => ds.map(x => x.tempId === d.tempId ? { ...x, ...p } : x))}
                        onCancel={() => setDrafts(ds => ds.filter(x => x.tempId !== d.tempId))}
                        onSave={() => commitDraft(d.tempId)}
                      />
                    ))}

                    {modRules.length === 0 && draftsForMod.length === 0 && (
                      <tr><td colSpan={showAdvanced ? 10 : 6} className="px-2 py-3 text-xs text-gray-400 italic">No steps yet. Click “Add step”.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )
      })}

      {/* Read-only plain-English summary — the reassurance view. */}
      {groups.length > 0 && (
        <Card>
          <CardContent className="pt-5">
            <h3 className="text-sm font-bold uppercase tracking-wide text-gray-500 mb-2">In plain English</h3>
            <ul className="space-y-1.5 text-sm text-gray-700">
              {groups.flatMap(([, modRules]) => flowOrder(modRules.filter(r => r.is_active))).map(r => (
                <li key={r.id} className="leading-relaxed">
                  When a <b>{moduleLabels[r.module_slug] ?? prettyStage(r.module_slug)}</b> is{' '}
                  <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{prettyStage(r.from_stage)}</code>,{' '}
                  <b>{fmtRole(r.approver_role, roleLabels)}</b>
                  {r.override_role && <> or <b>{fmtRole(r.override_role, roleLabels)}</b></>}
                  {' '}(and Admin) can move it to{' '}
                  <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{prettyStage(r.to_stage)}</code>
                  {r.amount_cap_max != null && (
                    <> — only when the amount is ₹{Number(r.amount_cap_max).toLocaleString('en-IN')} or less</>
                  )}.
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ─── Single existing-rule row ──────────────────────────────────────────
function Row({ rule, roles, roleLabels, showAdvanced, editing, onToggleEdit, busy, saved, onSave, onRemove }: {
  rule: Rule
  roles: string[]
  roleLabels: RoleLabelMap
  showAdvanced: boolean
  editing: boolean
  onToggleEdit: () => void
  busy: boolean
  saved: boolean
  onSave: (patch: Partial<Rule>) => void
  onRemove: () => void
}) {
  // Stage names are editable only in advanced + edit mode — otherwise shown as
  // friendly read-only chips so the common case (just set the approver) is clean.
  const stagesEditable = showAdvanced && editing
  return (
    <tr className={cn('border-t border-gray-100', saved && 'bg-green-50 transition-colors', !rule.is_active && 'opacity-60')}>
      <td className="px-2 py-2">
        {stagesEditable ? (
          <Input defaultValue={rule.from_stage}
            onBlur={e => { const v = e.target.value.trim(); if (v && v !== rule.from_stage) onSave({ from_stage: v }) }}
            className="h-8 text-xs" />
        ) : (
          <StageChip value={rule.from_stage} />
        )}
      </td>
      <td className="px-2 py-2 text-gray-400"><ArrowRight className="h-4 w-4" /></td>
      <td className="px-2 py-2">
        {stagesEditable ? (
          <Input defaultValue={rule.to_stage}
            onBlur={e => { const v = e.target.value.trim(); if (v && v !== rule.to_stage) onSave({ to_stage: v }) }}
            className="h-8 text-xs" />
        ) : (
          <StageChip value={rule.to_stage} tone="green" />
        )}
      </td>
      <td className="px-2 py-2">
        <RoleSelect value={rule.approver_role} roles={roles} roleLabels={roleLabels}
          onChange={(v) => onSave({ approver_role: v })} />
      </td>
      {showAdvanced && (
        <td className="px-2 py-2">
          <RoleSelect value={rule.override_role ?? ''} roles={roles} roleLabels={roleLabels} allowEmpty
            onChange={(v) => onSave({ override_role: v || null })} />
        </td>
      )}
      {showAdvanced && (
        <td className="px-2 py-2 text-right">
          <AmountCapInput rule={rule} onSave={onSave} />
        </td>
      )}
      {showAdvanced && (
        <td className="px-2 py-2 text-center" title="Require approver to leave a comment">
          <button
            type="button"
            onClick={() => onSave({ requires_remarks: !rule.requires_remarks })}
            className={cn('inline-flex items-center justify-center h-7 w-7 rounded-md border',
              rule.requires_remarks ? 'bg-blue-100 text-blue-700 border-blue-300' : 'bg-gray-50 text-gray-400 border-gray-200 hover:text-gray-600')}
            aria-label={rule.requires_remarks ? 'Comment is required' : 'Comment is optional'}
          >
            <MessageSquare className="h-3.5 w-3.5" />
          </button>
        </td>
      )}
      {showAdvanced && (
        <td className="px-2 py-2 text-center" title="Require approver to attach a file">
          <button
            type="button"
            onClick={() => onSave({ requires_attachment: !rule.requires_attachment })}
            className={cn('inline-flex items-center justify-center h-7 w-7 rounded-md border',
              rule.requires_attachment ? 'bg-amber-100 text-amber-700 border-amber-300' : 'bg-gray-50 text-gray-400 border-gray-200 hover:text-gray-600')}
            aria-label={rule.requires_attachment ? 'Attachment is required' : 'Attachment is optional'}
          >
            <Paperclip className="h-3.5 w-3.5" />
          </button>
        </td>
      )}
      <td className="px-2 py-2 text-center">
        <input type="checkbox" checked={rule.is_active}
          onChange={e => onSave({ is_active: e.target.checked })}
          className="h-4 w-4 accent-emerald-600" />
        {busy && <Loader2 className="h-3 w-3 animate-spin text-gray-400 mx-auto mt-0.5" />}
        {saved && <Check className="h-3 w-3 text-green-600 mx-auto mt-0.5" />}
      </td>
      <td className="px-2 py-2">
        <div className="flex items-center justify-end gap-0.5">
          {showAdvanced && (
            <Button type="button" size="sm" variant="ghost"
              onClick={onToggleEdit}
              title={editing ? 'Done editing stage names' : 'Edit the stage names'}
              className={cn('h-7 w-7 p-0', editing ? 'text-blue-700 bg-blue-50' : 'text-gray-400 hover:text-gray-700')}>
              {editing ? <Check className="h-4 w-4" /> : <Pencil className="h-3.5 w-3.5" />}
            </Button>
          )}
          <Button type="button" size="sm" variant="ghost"
            onClick={onRemove}
            className="text-rose-600 hover:bg-rose-50 h-7 w-7 p-0">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </td>
    </tr>
  )
}

function StageChip({ value, tone = 'gray' }: { value: string; tone?: 'gray' | 'green' }) {
  return (
    <span className={cn(
      'inline-block text-xs font-medium px-2 py-1 rounded-md border whitespace-nowrap',
      tone === 'green' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-gray-50 text-gray-700 border-gray-200',
    )} title={value}>
      {prettyStage(value)}
    </span>
  )
}

// ─── New-rule draft row ────────────────────────────────────────────────
function DraftRow({ draft, roles, roleLabels, showAdvanced, knownStages, busy, onPatch, onSave, onCancel }: {
  draft: Draft
  roles: string[]
  roleLabels: RoleLabelMap
  showAdvanced: boolean
  knownStages: string[]
  busy: boolean
  onPatch: (p: Partial<Draft>) => void
  onSave: () => void
  onCancel: () => void
}) {
  const listId = `stages-${draft.module_slug}`
  return (
    <tr className="border-t border-blue-200 bg-blue-50/40">
      <td className="px-2 py-2">
        <datalist id={listId}>
          {knownStages.map(s => <option key={s} value={s}>{prettyStage(s)}</option>)}
        </datalist>
        <Input list={listId} value={draft.from_stage} onChange={e => onPatch({ from_stage: e.target.value })}
          placeholder="e.g. submitted" className="h-8 text-xs" />
      </td>
      <td className="px-2 py-2 text-blue-500"><ArrowRight className="h-4 w-4" /></td>
      <td className="px-2 py-2">
        <Input list={listId} value={draft.to_stage} onChange={e => onPatch({ to_stage: e.target.value })}
          placeholder="e.g. approved" className="h-8 text-xs" />
      </td>
      <td className="px-2 py-2">
        <RoleSelect value={draft.approver_role} roles={roles} roleLabels={roleLabels}
          onChange={(v) => onPatch({ approver_role: v })} />
      </td>
      {showAdvanced && (
        <td className="px-2 py-2">
          <RoleSelect value={draft.override_role} roles={roles} roleLabels={roleLabels} allowEmpty
            onChange={(v) => onPatch({ override_role: v })} />
        </td>
      )}
      {showAdvanced && (
        <td className="px-2 py-2 text-right">
          <MoneyInput
            value={draft.amount_cap_max}
            onChange={(v) => onPatch({ amount_cap_max: v })}
            placeholder="no cap"
            className="h-8 text-xs w-28 ml-auto text-right tabular-nums"
          />
        </td>
      )}
      {showAdvanced && <td className="px-2 py-2 text-center text-gray-300" title="Editable after the step is saved"><MessageSquare className="h-3.5 w-3.5 mx-auto" /></td>}
      {showAdvanced && <td className="px-2 py-2 text-center text-gray-300" title="Editable after the step is saved"><Paperclip className="h-3.5 w-3.5 mx-auto" /></td>}
      <td className="px-2 py-2 text-center text-[11px] text-blue-700 font-semibold">new</td>
      <td className="px-2 py-2">
        <div className="flex items-center gap-1 justify-end">
          <Button type="button" size="sm" onClick={onSave} disabled={busy} className="h-7 w-7 p-0">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onCancel} className="h-7 w-7 p-0">
            <X className="h-4 w-4" />
          </Button>
        </div>
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
        <option key={r} value={r}>{fmtRole(r, roleLabels)}</option>
      ))}
    </select>
  )
}

// ─── Amount-cap cell — uses MoneyInput, saves on blur ─────────────
function AmountCapInput({ rule, onSave }: { rule: Rule; onSave: (patch: Partial<Rule>) => void }) {
  const [val, setVal] = useState<string>(rule.amount_cap_max == null ? '' : String(rule.amount_cap_max))
  useEffect(() => {
    setVal(rule.amount_cap_max == null ? '' : String(rule.amount_cap_max))
  }, [rule.amount_cap_max])
  return (
    <MoneyInput
      value={val}
      onChange={setVal}
      onBlur={() => {
        const next = val.trim() === '' ? null : Number(val)
        if (next !== rule.amount_cap_max) onSave({ amount_cap_max: next })
      }}
      placeholder="no cap"
      className="h-8 text-xs w-28 ml-auto text-right tabular-nums"
    />
  )
}
