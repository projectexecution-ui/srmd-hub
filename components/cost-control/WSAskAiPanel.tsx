'use client'
// Ask-AI panel rendered on the WS detail page. PMs / HODs / engineers
// type a free-form question; AI answers with the WS + rows + project
// context attached server-side. Preset chips are AI-generated from the
// actual sheet content (lazy-loaded the first time the panel mounts).

import { useEffect, useRef, useState, useTransition } from 'react'
import { Sparkles, Send, Loader2, Wand2, MessageSquare, ChevronDown, ChevronUp } from 'lucide-react'

interface QnA {
  question: string
  answer: string
  model: string | null
  provider: string | null
}

interface Preset { label: string; prompt: string }

export function WSAskAiPanel({ wsId, defaultOpen = false }: { wsId: string; defaultOpen?: boolean }) {
  const [open, setOpen]           = useState(defaultOpen)
  const [question, setQuestion]   = useState('')
  const [history, setHistory]     = useState<QnA[]>([])
  const [err, setErr]             = useState<string | null>(null)
  const [presets, setPresets]     = useState<Preset[] | null>(null)
  const [presetsLoading, setPresetsLoading] = useState(false)
  const [presetsErr, setPresetsErr] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const answerRef = useRef<HTMLDivElement>(null)

  // Lazy-load presets when the panel first opens.
  useEffect(() => {
    if (!open || presets !== null || presetsLoading) return
    setPresetsLoading(true)
    setPresetsErr(null)
    fetch(`/api/cost-control/working-sheets/${wsId}/ai-presets`, { method: 'POST' })
      .then(async res => {
        const json = await res.json().catch(() => null)
        if (!res.ok || !json?.ok) {
          setPresetsErr(json?.reason ?? `Failed to load suggestions (HTTP ${res.status})`)
          setPresets([])
          return
        }
        setPresets(json.presets ?? [])
      })
      .catch(e => {
        setPresetsErr(e instanceof Error ? e.message : 'Network error')
        setPresets([])
      })
      .finally(() => setPresetsLoading(false))
  }, [open, wsId, presets, presetsLoading])

  function ask(q: string) {
    const trimmed = q.trim()
    if (!trimmed) return
    setErr(null)
    setQuestion('')
    // Optimistic placeholder while waiting
    const placeholderId = history.length
    setHistory(h => [...h, { question: trimmed, answer: '', model: null, provider: null }])
    startTransition(async () => {
      try {
        const res = await fetch(`/api/cost-control/working-sheets/${wsId}/ask`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: trimmed }),
        })
        const json = await res.json().catch(() => null)
        if (!res.ok || !json?.ok) {
          setErr(json?.reason ?? `HTTP ${res.status}`)
          setHistory(h => h.filter((_, i) => i !== placeholderId))
          return
        }
        setHistory(h => h.map((qa, i) => i === placeholderId
          ? { ...qa, answer: json.answer, model: json.model ?? null, provider: json.provider ?? null }
          : qa))
        // Scroll new answer into view
        setTimeout(() => answerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 50)
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Network error')
        setHistory(h => h.filter((_, i) => i !== placeholderId))
      }
    })
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full inline-flex items-center justify-between gap-2 rounded-xl border border-violet-200 bg-violet-50/40 px-4 py-2.5 hover:bg-violet-50/70 transition-colors"
      >
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-violet-900">
          <MessageSquare className="h-4 w-4" />
          Ask AI about this sheet
        </span>
        <ChevronDown className="h-4 w-4 text-violet-600" />
      </button>
    )
  }

  return (
    <div className="rounded-xl border border-violet-200 bg-violet-50/40 overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-2 bg-violet-100/60">
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-violet-900">
          <MessageSquare className="h-4 w-4" />
          Ask AI about this sheet
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="inline-flex items-center gap-1 text-[11px] text-violet-700 hover:text-violet-900"
        >
          <ChevronUp className="h-3.5 w-3.5" /> Hide
        </button>
      </div>

      <div className="p-4 space-y-3">
        {/* Q&A history */}
        {history.length > 0 && (
          <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
            {history.map((qa, i) => (
              <div key={i} className="space-y-1.5">
                <p className="inline-block bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-800">
                  <span className="font-semibold text-gray-500">You:</span> {qa.question}
                </p>
                {qa.answer ? (
                  <div className="bg-white border border-violet-200 rounded-lg px-3 py-2">
                    <p className="text-[10px] text-violet-600 mb-1 inline-flex items-center gap-1">
                      <Sparkles className="h-3 w-3" />
                      {qa.model ?? 'AI'}
                    </p>
                    <p className="text-xs text-gray-800 whitespace-pre-line">{qa.answer}</p>
                  </div>
                ) : (
                  <p className="inline-flex items-center gap-1.5 text-[11px] text-violet-700 px-3 py-1.5">
                    <Loader2 className="h-3 w-3 animate-spin" /> Thinking…
                  </p>
                )}
              </div>
            ))}
            <div ref={answerRef} />
          </div>
        )}

        {/* Smart presets */}
        {presetsLoading ? (
          <p className="inline-flex items-center gap-1.5 text-[11px] text-violet-700">
            <Wand2 className="h-3 w-3 animate-pulse" /> Generating smart suggestions from this sheet…
          </p>
        ) : presetsErr ? (
          <p className="text-[11px] text-gray-500 italic">Couldn&apos;t load suggestions ({presetsErr}). You can still type your own question.</p>
        ) : presets && presets.length > 0 ? (
          <div>
            <p className="text-[10px] font-semibold text-violet-700 uppercase tracking-wide mb-1.5">
              <Wand2 className="h-3 w-3 inline mr-0.5" /> Try one of these
            </p>
            <div className="flex flex-wrap gap-1.5">
              {presets.map((p, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => ask(p.prompt)}
                  disabled={pending}
                  className="text-[11px] px-2.5 py-1 rounded-full border border-violet-300 bg-white text-violet-800 hover:bg-violet-100 disabled:opacity-50"
                  title={p.prompt}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {/* Input */}
        <form
          onSubmit={e => { e.preventDefault(); ask(question) }}
          className="flex items-end gap-2"
        >
          <textarea
            value={question}
            onChange={e => setQuestion(e.target.value)}
            onKeyDown={e => {
              // Ctrl+Enter / Cmd+Enter sends — common chat-style shortcut.
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault(); ask(question)
              }
            }}
            disabled={pending}
            rows={2}
            placeholder="Ask anything about this sheet — rates, missing items, comparisons, what to question on approval…"
            className="flex-1 rounded-md border border-gray-300 bg-white p-2 text-sm focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
          />
          <button
            type="submit"
            disabled={pending || !question.trim()}
            className="inline-flex items-center gap-1.5 h-10 px-3 rounded-md bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-50"
            title="Send (Ctrl+Enter)"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Ask
          </button>
        </form>

        {err && (
          <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1.5">{err}</p>
        )}
      </div>
    </div>
  )
}
