import { redirect } from 'next/navigation'

// Old IN4 Indent → PO Hub was an iframe of public/indent-tracker.html.
// It's been folded into /procurement-tracker which now handles both IN4
// report formats with the same saffron UI. Send the route there.
// The static HTML stays at /indent-tracker.html as a zero-cost offline
// fallback if direct-linked.
export default function IN4IndentToPOHubPage() {
  redirect('/procurement-tracker')
}
