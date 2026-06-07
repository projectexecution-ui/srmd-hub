// Compact AI insights panel for an Excel-mode working sheet. Renders the
// material / labour / equipment bifurcation produced by the AI parser
// (/api/cost-control/working-sheets/ai-parse) along with sub-skill move
// suggestions and rate concerns. Shows nothing when the AI didn't run.

import { Sparkles, AlertTriangle, Move } from 'lucide-react'
import { formatINR } from '@/lib/utils'

interface AiParseMeta {
  text?: string | null
  model?: string
  rows_in?: number
  rows_out?: number
  suggestions_count?: number
  rate_concerns_count?: number
  totals_by_category?: Partial<Record<'material' | 'labour' | 'material_and_labour' | 'equipment', number>>
  split_totals?: Partial<Record<'material' | 'labour' | 'equipment', number>>
  run_at?: string
}

interface AiRowMetaLite {
  category?: 'material' | 'labour' | 'material_and_labour' | 'equipment' | null
  material_value?: number | null
  labour_value?: number | null
  suggested_sub_skill_id?: string | null
  rate_concern?: string | null
}

interface Row {
  row_no: number
  amount: number | null
  ai_meta: AiRowMetaLite | null
}

export function AiBifurcationPanel({
  aiParseMeta,
  rows,
}: {
  aiParseMeta: AiParseMeta | null
  rows: Row[]
}) {
  if (!aiParseMeta) return null

  // Prefer DB-computed split_totals; fall back to row-level reduction so
  // the panel still works for older WSes saved before this column existed.
  const splitTotals = (aiParseMeta.split_totals ?? rows.reduce(
    (acc, r) => {
      const cat = r.ai_meta?.category
      if (cat === 'material') acc.material += r.amount ?? 0
      else if (cat === 'labour') acc.labour += r.amount ?? 0
      else if (cat === 'material_and_labour') {
        acc.material += r.ai_meta?.material_value ?? 0
        acc.labour   += r.ai_meta?.labour_value   ?? 0
      } else if (cat === 'equipment') acc.equipment += r.amount ?? 0
      return acc
    },
    { material: 0, labour: 0, equipment: 0 } as Record<'material' | 'labour' | 'equipment', number>,
  )) as { material?: number; labour?: number; equipment?: number }

  const material = splitTotals.material ?? 0
  const labour   = splitTotals.labour   ?? 0
  const equipment = splitTotals.equipment ?? 0
  const total = material + labour + equipment

  const rateConcerns = rows.filter(r => r.ai_meta?.rate_concern).length
  const subSuggestions = aiParseMeta.suggestions_count ?? rows.filter(r => r.ai_meta?.suggested_sub_skill_id).length

  return (
    <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-violet-700" />
        <p className="text-sm font-bold text-violet-900">AI bifurcation summary</p>
        <span className="text-[10px] text-violet-600 ml-auto">{aiParseMeta.model ?? 'AI'} · {aiParseMeta.rows_out ?? rows.length} line items</span>
      </div>
      {aiParseMeta.text && <p className="text-xs text-violet-900/90 whitespace-pre-line">{aiParseMeta.text}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <BifurcationCard label="Material" amount={material} pct={total > 0 ? Math.round(material / total * 100) : 0} tone="blue" />
        <BifurcationCard label="Labour" amount={labour} pct={total > 0 ? Math.round(labour / total * 100) : 0} tone="green" />
        <BifurcationCard label="Equipment" amount={equipment} pct={total > 0 ? Math.round(equipment / total * 100) : 0} tone="amber" />
      </div>

      {(subSuggestions > 0 || rateConcerns > 0) && (
        <div className="flex flex-wrap items-center gap-3 text-[11px] pt-1 border-t border-violet-100">
          {subSuggestions > 0 && (
            <span className="inline-flex items-center gap-1 text-blue-700">
              <Move className="h-3 w-3" />
              {subSuggestions} row{subSuggestions === 1 ? '' : 's'} fit a different sub-skill
            </span>
          )}
          {rateConcerns > 0 && (
            <span className="inline-flex items-center gap-1 text-amber-700">
              <AlertTriangle className="h-3 w-3" />
              {rateConcerns} rate concern{rateConcerns === 1 ? '' : 's'}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function BifurcationCard({ label, amount, pct, tone }: { label: string; amount: number; pct: number; tone: 'blue' | 'green' | 'amber' }) {
  const toneMap = {
    blue:  'border-blue-200 bg-white text-blue-900',
    green: 'border-green-200 bg-white text-green-900',
    amber: 'border-amber-200 bg-white text-amber-900',
  } as const
  const barMap = {
    blue:  'bg-blue-500',
    green: 'bg-green-500',
    amber: 'bg-amber-500',
  } as const
  return (
    <div className={`rounded-lg border ${toneMap[tone]} px-3 py-2`}>
      <p className="text-[10px] uppercase tracking-wide opacity-70">{label}</p>
      <p className="text-sm font-bold tabular-nums">{formatINR(amount)}</p>
      <div className="mt-1 h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full ${barMap[tone]} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-[10px] mt-0.5 opacity-70">{pct}% of total</p>
    </div>
  )
}
