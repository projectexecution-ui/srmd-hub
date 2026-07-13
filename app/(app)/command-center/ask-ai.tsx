'use client'
// "Ask AI across your inbox" — compact top-right control. A button opens a
// dropdown panel with the input, suggestions and the answer.

import { useState } from 'react'
import { Sparkles, Loader2, ArrowRight, X } from 'lucide-react'

const SUGGESTIONS = [
  'What needs money today?',
  'What should I do first?',
  'Draft a chase to all Desai bills',
]

export function AskAI() {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [answer, setAnswer] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function ask(question: string) {
    const query = question.trim()
    if (!query || busy) return
    setBusy(true); setErr(null); setAnswer(null)
    try {
      const res = await fetch('/api/ecc/ask', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query }),
      })
      const data = await res.json()
      if (!res.ok) { setErr(data?.error ?? 'Could not get an answer'); setBusy(false); return }
      setAnswer(data.answer ?? '')
    } catch { setErr('Could not get an answer') }
    setBusy(false)
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-teal-600 text-white hover:bg-teal-700 transition"
      >
        <Sparkles className="h-3.5 w-3.5" /> Ask AI
      </button>

      {open && (
        <div className="absolute right-0 mt-1.5 z-30 w-[min(92vw,440px)] bg-white rounded-2xl shadow-xl ring-1 ring-gray-200 p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Ask your inbox</p>
            <button type="button" onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600"><X className="h-3.5 w-3.5" /></button>
          </div>

          <form
            onSubmit={e => { e.preventDefault(); ask(q) }}
            className="flex items-center gap-2 rounded-xl bg-gray-50 ring-1 ring-gray-200 focus-within:ring-2 focus-within:ring-teal-400 px-3 py-2 transition"
          >
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="e.g. what needs money today?"
              autoFocus
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-gray-400 text-gray-800"
            />
            <button
              type="submit"
              disabled={busy || !q.trim()}
              className="inline-flex items-center gap-1 text-xs font-semibold bg-teal-600 text-white px-2.5 py-1 rounded-lg hover:bg-teal-700 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
            </button>
          </form>

          {!answer && !busy && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => { setQ(s); ask(s) }}
                  className="text-[11px] px-2 py-0.5 rounded-full bg-white ring-1 ring-teal-200 text-teal-700 hover:bg-teal-50"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {err && <p className="text-xs text-rose-700 mt-2">{err}</p>}
          {answer && (
            <div className="mt-3 max-h-72 overflow-y-auto bg-gray-50 rounded-xl ring-1 ring-gray-100 p-3 text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
              {answer}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
