import { PageSkeleton } from '@/components/ui/page-skeleton'

// Paints the chrome of Budget vs Actual V2 tree immediately, while the server queries run.
export default function Loading() {
  return <PageSkeleton variant="table" stats={4} rows={10} wide />
}
