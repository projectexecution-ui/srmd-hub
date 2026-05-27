'use client'
// Plain approval-rules matrix. One flat table per module. No stage editor,
// no per-doc-type subgroups, no badges-for-the-sake-of-badges. Five columns:
// From → To · Approver · Override · Cap · Active · 🗑.

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2, Check, Plus, Trash2, X, ArrowRight, MessageSquare, Paperclip } from 'lucide-react'
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

export default function ApprovalsMatrix({ initial, roles, roleLabels, moduleLabels }: Props) {
  const router = useRouter()
  const [rules, setRules] = useState<Rule[]>(initial)
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Group by module only — keep it flat.
  const groups = useMemo(() => {
    const m = new Map<string, Rule[]>()
    for (const r of rules) {
      if (!m.has(r.module_slug)) m.set(r.module_slug, [])
      m.get(r.module_slug)!.push(r)
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [rules])

  // The doc_type for a module: take whatever the existing rules use.
  // (Every module today has exactly one doc_type — keep it simple, don't expose this.)
  function defaultDocType(module_slug: string): string {
    const r = rules.find(x => x.module_slug === module_slug)
    return r?.doc_type ?? module_slug
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
    if (!confirm('Delete this rule?')) return
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
      setError('From, To, and Approver are required'); return
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

      {groups.map(([modSlug, modRules]) => {
        const draftsForMod = drafts.filter(d => d.module_slug === modSlug)
        return (
          <Card key={modSlug}>
            <CardContent className="pt-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-base font-bold text-gray-900">
                  {moduleLabels[modSlug] ?? modSlug}
                </h2>
                <Button size="sm" variant="outline"
                  onClick={() => setDrafts(ds => [...ds, newDraft(modSlug)])}>
                  <Plus className="h-4 w-4" /> Add rule
                </Button>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500">
                      <th className="px-2 py-2 w-40">From stage</th>
                      <th className="px-2 py-2 w-6"></th>
                      <th className="px-2 py-2 w-40">To stage</th>
                      <th className="px-2 py-2">Approver</th>
                      <th className="px-2 py-2">Override (optional)</th>
                      <th className="px-2 py-2 text-right w-32">₹ cap</th>
                      <th className="px-2 py-2 text-center w-14" title="Require comment on approval">💬</th>
                      <th className="px-2 py-2 text-center w-14" title="Require attachment on approval">📎</th>
                      <th className="px-2 py-2 text-center w-16">Active</th>
                      <th className="px-2 py-2 w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {modRules.map(r => (
                      <Row key={r.id}
                        rule={r}
                        roles={roles}
                        roleLabels={roleLabels}
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
                        busy={busyId === d.tempId}
                        onPatch={(p) => setDrafts(ds => ds.map(x => x.tempId === d.tempId ? { ...x, ...p } : x))}
                        onCancel={() => setDrafts(ds => ds.filter(x => x.tempId !== d.tempId))}
                        onSave={() => commitDraft(d.tempId)}
                      />
                    ))}

                    {modRules.length === 0 && draftsForMod.length === 0 && (
                      <tr><td colSpan={10} className="px-2 py-3 text-xs text-gray-400 italic">No rules.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )
      })}

      {/* Read-only summary card — exactly what the rules mean in plain English. */}
      {rules.length > 0 && (
        <Card>
          <CardContent className="pt-5">
            <h3 className="text-sm font-bold uppercase tracking-wide text-gray-500 mb-2">In plain English</h3>
            <ul className="space-y-1 text-sm text-gray-700">
              {rules.filter(r => r.is_active).map(r => (
                <li key={r.id}>
                  <b>{fmtRole(r.approver_role, roleLabels)}</b>
                  {r.override_role && <> {' '}or <b>{fmtRole(r.override_role, roleLabels)}</b></>}
                  {' '}can move a <span className="font-mono text-xs text-gray-500">{r.doc_type}</span>
                  {' '}from <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{r.from_stage}</code>
                  {' '}to <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{r.to_stage}</code>
                  {r.amount_cap_max != null && (
                    <> &middot; only when ₹ ≤ {Number(r.amount_cap_max).toLocaleString('en-IN')}</>
                  )}
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
function Row({ rule, roles, roleLabels, busy, saved, onSave, onRemove }: {
  rule: Rule
  roles: string[]
  roleLabels: RoleLabelMap
  busy: boolean
  saved: boolean
  onSave: (patch: Partial<Rule>) => void
  onRemove: () => void
}) {
  return (
    <tr className={cn('border-t border-gray-100', saved && 'bg-green-50 transition-colors', !rule.is_active && 'opacity-60')}>
      <td className="px-2 py-2">
        <Input defaultValue={rule.from_stage}
          onBlur={e => { const v = e.target.value.trim(); if (v && v !== rule.from_stage) onSave({ from_stage: v }) }}
          className="h-8 text-xs font-mono" />
      </td>
      <td className="px-2 py-2 text-gray-400"><ArrowRight className="h-4 w-4" /></td>
      <td className="px-2 py-2">
        <Input defaultValue={rule.to_stage}
          onBlur={e => { const v = e.target.value.trim(); if (v && v !== rule.to_stage) onSave({ to_stage: v }) }}
          className="h-8 text-xs font-mono" />
      </td>
      <td className="px-2 py-2">
        <RoleSelect value={rule.approver_role} roles={roles} roleLabels={roleLabels}
          onChange={(v) => onSave({ approver_role: v })} />
      </td>
      <td className="px-2 py-2">
        <RoleSelect value={rule.override_role ?? ''} roles={roles} roleLabels={roleLabels} allowEmpty
          onChange={(v) => onSave({ override_role: v || null })} />
      </td>
      <td className="px-2 py-2 text-right">
        <Input type="number" min="0" step="any" inputMode="decimal"
          defaultValue={rule.amount_cap_max ?? ''}
          onBlur={e => {
            const raw = e.target.value.trim()
            const next = raw === '' ? null : Number(raw)
            if (next !== rule.amount_cap_max) onSave({ amount_cap_max: next })
          }}
          placeholder="no cap"
          className="h-8 text-xs w-28 ml-auto text-right tabular-nums" />
      </td>
      <td className="px-2 py-2 text-center" title="Require approver to leave a comment">
        <button
          type="button"
          onClick={() => onSave({ requires_remarks: !rule.requires_remarks })}
          className={cn(
            'inline-flex items-center justify-center h-7 w-7 rounded-md border',
            rule.requires_remarks
              ? 'bg-blue-100 text-blue-700 border-blue-300'
              : 'bg-gray-50 text-gray-400 border-gray-200 hover:text-gray-600',
          )}
          aria-label={rule.requires_remarks ? 'Comment is required' : 'Comment is optional'}
        >
          <MessageSquare className="h-3.5 w-3.5" />
        </button>
      </td>
      <td className="px-2 py-2 text-center" title="Require approver to attach a file">
        <button
          type="button"
          onClick={() => onSave({ requires_attachment: !rule.requires_attachment })}
          className={cn(
            'inline-flex items-center justify-center h-7 w-7 rounded-md border',
            rule.requires_attachment
              ? 'bg-amber-100 text-amber-700 border-amber-300'
              : 'bg-gray-50 text-gray-400 border-gray-200 hover:text-gray-600',
          )}
          aria-label={rule.requires_attachment ? 'Attachment is required' : 'Attachment is optional'}
        >
          <Paperclip className="h-3.5 w-3.5" />
        </button>
      </td>
      <td className="px-2 py-2 text-center">
        <input type="checkbox" checked={rule.is_active}
          onChange={e => onSave({ is_active: e.target.checked })}
          className="h-4 w-4 accent-emerald-600" />
        {busy && <Loader2 className="h-3 w-3 animate-spin text-gray-400 mx-auto mt-0.5" />}
        {saved && <Check className="h-3 w-3 text-green-600 mx-auto mt-0.5" />}
      </td>
      <td className="px-2 py-2 text-right">
        <Button type="button" size="sm" variant="ghost"
          onClick={onRemove}
          className="text-rose-600 hover:bg-rose-50 h-7 w-7 p-0">
          <Trash2 className="h-4 w-4" />
        </Button>
      </td>
    </tr>
  )
}

// ─── New-rule draft row ────────────────────────────────────────────────
function DraftRow({ draft, roles, roleLabels, busy, onPatch, onSave, onCancel }: {
  draft: Draft
  roles: string[]
  roleLabels: RoleLabelMap
  busy: boolean
  onPatch: (p: Partial<Draft>) => void
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <tr className="border-t border-blue-200 bg-blue-50/40">
      <td className="px-2 py-2">
        <Input value={draft.from_stage} onChange={e => onPatch({ from_stage: e.target.value })}
          placeholder="e.g. submitted" className="h-8 text-xs font-mono" />
      </td>
      <td className="px-2 py-2 text-blue-500"><ArrowRight className="h-4 w-4" /></td>
      <td className="px-2 py-2">
        <Input value={draft.to_stage} onChange={e => onPatch({ to_stage: e.target.value })}
          placeholder="e.g. approved" className="h-8 text-xs font-mono" />
      </td>
      <td className="px-2 py-2">
        <RoleSelect value={draft.approver_role} roles={roles} roleLabels={roleLabels}
          onChange={(v) => onPatch({ approver_role: v })} />
      </td>
      <td className="px-2 py-2">
        <RoleSelect value={draft.override_role} roles={roles} roleLabels={roleLabels} allowEmpty
          onChange={(v) => onPatch({ override_role: v })} />
      </td>
      <td className="px-2 py-2 text-right">
        <Input type="number" min="0" step="any" inputMode="decimal"
          value={draft.amount_cap_max}
          onChange={e => onPatch({ amount_cap_max: e.target.value })}
          placeholder="no cap"
          className="h-8 text-xs w-28 ml-auto text-right tabular-nums" />
      </td>
      <td className="px-2 py-2 text-center text-gray-300" title="Editable after the rule is saved"><MessageSquare className="h-3.5 w-3.5 mx-auto" /></td>
      <td className="px-2 py-2 text-center text-gray-300" title="Editable after the rule is saved"><Paperclip className="h-3.5 w-3.5 mx-auto" /></td>
      <td className="px-2 py-2 text-center text-[11px] text-blue-700 font-semibold">new</td>
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
        <option key={r} value={r}>{fmtRole(r, roleLabels)}</option>
      ))}
    </select>
  )
}
