'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { ArrowLeftRight } from 'lucide-react'
import { setCrossProject } from '@/lib/stores/actions'
import { Btn, Notice } from '../ui'

/**
 * The one switch an admin owns.
 *
 * Aksha, 16 Sep 2026: "i want to know about if i want to make toggle Cross
 * Project request admin should be able to on and off the same whenever
 * requred", and then, not finding it: "i cant see the Toggle of Cross Project".
 * It was not there — I held it back until the behaviour behind it existed,
 * because a switch that stores a value and changes nothing is the one thing he
 * told me never to ship.
 *
 * So the panel SAYS WHAT MOVES. A toggle whose effects you have to remember is
 * a toggle nobody dares touch, and the two states are printed side by side
 * rather than hidden behind the act of flipping it.
 */
export function SettingsPanel({ crossProject }: { crossProject: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h2 className="text-[15px] font-bold text-gray-900">Settings</h2>
        <p className="text-[12.5px] text-gray-500 mt-0.5">
          What this section does, rather than what is in it.
        </p>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3.5 border-b border-gray-100">
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
            crossProject ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-400'}`}>
            <ArrowLeftRight className="h-4.5 w-4.5" strokeWidth={2.2} />
          </span>
          <div className="min-w-0">
            <p className="text-[14px] font-bold text-gray-900">Borrowing from another project</p>
            <p className="text-[12.5px] text-gray-500">
              Whether a site can ask for stock that belongs to a different project family.
            </p>
          </div>
          <span className={`ml-auto rounded-full px-2.5 py-1 text-[11px] font-bold ${
            crossProject ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-200 text-gray-600'}`}>
            {crossProject ? 'ON' : 'OFF'}
          </span>
        </div>

        {/* Both states, side by side. Nobody should have to flip a switch to
            find out what it does. */}
        <div className="grid sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-gray-100">
          <div className={`p-4 ${!crossProject ? 'bg-indigo-50/50' : ''}`}>
            <p className="text-[12px] font-bold uppercase tracking-wider text-gray-500">
              Off {!crossProject && <span className="text-indigo-700">· now</span>}
            </p>
            <ul className="mt-2 space-y-1.5 text-[12.5px] text-gray-700">
              <li>A site sees and asks for its own family&rsquo;s stock only — NGH covers NGH A, B, C.</li>
              <li><b>No approval.</b> The request lands on the storekeeper already approved.</li>
              <li>The site head signs for it, photographs it, and says where it was put.</li>
            </ul>
          </div>
          <div className={`p-4 ${crossProject ? 'bg-indigo-50/50' : ''}`}>
            <p className="text-[12px] font-bold uppercase tracking-wider text-gray-500">
              On {crossProject && <span className="text-indigo-700">· now</span>}
            </p>
            <ul className="mt-2 space-y-1.5 text-[12.5px] text-gray-700">
              <li>Other families&rsquo; stock becomes visible and askable.</li>
              <li>Those requests go to <b>Mayank</b> (Civil &amp; Finishes) or <b>Kanti</b> (MEP) first.</li>
              <li>Borrowed material is <b>always returnable</b>, and the lending project&rsquo;s Atm Head is told
                what is out and when it comes back.</li>
            </ul>
          </div>
        </div>

        <div className="px-4 py-3.5 border-t border-gray-100 space-y-2.5">
          {result && <Notice kind={result.ok ? 'ok' : 'bad'}>{result.message}</Notice>}
          <div className="flex flex-wrap items-center gap-3">
            <Btn
              kind={crossProject ? 'danger' : 'primary'}
              busy={pending}
              onClick={() => start(async () => {
                const r = await setCrossProject(!crossProject)
                setResult(r)
                if (r.ok) router.refresh()
              })}
            >
              {crossProject ? 'Switch it off' : 'Switch it on'}
            </Btn>
            <p className="text-[12px] text-gray-500">
              Nothing already raised changes. Requests keep the route they were given when they were
              raised, so switching this does not move somebody else&rsquo;s work.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
