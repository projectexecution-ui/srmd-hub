// Provider-agnostic AI helper. Tries Gemini (free, generous quota,
// India-allowed, native JSON output) first; falls back to Groq (free,
// fast, OpenAI-compatible) when Gemini rate-limits or errors. Both are
// no-credit-card free tiers — well within volume for SRMD Cost Control.
//
// Callers don't need to know which provider answered. Result includes
// `provider` + `model` for logging and the UI's tiny model badge.
//
// All AI features in Cost Control go through this file. Replaces the
// direct @anthropic-ai/sdk calls that were costing money per invocation.

const GEMINI_MODEL = 'gemini-2.5-flash-lite'
const GEMINI_EMBED_MODEL = 'text-embedding-004'
const GROQ_MODEL = 'llama-3.3-70b-versatile'

export type AiProvider = 'gemini' | 'groq'

export interface AiOk<T> {
  ok: true
  provider: AiProvider
  model: string
  data: T
  tokens?: { input?: number; output?: number }
}
export interface AiErr {
  ok: false
  reason: string
  /** Rate-limit / quota — caller may retry later or the wrapper falls back. */
  rateLimited?: boolean
}
export type AiResult<T> = AiOk<T> | AiErr

export function hasAiProvider(): boolean {
  return !!(process.env.GEMINI_API_KEY || process.env.GROQ_API_KEY)
}

export function aiProviderHint(): string {
  if (process.env.GEMINI_API_KEY) return 'gemini'
  if (process.env.GROQ_API_KEY) return 'groq'
  return 'none'
}

/** Structured JSON. Gemini uses native responseMimeType=application/json; Groq uses JSON mode. */
export async function generateJSON<T = unknown>(args: {
  system: string
  user: string
  maxOutputTokens?: number
}): Promise<AiResult<T>> {
  if (process.env.GEMINI_API_KEY) {
    const r = await callGeminiJSON<T>(args)
    if (r.ok) return r
    if (!r.rateLimited || !process.env.GROQ_API_KEY) return r
    console.warn('[ai] Gemini failed (rate-limit/quota) — falling back to Groq')
  }
  if (process.env.GROQ_API_KEY) return callGroqJSON<T>(args)
  return { ok: false, reason: 'No AI provider configured. Set GEMINI_API_KEY (recommended, free) or GROQ_API_KEY in your env.' }
}

/** Plain text generation (for justifications, approval summaries). */
export async function generateText(args: {
  system: string
  user: string
  maxOutputTokens?: number
}): Promise<AiResult<string>> {
  if (process.env.GEMINI_API_KEY) {
    const r = await callGeminiText(args)
    if (r.ok) return r
    if (!r.rateLimited || !process.env.GROQ_API_KEY) return r
    console.warn('[ai] Gemini failed (rate-limit/quota) — falling back to Groq')
  }
  if (process.env.GROQ_API_KEY) return callGroqText(args)
  return { ok: false, reason: 'No AI provider configured.' }
}

/** Batch embeddings for semantic duplicate detection. Gemini only — Groq doesn't expose embeddings. */
export async function embed(texts: string[]): Promise<AiResult<number[][]>> {
  if (!process.env.GEMINI_API_KEY) {
    return { ok: false, reason: 'GEMINI_API_KEY required for embeddings (free tier).' }
  }
  if (texts.length === 0) return { ok: true, provider: 'gemini', model: GEMINI_EMBED_MODEL, data: [] }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBED_MODEL}:batchEmbedContents?key=${process.env.GEMINI_API_KEY}`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: texts.map(t => ({
          model: `models/${GEMINI_EMBED_MODEL}`,
          content: { parts: [{ text: t }] },
        })),
      }),
    })
    if (!res.ok) {
      const body = await res.text()
      return { ok: false, reason: `Gemini embed ${res.status}: ${body.slice(0, 200)}`, rateLimited: res.status === 429 || res.status === 503 }
    }
    const json = await res.json() as { embeddings: { values: number[] }[] }
    return { ok: true, provider: 'gemini', model: GEMINI_EMBED_MODEL, data: json.embeddings.map(e => e.values) }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'Embed call failed' }
  }
}

// ---------- Gemini REST ----------

async function callGeminiJSON<T>(args: { system: string; user: string; maxOutputTokens?: number }): Promise<AiResult<T>> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: args.system }] },
        contents: [{ role: 'user', parts: [{ text: args.user }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.2,
          maxOutputTokens: args.maxOutputTokens ?? 8000,
        },
      }),
    })
    if (!res.ok) {
      const body = await res.text()
      return { ok: false, reason: `Gemini ${res.status}: ${body.slice(0, 300)}`, rateLimited: res.status === 429 || res.status === 503 }
    }
    type GeminiResp = {
      candidates?: { content?: { parts?: { text?: string }[] } }[]
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
    }
    const json = await res.json() as GeminiResp
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim()
    if (!cleaned) return { ok: false, reason: 'Gemini returned empty response' }
    let data: T
    try { data = JSON.parse(cleaned) as T }
    catch { return { ok: false, reason: `Gemini returned non-JSON: ${cleaned.slice(0, 200)}` } }
    console.log(`[ai] gemini json tokens=${json.usageMetadata?.promptTokenCount ?? '?'}/${json.usageMetadata?.candidatesTokenCount ?? '?'}`)
    return {
      ok: true, provider: 'gemini', model: GEMINI_MODEL, data,
      tokens: { input: json.usageMetadata?.promptTokenCount, output: json.usageMetadata?.candidatesTokenCount },
    }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'Gemini call failed' }
  }
}

async function callGeminiText(args: { system: string; user: string; maxOutputTokens?: number }): Promise<AiResult<string>> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: args.system }] },
        contents: [{ role: 'user', parts: [{ text: args.user }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: args.maxOutputTokens ?? 600 },
      }),
    })
    if (!res.ok) {
      const body = await res.text()
      return { ok: false, reason: `Gemini ${res.status}: ${body.slice(0, 300)}`, rateLimited: res.status === 429 || res.status === 503 }
    }
    type GeminiResp = {
      candidates?: { content?: { parts?: { text?: string }[] } }[]
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
    }
    const json = await res.json() as GeminiResp
    const text = (json.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim()
    if (!text) return { ok: false, reason: 'Gemini returned empty response' }
    console.log(`[ai] gemini text tokens=${json.usageMetadata?.promptTokenCount ?? '?'}/${json.usageMetadata?.candidatesTokenCount ?? '?'}`)
    return {
      ok: true, provider: 'gemini', model: GEMINI_MODEL, data: text,
      tokens: { input: json.usageMetadata?.promptTokenCount, output: json.usageMetadata?.candidatesTokenCount },
    }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'Gemini call failed' }
  }
}

// ---------- Groq REST (OpenAI-compatible) ----------

async function callGroqJSON<T>(args: { system: string; user: string; maxOutputTokens?: number }): Promise<AiResult<T>> {
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.2,
        max_tokens: args.maxOutputTokens ?? 8000,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: args.system },
          { role: 'user', content: args.user },
        ],
      }),
    })
    if (!res.ok) {
      const body = await res.text()
      return { ok: false, reason: `Groq ${res.status}: ${body.slice(0, 300)}`, rateLimited: res.status === 429 }
    }
    type GroqResp = {
      choices?: { message?: { content?: string } }[]
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }
    const json = await res.json() as GroqResp
    const text = (json.choices?.[0]?.message?.content ?? '').trim()
    if (!text) return { ok: false, reason: 'Groq returned empty response' }
    let data: T
    try { data = JSON.parse(text) as T }
    catch { return { ok: false, reason: `Groq returned non-JSON: ${text.slice(0, 200)}` } }
    console.log(`[ai] groq json tokens=${json.usage?.prompt_tokens ?? '?'}/${json.usage?.completion_tokens ?? '?'}`)
    return {
      ok: true, provider: 'groq', model: GROQ_MODEL, data,
      tokens: { input: json.usage?.prompt_tokens, output: json.usage?.completion_tokens },
    }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'Groq call failed' }
  }
}

async function callGroqText(args: { system: string; user: string; maxOutputTokens?: number }): Promise<AiResult<string>> {
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.4,
        max_tokens: args.maxOutputTokens ?? 600,
        messages: [
          { role: 'system', content: args.system },
          { role: 'user', content: args.user },
        ],
      }),
    })
    if (!res.ok) {
      const body = await res.text()
      return { ok: false, reason: `Groq ${res.status}: ${body.slice(0, 300)}`, rateLimited: res.status === 429 }
    }
    type GroqResp = {
      choices?: { message?: { content?: string } }[]
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }
    const json = await res.json() as GroqResp
    const text = (json.choices?.[0]?.message?.content ?? '').trim()
    if (!text) return { ok: false, reason: 'Groq returned empty response' }
    console.log(`[ai] groq text tokens=${json.usage?.prompt_tokens ?? '?'}/${json.usage?.completion_tokens ?? '?'}`)
    return {
      ok: true, provider: 'groq', model: GROQ_MODEL, data: text,
      tokens: { input: json.usage?.prompt_tokens, output: json.usage?.completion_tokens },
    }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'Groq call failed' }
  }
}
