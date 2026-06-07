'use server'
// Server actions for the version-chain controls on the WS detail page.

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'

const schema = z.object({
  ws_id: z.string().uuid(),
  break_chain: z.boolean(),
})

/**
 * Flip break_chain on a working sheet. When true, this WS starts a fresh
 * version chain within its (project, discipline, sub_skill, line_type)
 * bucket — older WSes in the same bucket stop being its version-mates.
 *
 * Gated by cost-control edit perms. The view recomputes version_no /
 * chain_size automatically; no row-level updates needed.
 */
export async function setBreakChain(
  wsId: string,
  breakChain: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requirePermission('cost-control', 'edit')
  const parsed = schema.safeParse({ ws_id: wsId, break_chain: breakChain })
  if (!parsed.success) return { ok: false, error: 'Invalid input' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('cc_working_sheets')
    .update({ break_chain: breakChain })
    .eq('id', wsId)
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/cost-control/working-sheets/${wsId}`)
  revalidatePath('/cost-control/working-sheets')
  return { ok: true }
}
