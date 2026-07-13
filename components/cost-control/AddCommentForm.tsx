'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Loader2, MessageSquarePlus } from 'lucide-react'
import { addWsComment } from './comment-actions'

export function AddCommentForm({ wsId }: { wsId: string }) {
  const router = useRouter()
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function post() {
    if (body.trim().length < 1) { setErr('Write something first'); return }
    setBusy(true); setErr(null)
    const r = await addWsComment(wsId, body)
    setBusy(false)
    if (!r.ok) { setErr(r.error ?? 'Could not post the comment'); return }
    setBody('')
    router.refresh()
  }

  return (
    <div className="space-y-2">
      <textarea
        value={body}
        onChange={e => setBody(e.target.value)}
        rows={2}
        maxLength={2000}
        className="w-full rounded-md border border-gray-200 bg-white p-2 text-sm"
        placeholder="Write a comment — everyone on this sheet can read it"
      />
      {err && <p className="text-xs text-rose-600">{err}</p>}
      <div className="flex justify-end">
        <Button size="sm" onClick={post} disabled={busy || body.trim().length < 1}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquarePlus className="h-4 w-4" />}
          Post comment
        </Button>
      </div>
    </div>
  )
}
