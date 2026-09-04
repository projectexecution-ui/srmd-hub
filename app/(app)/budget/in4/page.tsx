import { redirect } from 'next/navigation'

// The IN4 sync moved under Admin → Data & imports with the other feeds
// (5 Sept 2026). Old links and bookmarks land here.
export default function In4SyncMoved() {
  redirect('/admin/in4')
}
