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

interface Props {
  initial: Rule[]
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

export default function ApprovalsMatrix({ initial, roles, roleLabels, moduleLabels }: Props) {
  const router = useRouter()
  const [rules, setRules]   = useState<Rule[]>(initial)
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
function RuleRow({ rule, roles, roleLabels, busy, saved, onUpdate, onDelete }: {
  rule: Rule
  roles: string[]
  roleLabels: RoleLabelMap
  busy: boolean
  saved: boolean
  onUpdate: (patch: Partial<Rule>) => void
  onDelete: () => void
}) {
  return (
    <tr className={cn('border-t border-gray-100', saved && 'bg-green-50 transition-colors', !rule.is_active && 'opacity-60')}>
      <td className="px-2 py-2">
        <Input
          defaultValue={rule.from_stage}
          onBlur={e => { const v = e.target.value.trim(); if (v !== rule.from_stage) onUpdate({ from_stage: v }) }}
          className="h-8 text-xs font-mono"
        />
      </td>
      <td className="px-2 py-2 text-gray-400"><ArrowRight className="h-4 w-4" /></td>
      <td className="px-2 py-2">
        <Input
          defaultValue={rule.to_stage}
          onBlur={e => { const v = e.target.value.trim(); if (v !== rule.to_stage) onUpdate({ to_stage: v }) }}
          className="h-8 text-xs font-mono"
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
function DraftRow({ draft, roles, roleLabels, busy, onPatch, onSave, onCancel }: {
  draft: DraftRule
  roles: string[]
  roleLabels: RoleLabelMap
  busy: boolean
  onPatch: (patch: Partial<DraftRule>) => void
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <tr className="border-t border-blue-200 bg-blue-50/40">
      <td className="px-2 py-2">
        <Input value={draft.from_stage} onChange={e => onPatch({ from_stage: e.target.value })} placeholder="e.g. submitted" className="h-8 text-xs font-mono" />
      </td>
      <td className="px-2 py-2 text-blue-500"><ArrowRight className="h-4 w-4" /></td>
      <td className="px-2 py-2">
        <Input value={draft.to_stage} onChange={e => onPatch({ to_stage: e.target.value })} placeholder="e.g. approved" className="h-8 text-xs font-mono" />
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
