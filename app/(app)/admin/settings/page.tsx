import { redirect } from 'next/navigation'

// The old Settings page held only the admin-email field + a status "About" box.
// The status moved into the Admin home header, and the admin-email field is now
// inline on the Admin home (System · one setting). This route redirects there so
// old links/bookmarks and the module href still resolve.
export default function AdminSettingsPage() {
  redirect('/admin')
}
