import { PageSkeleton } from '@/components/ui/page-skeleton'

// Paints the chrome of JMR immediately, while the server queries run.
export default function Loading() {
  return <PageSkeleton variant="table" stats={4} rows={8} />
}
