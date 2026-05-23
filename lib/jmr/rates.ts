// Rate resolution for a (contractor, item, project, date) tuple.
// Precedence: project-specific rate > contractor default rate, both
// constrained by valid_from <= date <= valid_till (or valid_till null).

import { createClient } from '@/lib/supabase/client'

export async function resolveRate(args: {
  contractorId: string
  itemId: string
  projectId: string | null
  onDate: string // ISO yyyy-mm-dd
}): Promise<number | null> {
  const supabase = createClient()
  const { data } = await supabase
    .from('jmr_rate_cards')
    .select('rate_per_unit, project_id, valid_from, valid_till')
    .eq('contractor_id', args.contractorId)
    .eq('item_id', args.itemId)
    .lte('valid_from', args.onDate)
    .or(`valid_till.is.null,valid_till.gte.${args.onDate}`)

  if (!data || data.length === 0) return null

  const projectSpecific = data.find(r => r.project_id === args.projectId)
  if (projectSpecific) return Number(projectSpecific.rate_per_unit)

  const fallback = data.find(r => r.project_id === null)
  return fallback ? Number(fallback.rate_per_unit) : null
}
