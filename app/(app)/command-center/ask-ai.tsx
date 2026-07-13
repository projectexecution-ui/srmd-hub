'use client'
// "Ask AI across your inbox" — Spark/Superhuman style. Asks a question over
// the user's triaged mail via /api/ecc/ask and shows the answer inline.

import { useState } from 'react'
import { Sparkles, Loader2, ArrowRight } from 'lucide-react'

const SUGGESTIONS = [
  'What needs money today?',
  'What should I do first?',
  'Draft a chase to all Desai bills',
]

export function AskAI() {
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
    <div className="mb-4">
      <form
        onSubmit={e => { e.preventDefault(); ask(q) }}
        className="flex items-center gap-2 rounded-2xl bg-white ring-1 ring-gray-200/70 shadow-sm focus-within:ring-2 focus-within:ring-teal-400 px-3.5 py-2.5 transition"
      >
        <Sparkles className="h-4 w-4 text-teal-600 flex-shrink-0" />
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Ask your inbox anything…  e.g. what needs money today?"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-gray-400 text-gray-800"
        />
        <button
          type="submit"
          disabled={busy || !q.trim()}
          className="inline-flex items-center gap-1 text-xs font-semibold bg-teal-600 text-white px-3.5 py-1.5 rounded-xl hover:bg-teal-700 disabled:opacity-50 transition"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />} Ask
        </button>
      </form>

      {!answer && !busy && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {SUGGESTIONS.map(s => (
            <button
              key={s}
              type="button"
              onClick={() => { setQ(s); ask(s) }}
              className="text-[11px] px-2 py-0.5 rounded-full bg-white border border-teal-200 text-teal-700 hover:bg-teal-100"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {err && <p className="text-xs text-rose-700 mt-2">{err}</p>}
      {answer && (
        <div className="mt-3 bg-white rounded-lg border border-teal-100 p-3 text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
          {answer}
        </div>
      )}
    </div>
  )
}
