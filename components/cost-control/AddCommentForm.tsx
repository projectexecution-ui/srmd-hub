'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Loader2, MessageSquarePlus, AtSign } from 'lucide-react'
import { MentionTextarea } from '@/components/mentions/MentionTextarea'
import { addWsComment } from './comment-actions'

export function AddCommentForm({ wsId }: { wsId: string }) {
  const router = useRouter()
  const [body, setBody] = useState('')
  const [mentionIds, setMentionIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function post() {
    if (body.trim().length < 1) { setErr('Write something first'); return }
    setBusy(true); setErr(null)
    const r = await addWsComment(wsId, body, mentionIds)
    setBusy(false)
    if (!r.ok) { setErr(r.error ?? 'Could not post the comment'); return }
    setBody(''); setMentionIds([])
    router.refresh()
  }

  return (
    <div className="space-y-2">
      <MentionTextarea
        value={body}
        onChange={(v, ids) => { setBody(v); setMentionIds(ids) }}
        rows={2}
        maxLength={2000}
        placeholder="Write a comment — type @ to tag someone"
      />
      {err && <p className="text-xs text-rose-600">{err}</p>}
      <div className="flex items-center justify-between gap-2">
        {mentionIds.length > 0 ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-700">
            <AtSign className="h-3 w-3" /> {mentionIds.length} {mentionIds.length === 1 ? 'person' : 'people'} will be notified
          </span>
        ) : <span className="text-[11px] text-gray-400">Type <b>@</b> to tag &amp; notify someone</span>}
        <Button size="sm" onClick={post} disabled={busy || body.trim().length < 1}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquarePlus className="h-4 w-4" />}
          Post comment
        </Button>
      </div>
    </div>
  )
}
