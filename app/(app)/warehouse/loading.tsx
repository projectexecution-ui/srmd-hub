import { PageSkeleton } from '@/components/ui/page-skeleton'

// Paints the chrome of the Warehouse landing immediately, while the server queries run.
export default function Loading() {
  return <PageSkeleton variant="tiles" stats={4} rows={6} />
}
