'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Loader2, Check } from 'lucide-react'

export function IndentNotesForm({
  indentId, initialNotes, canEdit,
}: {
  indentId: string
  initialNotes: string
  canEdit: boolean
}) {
  const [notes, setNotes] = useState(initialNotes)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!canEdit) {
    return notes
      ? <p className="text-sm text-gray-700 whitespace-pre-wrap">{notes}</p>
      : <p className="text-sm text-gray-400 italic">No notes — only admin/uploader can edit.</p>
  }

  async function save() {
    setSaving(true)
    setError(null)
    setSaved(false)
    const supabase = createClient()
    const { error } = await supabase.from('indents').update({ notes }).eq('id', indentId)
    setSaving(false)
    if (error) {
      setError(error.message)
    } else {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    }
  }

  return (
    <div className="space-y-2">
      <Textarea
        value={notes}
        onChange={e => setNotes(e.target.value)}
        placeholder="Add internal notes for this indent — visible to admin & uploader only."
        rows={4}
      />
      {error && (
        <p className="text-xs text-red-600">{error}</p>
      )}
      <div className="flex items-center gap-2">
        <Button onClick={save} disabled={saving || notes === ''} size="sm">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Save notes
        </Button>
        {saved && (
          <span className="inline-flex items-center gap-1 text-xs text-green-700">
            <Check className="h-3.5 w-3.5" /> Saved
          </span>
        )}
      </div>
    </div>
  )
}
