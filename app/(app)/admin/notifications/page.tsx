import { redirect } from 'next/navigation'
import { legacyTarget } from '@/lib/admin/doors'

// This screen is now a tab of an Admin door (Aksha, 23 Sep 2026). The address
// keeps working: it opens that tab. lib/admin/doors.ts says which.
export default function Page() {
  redirect(legacyTarget('/admin/notifications')!)
}
