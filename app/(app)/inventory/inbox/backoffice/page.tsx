import { redirect } from 'next/navigation'

// The separate "availability check" (backoffice) step was removed — the
// storekeeper already sees live stock, so a request now goes straight to the
// Atm Head (or the store). This route is kept only so an old bookmark lands
// somewhere sensible instead of 404ing.
export default async function BackofficeInboxRedirect() {
  redirect('/inventory')
}
