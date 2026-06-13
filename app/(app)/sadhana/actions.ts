'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getMyUser } from '@/lib/auth'

type EntryInput = {
  itemId: string
  done: boolean
  valueNum: number | null
}

type Result = { ok: true } | { ok: false; error: string }

export async function saveDailyEntry(date: string, entries: EntryInput[]): Promise<Result> {
  const user = await getMyUser()
  if (!user) return { ok: false, error: 'Not authenticated' }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: 'Invalid date' }
  if (entries.length === 0) return { ok: false, error: 'Nothing to save' }

  const supabase = await createClient()

  const rows = entries.map(e => ({
    user_id: user.id,
    log_date: date,
    item_id: e.itemId,
    done: e.done,
    value_num: e.valueNum,
  }))

  const { error } = await supabase
    .from('sadhana_logs')
    .upsert(rows, { onConflict: 'user_id,log_date,item_id' })

  if (error) return { ok: false, error: error.message }

  revalidatePath('/sadhana')
  return { ok: true }
}
