import { PageSkeleton } from '@/components/ui/page-skeleton'

// Paints the chrome of the Indent → PO tracker (a ~800 kB blob behind it) immediately, while the server queries run.
export default function Loading() {
  return <PageSkeleton variant="table" stats={4} rows={10} />
}
