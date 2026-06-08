'use server'
// Server action for AI-normalising item categories during bulk import.
//
// The Odoo product.template export is full of casual / typo'd categories:
//   "Finishis/Hardware", "Electric / Electric accessories",
//   "Plumbing / fittings"  — plus a lot of nulls.
//
// We send {code, name, currentCategory} for every row in a chunk and ask
// the model to produce a clean, consistent category per item. Same wrapper
// (lib/ai) and same Gemini→Groq fallback that Cost Control uses, so no new
// keys or providers to set up.

import { generateJSON } from '@/lib/ai'
import { requirePermission, requireInventorySection } from '@/lib/auth'

export interface CategorySuggestionIn {
  code: string
  name: string
  currentCategory: string | null
}
export interface CategorySuggestionOut {
  code: string
  suggested: string
}

interface BatchResult {
  ok: boolean
  reason?: string
  provider?: 'gemini' | 'groq' | 'cerebras'
  model?: string
  suggestions: CategorySuggestionOut[]
}

// How many items to send in one model call. Gemini Flash Lite handles 80-100
// rows comfortably without truncation; smaller batches just mean more
// round-trips. 80 is a balance between speed and prompt-size safety.
const BATCH_SIZE = 80

const SYSTEM = `You normalise inventory item categories for a construction company.

INPUT: JSON array of items, each with { code, name, currentCategory }.

OUTPUT: JSON object with one field "items" — an array of { code, suggested }.
You MUST return one entry per input item, in the same order, with the same code.

RULES:
1. "suggested" must be 1-3 words, Title Case, no slashes or trailing punctuation.
2. Fix typos in currentCategory ("Finishis" → "Finishes", "fittings" → "Fittings").
3. Merge near-duplicates into one consistent label:
   - "Electric / Electric accessories" → "Electrical"
   - "Plumbing / fittings" → "Plumbing"
   - "Finishis/Hardware" → "Finishes & Hardware"
4. When currentCategory is null/empty, infer from the item name. Examples:
   - "OPC 53 Grade Cement" → "Cement"
   - "12mm TMT Bar" → "Steel"
   - "16A MCB" or "3-Pin Top Plug" → "Electrical"
   - "CPVC Tee" or "PVC Cupler" → "Plumbing"
   - "Door Closer" or "Hinge" → "Hardware"
   - "Switch Plate" or "Wall Tile" → "Finishes"
5. If you genuinely can't tell from name + currentCategory, use "Misc".
6. Keep the taxonomy SMALL — aim for under 15 distinct categories across
   the whole batch. Prefer reusing a category you've already chosen
   earlier in the same batch over inventing a new one.

Return ONLY the JSON object. No prose.`

interface AiBatchOut { items: CategorySuggestionOut[] }

async function processBatch(items: CategorySuggestionIn[]): Promise<BatchResult> {
  if (items.length === 0) return { ok: true, suggestions: [] }

  const user = JSON.stringify(items.map(i => ({
    code: i.code,
    name: i.name,
    currentCategory: i.currentCategory ?? null,
  })))

  const res = await generateJSON<AiBatchOut>({
    system: SYSTEM,
    user,
    maxOutputTokens: Math.min(8000, items.length * 50),
  })

  if (!res.ok) {
    return { ok: false, reason: res.reason, suggestions: [] }
  }

  // Defensive: model might return slightly different shape — coerce.
  const arr = Array.isArray(res.data?.items) ? res.data.items : []
  const suggestions: CategorySuggestionOut[] = arr
    .map((it): CategorySuggestionOut | null => {
      const code = typeof it?.code === 'string' ? it.code : ''
      const suggested = typeof it?.suggested === 'string' ? it.suggested.trim() : ''
      if (!code || !suggested) return null
      return { code, suggested }
    })
    .filter((x): x is CategorySuggestionOut => x !== null)

  return {
    ok: true,
    provider: res.provider,
    model: res.model,
    suggestions,
  }
}

export interface SuggestCategoriesResult {
  ok: boolean
  reason?: string
  provider?: 'gemini' | 'groq' | 'cerebras'
  model?: string
  /** Total items the model returned a suggestion for. */
  count: number
  /** Map code → suggested category. Codes that weren't returned are missing. */
  byCode: Record<string, string>
}

/**
 * Server action invoked by the import preview. Chunks items into batches and
 * accumulates all suggestions into a single byCode map for the client to
 * apply.
 */
export async function suggestCategories(
  items: CategorySuggestionIn[]
): Promise<SuggestCategoriesResult> {
  // Same gates the page uses — anyone calling this must be an inventory admin.
  await requirePermission('inventory', 'admin', '/inventory')
  await requireInventorySection('inv-admin-items')

  if (items.length === 0) {
    return { ok: true, count: 0, byCode: {} }
  }

  const byCode: Record<string, string> = {}
  let provider: 'gemini' | 'groq' | 'cerebras' | undefined
  let model: string | undefined

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const chunk = items.slice(i, i + BATCH_SIZE)
    const res = await processBatch(chunk)
    if (!res.ok) {
      // Surface partial results so the user can still benefit from what
      // succeeded before the failure (e.g. quota hit on batch 5 of 7).
      return {
        ok: false,
        reason: res.reason ?? 'AI request failed',
        provider, model,
        count: Object.keys(byCode).length,
        byCode,
      }
    }
    provider = res.provider ?? provider
    model = res.model ?? model
    for (const s of res.suggestions) {
      byCode[s.code] = s.suggested
    }
  }

  return {
    ok: true,
    provider, model,
    count: Object.keys(byCode).length,
    byCode,
  }
}
