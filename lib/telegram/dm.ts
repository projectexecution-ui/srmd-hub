// Direct Telegram DM image push, for reports that render their own PNG cards and
// deliver them themselves (bypassing notify_user, whose queue can't carry
// images) — e.g. the daily bills digest, which emails inline PNGs. Sends the
// same cards to a connected recipient's personal Telegram chat: one photo, or a
// media-group album for several (chunked to Telegram's 10-per-group limit).

interface Card { code: string; b64: string }

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

/**
 * Push rendered PNG cards (base64) to one Telegram chat. Best-effort — returns a
 * result the caller can log, never throws. `caption` rides the first photo only.
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
  try {
    // Single card → a plain photo with the caption.
    if (cards.length === 1) {
      const form = new FormData()
      form.append('chat_id', chatId)
      form.append('caption', caption.slice(0, 1000))
      form.append('photo', new Blob([Buffer.from(cards[0].b64, 'base64')], { type: 'image/png' }), `${cards[0].code}.png`)
      const r = await fetch(api('sendPhoto'), { method: 'POST', body: form })
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; description?: string }
      return j.ok ? { ok: true, photos: 1 } : { ok: false, error: j.description || 'sendPhoto failed' }
    }
    // Several cards → album(s) of up to 10, caption on the very first photo.
    let sent = 0; let firstChunk = true
    for (const group of chunk(cards, 10)) {
      const form = new FormData()
      form.append('chat_id', chatId)
      const media = group.map((c, i) => ({
        type: 'photo', media: `attach://f${i}`,
        ...(firstChunk && i === 0 ? { caption: caption.slice(0, 1000) } : {}),
      }))
      form.append('media', JSON.stringify(media))
      group.forEach((c, i) => form.append(`f${i}`, new Blob([Buffer.from(c.b64, 'base64')], { type: 'image/png' }), `${c.code}.png`))
      const r = await fetch(api('sendMediaGroup'), { method: 'POST', body: form })
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; description?: string }
      if (!j.ok) return { ok: false, error: j.description || 'sendMediaGroup failed' }
      sent += group.length; firstChunk = false
    }
    return { ok: true, photos: sent }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'dm-send-failed' }
  }
}
