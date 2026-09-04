import { PageSkeleton } from '@/components/ui/page-skeleton'

// Paints the chrome of the Supplier report immediately, while the server queries run.
export default function Loading() {
  return <PageSkeleton variant="table" stats={3} rows={10} />
}
