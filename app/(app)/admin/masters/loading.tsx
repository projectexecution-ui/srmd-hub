import { PageSkeleton } from '@/components/ui/page-skeleton'

// Paints the chrome of Masters immediately, while the server queries run.
export default function Loading() {
  return <PageSkeleton variant="tiles" stats={0} rows={6} />
}
