// Themed 404 for the (app) segment. Every dynamic detail page
// (/projects/[id], /pos/[id], etc.) calls notFound() when the row
// doesn't exist; this renders for all of them.

import Link from 'next/link'
import { SearchX, Home } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

export default function AppNotFound() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center p-4">
      <Card className="max-w-md w-full p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-amber-50 text-amber-700 inline-flex items-center justify-center">
            <SearchX className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-gray-900">Not found</h1>
            <p className="text-xs text-gray-500">
              The page or record you tried to open doesn&apos;t exist or you don&apos;t have access.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild className="gap-2">
            <Link href="/dashboard"><Home className="h-4 w-4" /> Go home</Link>
          </Button>
        </div>
      </Card>
    </div>
  )
}
