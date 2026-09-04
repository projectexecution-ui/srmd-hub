import { requirePermission } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { readFeedModes } from '@/lib/in4/feeds'
import UploadClient from './upload-client'

export const dynamic = 'force-dynamic'

export default async function BudgetV2UploadPage() {
  await requirePermission('budget-vs-actual-v2', 'view')
  // Feeds that are live from IN4 no longer need their Excel; the page says so.
  const modes = await readFeedModes(await createClient())
  return <UploadClient live={{ budget: modes.budget === 'live', contractor: modes.contractor === 'live', supplier: modes.supplier === 'live' }} />
}
