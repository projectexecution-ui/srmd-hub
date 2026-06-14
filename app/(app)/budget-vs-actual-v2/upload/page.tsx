import { requirePermission } from '@/lib/auth'
import UploadClient from './upload-client'

export const dynamic = 'force-dynamic'

export default async function BudgetV2UploadPage() {
  await requirePermission('budget-vs-actual-v2', 'view')
  return <UploadClient />
}
