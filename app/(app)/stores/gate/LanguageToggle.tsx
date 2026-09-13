'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Languages } from 'lucide-react'
import { setFieldLang } from '@/lib/stores/actions'
import type { FieldLang } from '@/lib/stores/lang'

/**
 * The language switch, ON the screen it changes.
 *
 * It first shipped only as the seventh tab of Masters, behind a horizontal
 * scroll — Aksha's reply was "wher is the tooggle ?", which is the whole
 * review a buried control ever gets. A setting that governs the screen right
 * in front of you belongs next to that screen, not two clicks away in a list
 * of masters you are not currently editing.
 *
 * Compact on purpose: two words and a pair of pills, sitting above the gate
 * form rather than competing with it. The fuller panel — with a live preview
 * of each option — stays in Masters for when the choice is the task.
 */
export function LanguageToggle({ current, isAdmin }: { current: FieldLang; isAdmin: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [picked, setPicked] = useState<FieldLang>(current)
  const [error, setError] = useState<string | null>(null)

  // Non-admins are told what it is, not shown a control they cannot use.
  if (!isAdmin) {
    return (
      <p className="text-[12px] text-gray-500 flex items-center gap-1.5">
        <Languages className="h-3.5 w-3.5" />
        Gate screens are in {current === 'gu' ? 'Gujarati' : 'Gujarati and English'}
      </p>
    )
  }

  const flip = (lang: FieldLang) => {
    if (lang === picked) return
    setPicked(lang); setError(null)
    start(async () => {
      const r = await setFieldLang(lang)
      if (r.ok) router.refresh()
      else { setPicked(current); setError(r.message) }
    })
  }

  const pill = (on: boolean) =>
    `px-3 py-1.5 text-[12.5px] font-semibold rounded-md min-h-[36px] transition-colors ${
      on ? 'bg-white text-indigo-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
    }`

  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
      <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-gray-500">
        <Languages className="h-3.5 w-3.5" />
        Gate screens
      </span>
      <div className={`inline-flex items-center gap-0.5 rounded-lg bg-gray-100 p-0.5 ${pending ? 'opacity-60' : ''}`}>
        <button type="button" disabled={pending} onClick={() => flip('gu')} className={pill(picked === 'gu')} lang="gu">
          ગુજરાતી
        </button>
        <button type="button" disabled={pending} onClick={() => flip('both')} className={pill(picked === 'both')}>
          + English
        </button>
      </div>
      <Link href="/stores/masters" className="text-[11.5px] text-gray-400 hover:text-indigo-700 hover:underline">
        see both side by side
      </Link>
      {error && <span role="alert" className="text-[12px] text-rose-700 w-full">{error}</span>}
    </div>
  )
}
