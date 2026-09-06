import { PageSkeleton } from '@/components/ui/page-skeleton'

// Paints the chrome of IN4 live sync immediately, while the server queries run.
export default function Loading() {
  return <PageSkeleton variant="table" stats={4} rows={5} />
}
