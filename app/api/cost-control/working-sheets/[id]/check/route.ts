// POST /api/cost-control/working-sheets/[id]/check
// Re-runs the rate-history check + (optional) AI narrative against the
// uploaded Excel rows. Idempotent — overwrites the previous flag_summary
// and re-flags rows on cc_excel_rows.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { generateText, hasAiProvider } from '@/lib/ai'

interface ExcelRow {
  id: string
  row_no: number
  description: string | null
  unit: string | null
  qty: number | null
  rate: number | null
  amount: number | null
  formula_in_amount: string | null
}

interface FlagOut {
  row_no: number
  description: string | null
  flag: 'rate_high' | 'rate_low' | 'formula_mismatch' | 'ai_review'
  flag_severity: 'info' | 'warn' | 'error'
  flag_reason: string
}

interface HistoricalSample {
  rate: number
  description: string
  unit: string | null
}

interface SummaryOut {
  generated_at: string
  total_rows: number
  flagged_rows: number
  median_deviation: number | null
  by_flag: Record<string, number>
  narrative: string | null
  ai_used: boolean
  ai_error: string | null
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null
  const s = [...nums].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

// Loose match: same unit + first 3 alphabetic words overlap.
// Cheap and good-enough first pass; the AI step refines ambiguity.
function looseMatch(a: string | null, b: string | null): boolean {
  if (!a || !b) return false
  const tokens = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(t => t.length > 2)
  const ta = tokens(a).slice(0, 4)
  const tb = new Set(tokens(b))
  if (ta.length === 0) return false
  const overlap = ta.filter(t => tb.has(t)).length
  return overlap / ta.length >= 0.6
}

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
  await requirePermission('cost-control', 'edit', '/cost-control')

  const supabase = await createClient()

  // 1. Load the working sheet + its parsed rows + project context
  const [{ data: ws }, { data: rowsRaw }] = await Promise.all([
    supabase.from('cc_working_sheets').select('id, project_id, discipline_id, sub_skill_id, line_type, summary_total').eq('id', id).single(),
    supabase.from('cc_excel_rows').select('*').eq('working_sheet_id', id).order('row_no'),
  ])
  if (!ws) return NextResponse.json({ error: 'Working sheet not found' }, { status: 404 })
  const rows = (rowsRaw ?? []) as ExcelRow[]
  if (rows.length === 0) return NextResponse.json({ ok: true, summary: 'No rows to check' })

  // 2. Historical reference set — previously APPROVED working sheets in
  // the same sub-skill, regardless of mode. Gives us a price band per
  // line item label.
  const { data: histRows } = await supabase
    .from('cc_excel_rows')
    .select('description, unit, rate, working_sheet_id, cc_working_sheets!inner(status, sub_skill_id)')
    .eq('cc_working_sheets.status', 'approved')
    .eq('cc_working_sheets.sub_skill_id', ws.sub_skill_id)
    .not('rate', 'is', null)
    .gt('rate', 0)
    .limit(5000)
  const history: HistoricalSample[] = (histRows ?? []).map((r: { description: string | null; unit: string | null; rate: number }) => ({
    description: r.description ?? '',
    unit: r.unit,
    rate: Number(r.rate),
  }))

  // 3. Flag rows
  const flags: FlagOut[] = []
  for (const r of rows) {
    if (!r.description) continue

    // Formula mismatch — when qty × rate doesn't reconcile to amount
    if (r.qty != null && r.rate != null && r.amount != null) {
      const expected = r.qty * r.rate
      const diff = Math.abs(expected - r.amount)
      const tol = Math.max(1, Math.abs(expected) * 0.01)
      if (diff > tol) {
        flags.push({
          row_no: r.row_no,
          description: r.description,
          flag: 'formula_mismatch',
          flag_severity: 'warn',
          flag_reason: `qty × rate = ${expected.toLocaleString('en-IN')} but Excel shows ${r.amount.toLocaleString('en-IN')} (diff ${diff.toLocaleString('en-IN')})`,
        })
      }
    }

    // Rate band check.
    // Previously required ≥3 peers before any flag fired — too strict
    // for fresh data where each item only has one prior approved row.
    // Now: any peer triggers a flag if the deviation is ≥20%; severity
    // escalates with the sample size + magnitude of the deviation.
    if (r.rate != null && r.rate > 0) {
      const peers = history.filter(h =>
        looseMatch(r.description, h.description) &&
        (!r.unit || !h.unit || h.unit.toLowerCase() === r.unit.toLowerCase()),
      )
      const med = median(peers.map(p => p.rate))
      if (med != null && peers.length >= 1) {
        const ratio = r.rate / med
        const pct = Math.round((ratio - 1) * 100) // positive when above
        const peerLabel = `${peers.length} approved peer${peers.length === 1 ? '' : 's'}`
        const sampleNote = peers.length === 1
          ? ' (single peer — confirm with another approved sheet)'
          : peers.length === 2
            ? ' (only 2 peers — sample is small)'
            : ''

        // Severity ladder. Bigger deviation OR bigger sample → louder.
        function pickSeverity(dev: number, n: number): 'info' | 'warn' | 'error' {
          if (n >= 3 && dev >= 60) return 'error'
          if (n >= 3 && dev >= 30) return 'warn'
          if (n >= 2 && dev >= 30) return 'warn'
          return 'info'
        }

        if (ratio >= 1.2) {
          flags.push({
            row_no: r.row_no,
            description: r.description,
            flag: 'rate_high',
            flag_severity: pickSeverity(pct, peers.length),
            flag_reason: `Rate ₹${r.rate.toLocaleString('en-IN')} is ${pct}% above the median of ${peerLabel} (₹${med.toLocaleString('en-IN')})${sampleNote}`,
          })
        } else if (ratio <= 0.8) {
          flags.push({
            row_no: r.row_no,
            description: r.description,
            flag: 'rate_low',
            flag_severity: pickSeverity(Math.abs(pct), peers.length),
            flag_reason: `Rate ₹${r.rate.toLocaleString('en-IN')} is ${Math.abs(pct)}% below the median of ${peerLabel} (₹${med.toLocaleString('en-IN')})${sampleNote}`,
          })
        }
      }
    }
  }

  // 4. Optional AI pass — produces narrative + finds rows the mechanical
  // check missed (e.g. ambiguous item names, unusual scope). Skipped
  // silently when no AI provider is configured. Uses lib/ai (Gemini → Groq).
  let narrative: string | null = null
  let aiUsed = false
  let aiError: string | null = null
  if (hasAiProvider()) {
    const payload = {
      line_type: ws.line_type,
      rows: rows.slice(0, 100).map(r => ({ row: r.row_no, desc: r.description, unit: r.unit, qty: r.qty, rate: r.rate, amount: r.amount })),
      flags,
      peer_count: history.length,
      summary_total: ws.summary_total,
    }
    const r = await generateText({
      system: 'You are a construction cost-control reviewer. Be terse. Output 3–6 short bullet points only, no preamble. Highlight the highest-risk rows (by rupee impact), unusual rate patterns, and anything an approver should ask about. If everything looks fine, say so in one line.',
      user: `Working sheet to review (JSON):\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``,
      maxOutputTokens: 600,
    })
    if (r.ok) {
      narrative = r.data
      aiUsed = true
    } else {
      aiError = r.reason
    }
  }

  // 5. Persist flags onto rows + summary onto parent
  // Clear previous flags first
  await supabase.from('cc_excel_rows').update({ flag: null, flag_reason: null, flag_severity: null }).eq('working_sheet_id', id)
  // Bulk update flagged ones (one update per row — there are usually <20)
  for (const f of flags) {
    await supabase
      .from('cc_excel_rows')
      .update({ flag: f.flag, flag_reason: f.flag_reason, flag_severity: f.flag_severity })
      .eq('working_sheet_id', id)
      .eq('row_no', f.row_no)
  }

  const summary: SummaryOut = {
    generated_at: new Date().toISOString(),
    total_rows: rows.length,
    flagged_rows: flags.length,
    median_deviation: null,
    by_flag: flags.reduce<Record<string, number>>((acc, f) => {
      acc[f.flag] = (acc[f.flag] ?? 0) + 1
      return acc
    }, {}),
    narrative,
    ai_used: aiUsed,
    ai_error: aiError,
  }

  await supabase
    .from('cc_working_sheets')
    .update({ flag_summary: summary, last_checked_at: new Date().toISOString() })
    .eq('id', id)

  return NextResponse.json({ ok: true, summary, flags })
}
