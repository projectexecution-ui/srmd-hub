'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Languages, Lock } from 'lucide-react'
import { setFieldLang } from '@/lib/stores/actions'
import { T, show, type FieldLang } from '@/lib/stores/lang'
import { Notice } from '../ui'

/**
 * The one switch an admin has over the gate screens.
 *
 * Shown with a live preview of what the guard will actually see, because the
 * difference between the two settings is a thing you look at, not a thing you
 * read a description of.
 */
const OPTIONS: Array<{ key: FieldLang; title: string; sub: string }> = [
  { key: 'gu',   title: 'Gujarati only',       sub: 'Bigger type, fewer words. What the gate staff read.' },
  { key: 'both', title: 'English and Gujarati', sub: 'English on top, Gujarati under it. For training, or a new guard.' },
]

export function LanguagePanel({ current, isAdmin }: { current: FieldLang; isAdmin: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [picked, setPicked] = useState<FieldLang>(current)

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[15px] font-bold text-gray-900">Language of the gate screens</h2>
        <p className="text-[12.5px] text-gray-500 mt-0.5 max-w-2xl">
          Applies to the security guard&rsquo;s screen and the storekeeper&rsquo;s — the two screens used on a
          phone at the gate. Everything else in Stores stays in English.
        </p>
      </div>

      {!isAdmin && (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5">
          <Lock className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
          <p className="text-[12.5px] text-amber-900">
            Only an admin can change this. You can see what it is set to.
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {OPTIONS.map(o => {
          const on = picked === o.key
          return (
            <button
              key={o.key} type="button" disabled={!isAdmin || pending}
              onClick={() => {
                setPicked(o.key)
                start(async () => {
                  const r = await setFieldLang(o.key)
                  setResult(r)
                  if (r.ok) router.refresh()
                  else setPicked(current)
                })
              }}
              className={`text-left rounded-xl border-2 p-4 transition-colors disabled:cursor-not-allowed ${
                on ? 'border-indigo-600 bg-indigo-50 ring-4 ring-indigo-100' : 'border-gray-200 bg-white hover:border-gray-300'
              } ${!isAdmin ? 'opacity-70' : ''}`}
            >
              <div className="flex items-center gap-2">
                <Languages className={`h-4 w-4 ${on ? 'text-indigo-700' : 'text-gray-400'}`} />
                <span className="text-[13.5px] font-bold text-gray-900">{o.title}</span>
                {on && (
                  <span className="ml-auto rounded-full bg-indigo-600 px-2 py-0.5 text-[10.5px] font-bold text-white">
                    In use
                  </span>
                )}
              </div>
              <p className="text-[12px] text-gray-500 mt-1">{o.sub}</p>

              {/* Exactly what the guard sees, at the size he sees it. */}
              <div className="mt-3 rounded-lg border border-gray-200 bg-white px-3 py-3">
                <Preview lang={o.key} />
              </div>
            </button>
          )
        })}
      </div>

      {result && <Notice kind={result.ok ? 'ok' : 'bad'}>{result.message}</Notice>}

      <p className="text-[11.5px] text-gray-500">
        A phrase with no Gujarati — a delivery mode you invented, say — still shows its English in either
        setting. A blank label would be worse than the wrong language.
      </p>
    </div>
  )
}

function Preview({ lang }: { lang: FieldLang }) {
  const q = show(T.qWho, lang)
  const a = show(T.next, lang)
  return (
    <>
      <p className={`font-bold text-gray-900 leading-tight ${q.second ? 'text-[17px]' : 'text-[19px]'}`} lang={q.leadLang}>
        {q.lead}
      </p>
      {q.second && <p className="text-[15px] text-indigo-800 leading-tight" lang={q.secondLang}>{q.second}</p>}
      <span className="mt-2.5 inline-flex items-center justify-center rounded-lg bg-indigo-700 px-4 py-2 text-white">
        <span className="text-center">
          <span className={`block leading-tight ${a.second ? 'text-[13px]' : 'text-[15px]'}`} lang={a.leadLang}>{a.lead}</span>
          {a.second && <span className="block text-[12px] leading-tight opacity-90" lang={a.secondLang}>{a.second}</span>}
        </span>
      </span>
    </>
  )
}
