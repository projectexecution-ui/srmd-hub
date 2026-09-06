import { PageSkeleton } from '@/components/ui/page-skeleton'

// Paints the chrome of the Internal Estimate project page — the heaviest screen in the app immediately, while the server queries run.
export default function Loading() {
  return <PageSkeleton variant="table" stats={4} rows={12} wide />
}
