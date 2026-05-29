'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronRight, Plus, Trash2, Loader2, Check, X } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MoneyInput } from '@/components/ui/money-input'
import { Label } from '@/components/ui/label'
import {
  addSection,
  updateSection,
  deleteSection,
  addRow,
  updateRow,
  deleteRow,
} from './actions'
import { evaluateFormula, type QtyColumn } from '@/lib/formula'
import type { ServerSection, ServerRow, ServerTemplate } from './page'

const UNIT_OPTIONS = ['SMT', 'SFT', 'Cum', 'RMT', 'RFT', 'Nos', 'KG', 'MT', 'LS']

interface ClientRow extends ServerRow {
  _draft?: boolean
  _saving?: boolean
  _error?: string
}

interface ClientSection extends ServerSection {
  rows: ClientRow[]
  _collapsed?: boolean
}

export function QtyEditor({
  wsId,
  itemId,
  itemUom,
  readOnly,
  sections: initialSections,
  templates,
}: {
  wsId: string
  itemId: string
  itemUom: string
  readOnly: boolean
  sections: ServerSection[]
  templates: ServerTemplate[]
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [sections, setSections] = useState<ClientSection[]>(
    initialSections.map(s => ({ ...s, rows: (s.rows ?? []).sort((a, b) => a.sr_no - b.sr_no) })),
  )
  const [showAddSection, setShowAddSection] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const itemTotal = sections.reduce((acc, s) => acc + Number(s.section_total ?? 0), 0)

  function refresh() {
    startTransition(() => router.refresh())
  }

  function patchSection(secId: string, patch: Partial<ClientSection>) {
    setSections(arr => arr.map(s => (s.id === secId ? { ...s, ...patch } : s)))
  }

  function patchRow(secId: string, rowId: string, patch: Partial<ClientRow>) {
    setSections(arr =>
      arr.map(s =>
        s.id === secId
          ? { ...s, rows: s.rows.map(r => (r.id === rowId ? { ...r, ...patch } : r)) }
          : s,
      ),
    )
  }

  async function handleAddSection(payload: {
    template_id: string | null
    title: string
    columns: QtyColumn[]
    formula: string | null
    unit: string
    units_count: number
  }) {
    setBusy(true)
    setError('')
    const result = await addSection(
      {
        working_sheet_item_id: itemId,
        template_id: payload.template_id,
        title: payload.title,
        columns: payload.columns,
        formula: payload.formula,
        unit: payload.unit,
        units_count: payload.units_count,
      },
      wsId,
    )
    setBusy(false)
    if (result?.error) {
      setError(result.error)
      return
    }
    if (result.section) {
      setSections(arr => [...arr, { ...(result.section as unknown as ServerSection), rows: [] } as ClientSection])
    }
    setShowAddSection(false)
    refresh()
  }

  async function handleDeleteSection(secId: string) {
    if (!confirm('Delete this entire section and all its rows?')) return
    const result = await deleteSection(secId, wsId, itemId)
    if (result?.error) {
      setError(result.error)
      return
    }
    setSections(arr => arr.filter(s => s.id !== secId))
    refresh()
  }

  async function handleUnitsCountChange(secId: string, newValue: number) {
    patchSection(secId, { units_count: newValue })
    const result = await updateSection(secId, { units_count: newValue }, wsId, itemId)
    if (result?.error) setError(result.error)
    refresh()
  }

  function startNewRow(secId: string) {
    const section = sections.find(s => s.id === secId)
    if (!section) return
    const newRow: ClientRow = {
      id: `new-${Date.now()}`,
      section_id: secId,
      sr_no: section.rows.length + 1,
      description: '',
      field_values: {},
      computed_qty: 0,
      remark: null,
      _draft: true,
    }
    setSections(arr => arr.map(s => (s.id === secId ? { ...s, rows: [...s.rows, newRow] } : s)))
  }

  async function saveRow(secId: string, rowId: string) {
    const section = sections.find(s => s.id === secId)
    const row = section?.rows.find(r => r.id === rowId)
    if (!section || !row) return

    let computed = 0
    try {
      computed = evaluateFormula(section.formula ?? '', section.columns, row.field_values ?? {})
    } catch (err) {
      patchRow(secId, rowId, { _error: err instanceof Error ? err.message : 'formula error' })
      return
    }

    patchRow(secId, rowId, { _saving: true, _error: undefined, computed_qty: computed })

    if (row._draft) {
      const result = await addRow(
        {
          section_id: secId,
          description: row.description,
          field_values: row.field_values,
          computed_qty: computed,
          remark: row.remark,
        },
        wsId,
        itemId,
      )
      if (result?.error) {
        patchRow(secId, rowId, { _saving: false, _error: result.error })
        return
      }
      if (result.row) {
        const serverRow = result.row as unknown as ServerRow
        setSections(arr =>
          arr.map(s =>
            s.id === secId ? { ...s, rows: s.rows.map(r => (r.id === rowId ? { ...serverRow } : r)) } : s,
          ),
        )
      }
    } else {
      const result = await updateRow(
        rowId,
        {
          description: row.description,
          field_values: row.field_values,
          computed_qty: computed,
          remark: row.remark,
        },
        wsId,
        itemId,
      )
      if (result?.error) {
        patchRow(secId, rowId, { _saving: false, _error: result.error })
        return
      }
      patchRow(secId, rowId, { _saving: false, _draft: false })
    }
    refresh()
  }

  async function handleDeleteRow(secId: string, rowId: string) {
    const row = sections.find(s => s.id === secId)?.rows.find(r => r.id === rowId)
    if (!row) return
    if (row._draft) {
      setSections(arr => arr.map(s => (s.id === secId ? { ...s, rows: s.rows.filter(r => r.id !== rowId) } : s)))
      return
    }
    const result = await deleteRow(rowId, wsId, itemId)
    if (result?.error) {
      setError(result.error)
      return
    }
    setSections(arr => arr.map(s => (s.id === secId ? { ...s, rows: s.rows.filter(r => r.id !== rowId) } : s)))
    refresh()
  }

  return (
    <div>
      <Card className="p-4 mb-4 bg-gradient-to-r from-blue-50 to-slate-50 border-blue-100">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <div>
            <span className="text-gray-500">Item total qty: </span>
            <span className="font-bold text-gray-900 text-lg">
              {itemTotal.toLocaleString('en-IN', { maximumFractionDigits: 4 })}
            </span>
            <span className="text-gray-500"> {itemUom}</span>
            <span className="text-xs text-gray-500 ml-3">
              ({sections.length} section{sections.length === 1 ? '' : 's'})
            </span>
          </div>
          {!readOnly && (
            <Button onClick={() => setShowAddSection(true)} disabled={busy} size="sm">
              <Plus className="h-4 w-4" /> Add section
            </Button>
          )}
        </div>
      </Card>

      {error && (
        <div className="mb-3 p-3 rounded-md bg-red-50 border border-red-200 text-sm text-red-700 flex justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-500">×</button>
        </div>
      )}

      {showAddSection && (
        <AddSectionForm
          templates={templates}
          itemUom={itemUom}
          onCancel={() => setShowAddSection(false)}
          onSubmit={handleAddSection}
        />
      )}

      <div className="space-y-3">
        {sections.map(section => (
          <SectionCard
            key={section.id}
            section={section}
            readOnly={readOnly}
            onToggleCollapse={() => patchSection(section.id, { _collapsed: !section._collapsed })}
            onChangeUnitsCount={v => handleUnitsCountChange(section.id, v)}
            onDelete={() => handleDeleteSection(section.id)}
            onAddRow={() => startNewRow(section.id)}
            onChangeRow={(rowId, patch) => patchRow(section.id, rowId, patch)}
            onSaveRow={rowId => saveRow(section.id, rowId)}
            onDeleteRow={rowId => handleDeleteRow(section.id, rowId)}
          />
        ))}
        {sections.length === 0 && !showAddSection && (
          <Card className="p-10 text-center text-gray-500 text-sm border-dashed">
            No sections yet. {readOnly ? '' : 'Click + Add section to start a working.'}
          </Card>
        )}
      </div>
    </div>
  )
}

// ============================================================
function AddSectionForm({
  templates,
  itemUom,
  onCancel,
  onSubmit,
}: {
  templates: ServerTemplate[]
  itemUom: string
  onCancel: () => void
  onSubmit: (payload: {
    template_id: string | null
    title: string
    columns: QtyColumn[]
    formula: string | null
    unit: string
    units_count: number
  }) => Promise<void>
}) {
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '')
  const [title, setTitle] = useState('')
  const [unitsCount, setUnitsCount] = useState(1)
  const [busy, setBusy] = useState(false)
  const template = templates.find(t => t.id === templateId)
  const defaultUnit = template?.default_unit ?? itemUom ?? 'SMT'
  const [unit, setUnit] = useState(defaultUnit)

  async function handleSubmit() {
    if (!template || !title.trim()) return
    setBusy(true)
    await onSubmit({
      template_id: template.id,
      title: title.trim(),
      columns: template.columns,
      formula: template.formula,
      unit,
      units_count: unitsCount,
    })
    setBusy(false)
  }

  return (
    <Card className="mb-3 p-5 border-blue-200 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-900">New section</h3>
        <button onClick={onCancel} className="text-gray-400 hover:text-gray-600">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Template *</Label>
          <select
            value={templateId}
            onChange={e => {
              setTemplateId(e.target.value)
              const tpl = templates.find(t => t.id === e.target.value)
              if (tpl) setUnit(tpl.default_unit)
            }}
            className="mt-1 w-full h-10 rounded-md border border-gray-300 bg-white px-3 text-sm"
          >
            {templates.map(t => (
              <option key={t.id} value={t.id}>
                {t.name} {t.is_seed ? '' : '(custom)'}
              </option>
            ))}
          </select>
          {template && (
            <p className="text-xs text-gray-500 mt-1">
              Columns: {template.columns.map(c => c.label).join(', ')} ·{' '}
              {template.formula ? `formula: ${template.formula}` : 'manual qty'}
            </p>
          )}
        </div>
        <div>
          <Label className="text-xs">Section title *</Label>
          <Input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="e.g. Toilet Dado, Compact studio, Roof beam B-12…"
            className="mt-1"
          />
        </div>
        <div>
          <Label className="text-xs">Unit</Label>
          <select
            value={unit}
            onChange={e => setUnit(e.target.value)}
            className="mt-1 w-full h-10 rounded-md border border-gray-300 bg-white px-3 text-sm"
          >
            {UNIT_OPTIONS.map(u => (
              <option key={u}>{u}</option>
            ))}
          </select>
        </div>
        <div>
          <Label className="text-xs">
            Units count <span className="text-gray-400">(for "× N typical units")</span>
          </Label>
          <Input
            type="number"
            min={1}
            step="any"
            value={unitsCount}
            onChange={e => setUnitsCount(Number(e.target.value) || 1)}
            className="mt-1"
          />
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <Button onClick={onCancel} variant="outline" size="sm">
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={busy || !title.trim()} size="sm">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Add section
        </Button>
      </div>
    </Card>
  )
}

// ============================================================
function SectionCard({
  section,
  readOnly,
  onToggleCollapse,
  onChangeUnitsCount,
  onDelete,
  onAddRow,
  onChangeRow,
  onSaveRow,
  onDeleteRow,
}: {
  section: ClientSection
  readOnly: boolean
  onToggleCollapse: () => void
  onChangeUnitsCount: (v: number) => void
  onDelete: () => void
  onAddRow: () => void
  onChangeRow: (rowId: string, patch: Partial<ClientRow>) => void
  onSaveRow: (rowId: string) => void
  onDeleteRow: (rowId: string) => void
}) {
  const rowsSum = section.rows.reduce(
    (acc, r) => acc + (r._draft ? safeEval(section, r) : Number(r.computed_qty ?? 0)),
    0,
  )
  const sectionTotal = rowsSum * section.units_count

  return (
    <Card className="p-0 overflow-hidden">
      <div className="px-4 py-3 flex items-center justify-between bg-gray-50 border-b border-gray-100">
        <button onClick={onToggleCollapse} className="flex items-center gap-2 text-left">
          {section._collapsed ? (
            <ChevronRight className="h-4 w-4 text-gray-500" />
          ) : (
            <ChevronDown className="h-4 w-4 text-gray-500" />
          )}
          <span className="text-xs font-mono text-gray-500">§{section.sr_no}</span>
          <span className="text-sm font-semibold text-gray-900">{section.title}</span>
        </button>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-gray-500">×</span>
          <Input
            type="number"
            min={1}
            step="any"
            disabled={readOnly}
            value={section.units_count}
            onChange={e => onChangeUnitsCount(Number(e.target.value) || 1)}
            className="w-16 h-7 text-right text-xs px-1"
            title="Units count multiplier"
          />
          <span className="text-gray-500">→</span>
          <span className="font-semibold text-gray-900">
            {sectionTotal.toLocaleString('en-IN', { maximumFractionDigits: 4 })} {section.unit}
          </span>
          {!readOnly && (
            <button
              onClick={onDelete}
              className="ml-2 p-1.5 rounded-md text-gray-400 hover:bg-red-50 hover:text-red-600"
              title="Delete section"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {!section._collapsed && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="text-left px-3 py-2 w-10 font-medium">#</th>
                <th className="text-left px-3 py-2 font-medium min-w-[180px]">Description</th>
                {section.columns.map(c => (
                  <th key={c.key} className="text-right px-2 py-2 font-medium">
                    {c.label}
                  </th>
                ))}
                <th className="text-right px-2 py-2 font-medium">Qty</th>
                <th className="text-right px-2 py-2 font-medium w-24">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {section.rows.map(row => (
                <RowEditor
                  key={row.id}
                  section={section}
                  row={row}
                  readOnly={readOnly}
                  onChange={patch => onChangeRow(row.id, patch)}
                  onSave={() => onSaveRow(row.id)}
                  onDelete={() => onDeleteRow(row.id)}
                />
              ))}
              {section.rows.length === 0 && (
                <tr>
                  <td colSpan={3 + section.columns.length} className="px-3 py-6 text-center text-gray-500 text-sm">
                    No rows yet.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="bg-gray-50 border-t border-gray-100">
                <td colSpan={2 + section.columns.length} className="px-3 py-2 text-right text-xs uppercase tracking-wide text-gray-500 font-medium">
                  Sub-total (× {section.units_count} ={' '}
                  {sectionTotal.toLocaleString('en-IN', { maximumFractionDigits: 4 })} {section.unit})
                </td>
                <td className="px-2 py-2 text-right font-semibold text-gray-900">
                  {rowsSum.toLocaleString('en-IN', { maximumFractionDigits: 4 })}
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
          {!readOnly && (
            <div className="px-4 py-2 bg-gray-50 border-t border-gray-100">
              <Button onClick={onAddRow} variant="outline" size="sm">
                <Plus className="h-3.5 w-3.5" /> Add row
              </Button>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

// ============================================================
function RowEditor({
  section,
  row,
  readOnly,
  onChange,
  onSave,
  onDelete,
}: {
  section: ClientSection
  row: ClientRow
  readOnly: boolean
  onChange: (patch: Partial<ClientRow>) => void
  onSave: () => void
  onDelete: () => void
}) {
  function updateFieldValue(key: string, value: unknown) {
    const newValues = { ...row.field_values, [key]: value }
    const computed = safeEval(section, { ...row, field_values: newValues })
    onChange({ field_values: newValues, computed_qty: computed, _draft: row._draft ?? true })
  }

  const isDirty = row._draft || row._saving

  return (
    <tr className={row._error ? 'bg-red-50' : ''}>
      <td className="px-3 py-1.5 text-gray-500 align-top text-xs">{row.sr_no}</td>
      <td className="px-3 py-1.5 align-top">
        <Input
          type="text"
          disabled={readOnly}
          value={row.description ?? ''}
          onChange={e => onChange({ description: e.target.value, _draft: true })}
          placeholder="e.g. Compact studio-toilet, dedn. door…"
          className="h-8"
        />
        {row._error && <div className="text-xs text-red-600 mt-1">{row._error}</div>}
      </td>
      {section.columns.map(col => (
        <td key={col.key} className="px-2 py-1.5 align-top text-right">
          {col.type === 'number' ? (
            <MoneyInput
              disabled={readOnly}
              value={(row.field_values[col.key] as number | undefined) ?? ''}
              onChange={(v) => updateFieldValue(col.key, v === '' ? null : Number(v))}
              className="h-8 w-20 text-right text-xs"
            />
          ) : (
            <Input
              type="text"
              disabled={readOnly}
              value={(row.field_values[col.key] as string | undefined) ?? ''}
              onChange={e => updateFieldValue(col.key, e.target.value)}
              className="h-8 w-28 text-xs"
            />
          )}
        </td>
      ))}
      <td className="px-2 py-1.5 align-top text-right font-medium text-gray-900">
        {row._draft
          ? safeEval(section, row).toLocaleString('en-IN', { maximumFractionDigits: 4 })
          : Number(row.computed_qty ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 4 })}
      </td>
      <td className="px-2 py-1.5 align-top text-right">
        <div className="flex items-center justify-end gap-1">
          {isDirty && !readOnly && (
            <Button onClick={onSave} disabled={row._saving} size="sm" className="h-7 px-2">
              {row._saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            </Button>
          )}
          {!readOnly && (
            <button
              onClick={onDelete}
              className="p-1 rounded-md text-gray-400 hover:bg-red-50 hover:text-red-600"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}

function safeEval(section: ClientSection, row: ClientRow): number {
  try {
    return evaluateFormula(section.formula ?? '', section.columns, row.field_values ?? {})
  } catch {
    return 0
  }
}
