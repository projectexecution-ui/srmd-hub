import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ClipboardList, ExternalLink, Radio } from 'lucide-react'
import { getMyProfile } from '@/lib/auth'
import { canSeeOldIndentToPo, OLD_INDENT_TO_PO_SRC } from '@/lib/old-indent-to-po'

export const dynamic = 'force-dynamic'

/**
 * OLD INDENT TO PO — the V1 tracker, back.
 *
 * Aksha, 21 Sep 2026: "it was very helpful for me to check all Projects in one
 * screen". This is the original file, byte for byte out of the commit that
 * deleted it on 10 September (clean-up round 2) — not a rebuild. Restoring the
 * thing he remembers is the point; a fresh version of it would be a different
 * screen wearing its name.
 *
 * It reads an IN4 PurchaseOrderReport export in the browser and shows every
 * project on one page. Nothing is uploaded anywhere and nothing is saved — the
 * spreadsheet is parsed in the tab and forgotten when it closes.
 *
 * The live /procurement-tracker stays exactly as it is. This does not replace
 * it and is not wired to IN4; it is the old tool, kept because he finds it
 * useful, and it is his alone until he says otherwise.
 */
export default async function OldIndentToPoPage() {
  const profile = await getMyProfile()
  // Not a redirect and not a polite message: for anybody else this screen does
  // not exist. Same refusal the lane's absence implies.
  if (!canSeeOldIndentToPo(profile?.role)) notFound()

  return (
    <div className="flex flex-col h-[calc(100vh-1rem)]">
      <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 bg-white px-4 py-2.5 shrink-0">
        <ClipboardList className="h-4 w-4 shrink-0 text-amber-700" />
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-tight text-gray-900">OLD INDENT TO PO</p>
          <p className="text-[11.5px] leading-tight text-gray-500">
            The V1 tracker · upload an IN4 PurchaseOrderReport export · every project on one screen
          </p>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {/* The live one is not going anywhere, and somebody landing here by
              habit should be able to get to it in one tap. */}
          <Link
            href="/procurement-tracker"
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md px-3 text-xs font-semibold text-gray-600 hover:bg-gray-100 hover:text-gray-900"
          >
            <Radio className="h-3.5 w-3.5 text-emerald-600" /> Live tracker
          </Link>
          <a
            href={OLD_INDENT_TO_PO_SRC}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md px-3 text-xs font-semibold text-gray-600 hover:bg-gray-100 hover:text-gray-900"
          >
            Full screen <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>

      <iframe
        src={OLD_INDENT_TO_PO_SRC}
        className="w-full flex-1 border-0 bg-white"
        title="OLD INDENT TO PO"
      />
    </div>
  )
}
