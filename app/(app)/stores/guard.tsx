import Link from 'next/link'
import { getMyProfile } from '@/lib/auth'
import {
  canOpenStoreTab, roleStoreTabs, homeStoreTab, storeTabHref, STORE_TAB_LABEL, type StoreTab,
} from '@/lib/stores/core'

/**
 * A screen that is not part of this person's job.
 *
 * Every Stores page calls this first. The layout has already refused anyone
 * outside the section altogether; what is left is somebody inside it who has
 * typed, or bookmarked, an address belonging to a different job — a guard on
 * the stock page, an engineer on Masters.
 *
 * It REFUSES WITH A SENTENCE and a way onward, rather than notFound(). Aksha
 * has asked repeatedly for no silent blockers, and a 404 on a link that
 * worked last week is the most silent blocker there is: it reads as a fault in
 * the app rather than as a decision somebody made.
 *
 * getMyProfile is wrapped in React's cache(), so asking again here costs
 * nothing on top of the layout's own check.
 */
export async function guardStoreTab(tab: StoreTab): Promise<React.ReactElement | null> {
  const profile = await getMyProfile()
  if (canOpenStoreTab(profile?.role, tab)) return null
  return <NotYourScreen tab={tab} role={profile?.role ?? null} />
}

function NotYourScreen({ tab, role }: { tab: StoreTab; role: string | null }) {
  const mine = roleStoreTabs(role)
  const home = homeStoreTab(role)
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 sm:p-8 max-w-2xl">
      <p className="text-[15px] font-bold text-gray-900">
        {STORE_TAB_LABEL[tab]} is not one of your screens
      </p>
      <p className="text-[13.5px] text-gray-600 mt-1.5 max-w-prose">
        Material In &amp; Out shows each person the part of it they work on, so nobody has to pick
        their way past screens that are somebody else&rsquo;s job. Nothing is wrong, and nothing is
        hidden from you that you are supposed to have.
      </p>

      {mine.length > 0 ? (
        <>
          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mt-5 mb-2">
            Yours {mine.length === 1 ? 'is' : 'are'}
          </p>
          <div className="flex flex-wrap gap-2">
            {mine.map(t => (
              <Link
                key={t}
                href={storeTabHref(t)}
                className={`inline-flex items-center rounded-lg px-3.5 py-2 text-[13px] font-semibold min-h-[44px] ${
                  t === home
                    ? 'bg-indigo-700 text-white hover:bg-indigo-800'
                    : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                {STORE_TAB_LABEL[t]}
              </Link>
            ))}
          </div>
        </>
      ) : (
        <p className="text-[13px] text-gray-600 mt-4">
          You are not set up for any part of this section yet. Ask Aksha to add you.
        </p>
      )}

      <p className="text-[12px] text-gray-500 mt-5">
        If this is wrong and you do need it, say so — it is one line to change.
      </p>
    </div>
  )
}
