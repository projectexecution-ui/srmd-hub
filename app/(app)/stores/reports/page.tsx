import { redirect } from 'next/navigation'

/** The reports hub is the first register — four tabs across the top get you to
 *  the others, and a hub page listing four links you immediately click is a
 *  page that exists only to be passed through. */
export default function ReportsIndex() {
  redirect('/stores/reports/vendor-in')
}
