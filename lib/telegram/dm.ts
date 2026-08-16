// Direct Telegram DM image push, for reports that render their own PNG cards and
// deliver them themselves (bypassing notify_user, whose queue can't carry
// images) — e.g. the daily bills digest, which emails inline PNGs. Sends the
// same cards to a connected recipient's personal Telegram chat.
//
// Each card is sent as its OWN sendPhoto (the proven-reliable primitive the
// /api/telegram/send route uses), NOT a sendMediaGroup album — albums were
// failing silently with no fallback, so connected heads got the email but no
// Telegram. If a photo is rejected (e.g. an oversized render), we retry the
// same bytes as a sendDocument, which has no photo dimension/processing limits.

interface Card { code: string; b64: string }

/**
 * Push rendered PNG cards (base64) to one Telegram chat. Best-effort — returns a
 * result the caller can log, never throws. `caption` rides the first card only.
 */
export async function sendCardsToChat(
  token: string,
  chatId: string,
  cards: Card[],
  caption: string,
): Promise<{ ok: true; photos: number } | { skipped: string } | { ok: false; error: string }> {
  if (!token) return { skipped: 'no-token' }
  if (!chatId) return { skipped: 'no-chat' }
  if (cards.length === 0) return { skipped: 'empty' }
  const api = (m: string) => `https://api.telegram.org/bot${token}/${m}`

  // Send one card: try as a photo (inline preview); on failure retry the same
  // bytes as a document (bypasses Telegram's photo dimension/processing limits).
  async function sendOne(card: Card, cap: string): Promise<{ ok: true } | { ok: false; error: string }> {
    // Match the working /api/telegram/send blob construction: a fresh Uint8Array,
    // not a raw Node Buffer (undici can mishandle Buffer-backed Blobs).
    const bytes = new Uint8Array(Buffer.from(card.b64, 'base64'))
    const filename = `${card.code || 'card'}.png`
    try {
      const photo = new FormData()
      photo.append('chat_id', chatId)
      if (cap) photo.append('caption', cap.slice(0, 1000))
      photo.append('photo', new Blob([bytes], { type: 'image/png' }), filename)
      const pr = await fetch(api('sendPhoto'), { method: 'POST', body: photo })
      const pj = (await pr.json().catch(() => ({}))) as { ok?: boolean; description?: string }
      if (pj.ok) return { ok: true }

      // Photo rejected — retry as a document (still shows a preview in Telegram).
      const doc = new FormData()
      doc.append('chat_id', chatId)
      if (cap) doc.append('caption', cap.slice(0, 1000))
      doc.append('document', new Blob([bytes], { type: 'image/png' }), filename)
      const dr = await fetch(api('sendDocument'), { method: 'POST', body: doc })
      const dj = (await dr.json().catch(() => ({}))) as { ok?: boolean; description?: string }
      if (dj.ok) return { ok: true }
      return { ok: false, error: dj.description || pj.description || 'sendPhoto/sendDocument failed' }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'dm-send-failed' }
    }
  }

  let sent = 0
  let lastErr = ''
  for (let i = 0; i < cards.length; i++) {
    const res = await sendOne(cards[i], i === 0 ? caption : '')
    if (res.ok) sent++
    else lastErr = res.error
  }
  if (sent === 0) return { ok: false, error: lastErr || 'all sends failed' }
  return { ok: true, photos: sent }
}
