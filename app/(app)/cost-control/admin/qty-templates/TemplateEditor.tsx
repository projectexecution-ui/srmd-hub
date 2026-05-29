'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MoneyInput } from '@/components/ui/money-input'
import { Label } from '@/components/ui/label'
import { Plus, Trash2, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react'
import { createTemplate, updateTemplate, deleteTemplate, type TemplatePayload } from './actions'
import { validateFormula, evaluateFormula, type QtyColumn } from '@/lib/formula'

const UNIT_OPTIONS = ['SMT', 'SFT', 'Cum', 'RMT', 'RFT', 'Nos', 'KG', 'MT', 'LS', 'Ltr']

export function TemplateEditor({
  initial,
  disciplines,
  subSkills,
  isSeed = false,
}: {
  initial: TemplatePayload
  disciplines: { id: string; code: string; name: string }[]
  subSkills: { id: string; code: string; name: string; discipline_id: string }[]
  isSeed?: boolean
}) {
  const router = useRouter()
  const [form, setForm] = useState<TemplatePayload>(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [testValues, setTestValues] = useState<Record<string, number>>({})
  const isNew = !form.id

  const filteredSubSkills =
    form.scope === 'sub_skill'
      ? subSkills.filter(s => !disciplines.length || true)
      : []

  // Live formula validation
  let formulaError: string | null = null
  try {
    if (form.formula) validateFormula(form.formula, form.columns)
  } catch (e) {
    formulaError = e instanceof Error ? e.message : 'invalid'
  }

  let testResult: number | string = '—'
  try {
    testResult = form.formula
      ? evaluateFormula(form.formula, form.columns, testValues).toLocaleString('en-IN', {
          maximumFractionDigits: 4,
        })
      : '(no formula — manual qty)'
  } catch (e) {
    testResult = `error: ${e instanceof Error ? e.message : 'unknown'}`
  }

  function addColumn() {
    setForm(f => ({
      ...f,
      columns: [...f.columns, { key: `col${f.columns.length + 1}`, label: '', type: 'number', required: false }],
    }))
  }

  function patchColumn(idx: number, patch: Partial<QtyColumn>) {
    setForm(f => ({
      ...f,
      columns: f.columns.map((c, i) => (i === idx ? { ...c, ...patch } : c)),
    }))
  }

  function removeColumn(idx: number) {
    setForm(f => ({ ...f, columns: f.columns.filter((_, i) => i !== idx) }))
  }

  async function handleSave() {
    setBusy(true)
    setError('')
    setInfo('')
    if (isNew) {
      const result = await createTemplate(form)
      if (result && 'error' in result && result.error) {
        setError(result.error)
        setBusy(false)
      }
      // On success, server action redirects — no need to handle ok
    } else {
      const result = await updateTemplate(form)
      setBusy(false)
      if (result?.error) setError(result.error)
      else {
        setInfo('Saved.')
        router.refresh()
      }
    }
  }

  async function handleDelete() {
    if (!form.id) return
    if (!confirm(`Delete template "${form.name}"? This can break existing sections that reference it.`)) return
    setBusy(true)
    const result = await deleteTemplate(form.id)
    if (result && 'error' in result && result.error) {
      setError(result.error)
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <Card className="p-3 bg-red-50 border-red-200 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-red-600 mt-0.5" />
          <span className="text-sm text-red-800">{error}</span>
        </Card>
      )}
      {info && (
        <Card className="p-3 bg-green-50 border-green-200 flex items-start gap-2">
          <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5" />
          <span className="text-sm text-green-800">{info}</span>
        </Card>
      )}
      {isSeed && (
        <Card className="p-3 bg-amber-50 border-amber-200 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5" />
          <span className="text-sm text-amber-800">
            This is a seed template shipped with the app. You can edit it, but consider creating a custom one instead.
          </span>
        </Card>
      )}

      {/* Basics */}
      <Card className="p-5 space-y-3">
        <h3 className="text-sm font-semibold text-gray-900">Basics</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label htmlFor="name">Name *</Label>
            <Input
              id="name"
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              placeholder='e.g. "Brick Bat Coba with slope"'
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="default_unit">Default unit *</Label>
            <select
              id="default_unit"
              value={form.default_unit}
              onChange={e => setForm({ ...form, default_unit: e.target.value })}
              className="mt-1 w-full h-10 rounded-md border border-gray-300 bg-white px-3 text-sm"
            >
              {UNIT_OPTIONS.map(u => (
                <option key={u}>{u}</option>
              ))}
            </select>
          </div>
          <div>
            <Label>Scope</Label>
            <div className="mt-1 grid grid-cols-3 gap-1">
              {(['global', 'discipline', 'sub_skill'] as const).map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setForm({ ...form, scope: s, scope_id: null })}
                  className={`h-10 rounded-md border text-xs font-medium ${
                    form.scope === s
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {s === 'global' ? 'Global' : s === 'discipline' ? 'Discipline' : 'Sub-skill'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label>Scope target</Label>
            {form.scope === 'global' ? (
              <Input disabled value="All disciplines" className="mt-1" />
            ) : form.scope === 'discipline' ? (
              <select
                value={form.scope_id ?? ''}
                onChange={e => setForm({ ...form, scope_id: e.target.value || null })}
                className="mt-1 w-full h-10 rounded-md border border-gray-300 bg-white px-3 text-sm"
              >
                <option value="">— pick discipline —</option>
                {disciplines.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.code} — {d.name}
                  </option>
                ))}
              </select>
            ) : (
              <select
                value={form.scope_id ?? ''}
                onChange={e => setForm({ ...form, scope_id: e.target.value || null })}
                className="mt-1 w-full h-10 rounded-md border border-gray-300 bg-white px-3 text-sm"
              >
                <option value="">— pick sub-skill —</option>
                {filteredSubSkills.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.code} — {s.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 pt-1">
          <input
            id="is_active"
            type="checkbox"
            checked={form.is_active}
            onChange={e => setForm({ ...form, is_active: e.target.checked })}
            className="h-4 w-4"
          />
          <Label htmlFor="is_active" className="text-sm">
            Active (visible to engineers)
          </Label>
        </div>
      </Card>

      {/* Columns */}
      <Card className="p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">Columns</h3>
          <Button type="button" onClick={addColumn} variant="outline" size="sm">
            <Plus className="h-3.5 w-3.5" /> Add column
          </Button>
        </div>
        <p className="text-xs text-gray-500">
          Define which numbers / text fields the engineer fills per row. Keys must be unique and start with a letter
          (e.g. <code className="font-mono">nos</code>, <code className="font-mono">L</code>,{' '}
          <code className="font-mono">B</code>, <code className="font-mono">dia</code>).
        </p>
        {form.columns.length === 0 && (
          <p className="text-sm text-gray-400 italic">
            No columns. Click "Add column" to define what the engineer measures.
          </p>
        )}
        <div className="space-y-2">
          {form.columns.map((c, idx) => (
            <div
              key={idx}
              className="grid grid-cols-12 gap-2 items-end bg-gray-50 rounded-md p-2 border border-gray-200"
            >
              <div className="col-span-3">
                <Label className="text-[10px]">Key *</Label>
                <Input
                  value={c.key}
                  onChange={e => patchColumn(idx, { key: e.target.value })}
                  placeholder="nos"
                  className="font-mono h-9"
                />
              </div>
              <div className="col-span-4">
                <Label className="text-[10px]">Label</Label>
                <Input
                  value={c.label}
                  onChange={e => patchColumn(idx, { label: e.target.value })}
                  placeholder="Nos"
                  className="h-9"
                />
              </div>
              <div className="col-span-2">
                <Label className="text-[10px]">Type</Label>
                <select
                  value={c.type}
                  onChange={e => patchColumn(idx, { type: e.target.value as 'number' | 'text' })}
                  className="h-9 w-full rounded-md border border-gray-300 bg-white text-sm"
                >
                  <option value="number">number</option>
                  <option value="text">text</option>
                </select>
              </div>
              <div className="col-span-2 flex items-center pt-5">
                <input
                  type="checkbox"
                  checked={c.required ?? false}
                  onChange={e => patchColumn(idx, { required: e.target.checked })}
                  className="h-4 w-4 mr-1"
                />
                <Label className="text-xs">Required</Label>
              </div>
              <div className="col-span-1 flex justify-end pt-5">
                <button
                  type="button"
                  onClick={() => removeColumn(idx)}
                  className="p-1.5 rounded-md text-gray-400 hover:bg-red-50 hover:text-red-600"
                  title="Delete column"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Formula */}
      <Card className="p-5 space-y-3">
        <h3 className="text-sm font-semibold text-gray-900">Formula</h3>
        <p className="text-xs text-gray-500">
          Standard math only (+ − × ÷ ^ %). Identifiers must match column keys. Leave blank for "manual qty" templates
          (engineer types the qty directly).
        </p>
        <Input
          value={form.formula ?? ''}
          onChange={e => setForm({ ...form, formula: e.target.value })}
          placeholder="nos*L*B"
          className="font-mono"
        />
        {formulaError && (
          <div className="text-xs text-red-600 flex items-center gap-1">
            <AlertCircle className="h-3 w-3" /> {formulaError}
          </div>
        )}

        {form.formula && form.columns.some(c => c.type === 'number') && (
          <div className="bg-blue-50 rounded-md p-3 border border-blue-100">
            <div className="text-xs font-semibold text-blue-900 mb-2">Try it</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-2">
              {form.columns
                .filter(c => c.type === 'number')
                .map(c => (
                  <div key={c.key}>
                    <Label className="text-[10px]">{c.label || c.key}</Label>
                    <MoneyInput
                      value={testValues[c.key] ?? ''}
                      onChange={(raw) =>
                        setTestValues(v => ({
                          ...v,
                          [c.key]: raw === '' ? 0 : Number(raw),
                        }))
                      }
                      className="h-8 text-xs"
                    />
                  </div>
                ))}
            </div>
            <div className="text-sm">
              Result: <span className="font-bold text-blue-900">{testResult}</span>{' '}
              <span className="text-gray-500">{form.default_unit}</span>
            </div>
          </div>
        )}
      </Card>

      {/* Save */}
      <div className="flex justify-between items-center">
        <div>
          {!isNew && !isSeed && (
            <Button onClick={handleDelete} variant="destructive" disabled={busy}>
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button onClick={handleSave} disabled={busy || !!formulaError}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {isNew ? 'Create template' : 'Save changes'}
          </Button>
        </div>
      </div>
    </div>
  )
}
