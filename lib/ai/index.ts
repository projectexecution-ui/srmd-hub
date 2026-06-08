// Provider-agnostic AI helper with a three-deep free-tier fallback chain:
//
//   1. Gemini 2.5 Flash-Lite  — 1,500 req/day,  great structured JSON
//   2. Groq Llama 3.3 70B    — ~14,400/day, fastest mainstream API
//   3. Cerebras Llama 3.3 70B — ~14,400/day,  separate quota pool
//
// All three are no-credit-card free tiers. Combined, they give SRMD
// roughly 30,000 free AI calls per day — well beyond what Cost Control
// can use. Callers don't need to know which provider answered: the
// result carries `provider` + `model` for logging and the UI badge.
//
// All Cost Control AI features go through this file. Replaces the old
// direct @anthropic-ai/sdk calls that were costing money per invocation.

const GEMINI_MODEL = 'gemini-2.5-flash-lite'
const GEMINI_EMBED_MODEL = 'text-embedding-004'
const GROQ_MODEL = 'llama-3.3-70b-versatile'
const CEREBRAS_MODEL = 'llama-3.3-70b'

export type AiProvider = 'gemini' | 'groq' | 'cerebras'

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
  return !!(process.env.GEMINI_API_KEY || process.env.GROQ_API_KEY || process.env.CEREBRAS_API_KEY)
}

// HTTP statuses that mean "this provider is hiccuping — try the next one".
// 429 = rate limit / quota; 5xx = upstream sick (Gemini 500 INTERNAL is a
// regular flake even when the request is valid). Falling through to the
// next provider in the chain is the right move for all of these.
function isTransient(status: number): boolean {
  return status === 429 || status >= 500
}

export function aiProviderHint(): string {
  if (process.env.GEMINI_API_KEY) return 'gemini'
  if (process.env.GROQ_API_KEY) return 'groq'
  if (process.env.CEREBRAS_API_KEY) return 'cerebras'
  return 'none'
}

/** Structured JSON. Cascades Gemini → Groq → Cerebras, falling through
 *  only on rate-limit / quota errors so genuine 4xx / 5xx (bad input,
 *  safety blocks) surface immediately instead of being silently retried. */
export async function generateJSON<T = unknown>(args: {
  system: string
  user: string
  maxOutputTokens?: number
}): Promise<AiResult<T>> {
  if (process.env.GEMINI_API_KEY) {
    const r = await callGeminiJSON<T>(args)
    if (r.ok) return r
    if (!r.rateLimited) return r
    console.warn('[ai] Gemini rate-limited — trying Groq')
  }
  if (process.env.GROQ_API_KEY) {
    const r = await callGroqJSON<T>(args)
    if (r.ok) return r
    if (!r.rateLimited || !process.env.CEREBRAS_API_KEY) return r
    console.warn('[ai] Groq rate-limited — trying Cerebras')
  }
  if (process.env.CEREBRAS_API_KEY) return callCerebrasJSON<T>(args)
  return { ok: false, reason: 'No AI provider configured. Set GEMINI_API_KEY (free, https://aistudio.google.com/apikey), GROQ_API_KEY (free, https://console.groq.com/keys), or CEREBRAS_API_KEY (free, https://cloud.cerebras.ai).' }
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
    if (!r.rateLimited) return r
    console.warn('[ai] Gemini rate-limited — trying Groq')
  }
  if (process.env.GROQ_API_KEY) {
    const r = await callGroqText(args)
    if (r.ok) return r
    if (!r.rateLimited || !process.env.CEREBRAS_API_KEY) return r
    console.warn('[ai] Groq rate-limited — trying Cerebras')
  }
  if (process.env.CEREBRAS_API_KEY) return callCerebrasText(args)
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
      return { ok: false, reason: `Gemini embed ${res.status}: ${body.slice(0, 200)}`, rateLimited: isTransient(res.status) }
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
      return { ok: false, reason: `Gemini ${res.status}: ${body.slice(0, 300)}`, rateLimited: isTransient(res.status) }
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
      return { ok: false, reason: `Gemini ${res.status}: ${body.slice(0, 300)}`, rateLimited: isTransient(res.status) }
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
      return { ok: false, reason: `Groq ${res.status}: ${body.slice(0, 300)}`, rateLimited: isTransient(res.status) }
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
      return { ok: false, reason: `Groq ${res.status}: ${body.slice(0, 300)}`, rateLimited: isTransient(res.status) }
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

// ---------- Cerebras REST (OpenAI-compatible, same Llama as Groq) ----------
//
// Cerebras runs Llama 3.3 70B on their own ASIC silicon at ~2x the speed
// of Groq. Free tier ~14,400 req/day. Endpoint is OpenAI-compatible so
// body / response shape mirrors Groq — only the URL and model name
// differ. Treated as the LAST link in the fallback chain (Gemini → Groq
// → Cerebras) so it's only hit when the two above are rate-limited.
// Get a key at https://cloud.cerebras.ai → API Keys.

async function callCerebrasJSON<T>(args: { system: string; user: string; maxOutputTokens?: number }): Promise<AiResult<T>> {
  try {
    const res = await fetch('https://api.cerebras.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.CEREBRAS_API_KEY}` },
      body: JSON.stringify({
        model: CEREBRAS_MODEL,
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
      return { ok: false, reason: `Cerebras ${res.status}: ${body.slice(0, 300)}`, rateLimited: isTransient(res.status) }
    }
    type CerebrasResp = {
      choices?: { message?: { content?: string } }[]
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }
    const json = await res.json() as CerebrasResp
    const text = (json.choices?.[0]?.message?.content ?? '').trim()
    if (!text) return { ok: false, reason: 'Cerebras returned empty response' }
    let data: T
    try { data = JSON.parse(text) as T }
    catch { return { ok: false, reason: `Cerebras returned non-JSON: ${text.slice(0, 200)}` } }
    console.log(`[ai] cerebras json tokens=${json.usage?.prompt_tokens ?? '?'}/${json.usage?.completion_tokens ?? '?'}`)
    return {
      ok: true, provider: 'cerebras', model: CEREBRAS_MODEL, data,
      tokens: { input: json.usage?.prompt_tokens, output: json.usage?.completion_tokens },
    }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'Cerebras call failed' }
  }
}

async function callCerebrasText(args: { system: string; user: string; maxOutputTokens?: number }): Promise<AiResult<string>> {
  try {
    const res = await fetch('https://api.cerebras.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.CEREBRAS_API_KEY}` },
      body: JSON.stringify({
        model: CEREBRAS_MODEL,
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
      return { ok: false, reason: `Cerebras ${res.status}: ${body.slice(0, 300)}`, rateLimited: isTransient(res.status) }
    }
    type CerebrasResp = {
      choices?: { message?: { content?: string } }[]
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }
    const json = await res.json() as CerebrasResp
    const text = (json.choices?.[0]?.message?.content ?? '').trim()
    if (!text) return { ok: false, reason: 'Cerebras returned empty response' }
    console.log(`[ai] cerebras text tokens=${json.usage?.prompt_tokens ?? '?'}/${json.usage?.completion_tokens ?? '?'}`)
    return {
      ok: true, provider: 'cerebras', model: CEREBRAS_MODEL, data: text,
      tokens: { input: json.usage?.prompt_tokens, output: json.usage?.completion_tokens },
    }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'Cerebras call failed' }
  }
}
