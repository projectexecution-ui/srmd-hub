'use server'
// Server-side WS code generator. Produces meaningful codes like
//   P2A02-1102-Q01
// instead of opaque serials like WS-Q-20260608-HVY.
//
// Format: <ProjectCode>-<SubSkillCode>-<Mode><Seq>
//   ProjectCode  = projects.code with spaces stripped (e.g. "P2 A02" → "P2A02")
//   SubSkillCode = cc_sub_skills.code (e.g. "1102")
//   Mode letter  = Q (Excel quick) | W (Working sheet / full BOQ) | T (Thumbrule)
//   Seq          = 2-digit zero-padded sequence within the (project, sub_skill, mode) bucket
//
// Why this shape:
// - Indian PMs read the code aloud — "P2-A02 CCTV Quick one" — and instantly know which sheet.
// - Mode letter tells you at-a-glance what kind of file it is without clicking.
// - Sequence resets per bucket so numbers stay small. The version chain v2/3 chip
//   (from cc_ws_with_versions view) handles "is this a revision" separately.
// - Old WS-Q-YYYYMMDD-XXX codes are preserved — only new inserts get smart codes.

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'

const schema = z.object({
  project_id: z.string().uuid(),
  sub_skill_id: z.string().uuid(),
  entry_mode: z.enum(['line_items', 'excel_summary', 'thumbrule']),
})

export type SmartWSCodeInput = z.infer<typeof schema>

export async function generateSmartWSCode(input: SmartWSCodeInput): Promise<string> {
  await requirePermission('cost-control', 'edit')
  const parsed = schema.parse(input)
  const supabase = await createClient()

  const [projRes, subRes] = await Promise.all([
    supabase.from('projects').select('code').eq('id', parsed.project_id).single(),
    supabase.from('cc_sub_skills').select('code').eq('id', parsed.sub_skill_id).single(),
  ])

  // Strip spaces so "P2 A02" → "P2A02". If anything is missing fall back
  // to a short id chunk so the code is never empty — the unique constraint
  // on ws_code would otherwise blow up the insert.
  const projCode = sanitize(projRes.data?.code) || parsed.project_id.slice(0, 6).toUpperCase()
  const subCode  = sanitize(subRes.data?.code)  || parsed.sub_skill_id.slice(0, 4).toUpperCase()
  const mode     = modeLetter(parsed.entry_mode)
  const prefix   = `${projCode}-${subCode}-${mode}`

  // Read the highest existing seq for this prefix. ORDER BY ws_code DESC
  // works because we zero-pad to 2 digits — strings compare as numbers.
  const { data: existing } = await supabase
    .from('cc_working_sheets')
    .select('ws_code')
    .like('ws_code', `${prefix}%`)
    .order('ws_code', { ascending: false })
    .limit(1)

  let nextSeq = 1
  if (existing && existing[0]?.ws_code) {
    const m = (existing[0].ws_code as string).match(/(\d+)$/)
    if (m) nextSeq = parseInt(m[1], 10) + 1
  }

  // 2-digit pad covers up to 99 per bucket; if a bucket ever exceeds that
  // the pad just grows naturally (the regex above reads any-length digits).
  const seq = String(nextSeq).padStart(2, '0')
  return `${prefix}${seq}`
}

function sanitize(s: string | null | undefined): string {
  if (!s) return ''
  return s.replace(/\s+/g, '').toUpperCase()
}

function modeLetter(entry_mode: SmartWSCodeInput['entry_mode']): 'Q' | 'W' | 'T' {
  if (entry_mode === 'excel_summary') return 'Q'
  if (entry_mode === 'thumbrule')     return 'T'
  return 'W'
}
