import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { MastersNav } from './MastersNav'

/** One shell for every Masters screen: back to Admin, then the sub-nav. */
export default function MastersLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <Link href="/admin" className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 min-h-[44px] md:min-h-0"><ChevronLeft className="h-3.5 w-3.5" /> Admin</Link>
      <MastersNav />
      <div className="pt-4">{children}</div>
    </div>
  )
}
