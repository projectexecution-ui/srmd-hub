'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2, Check } from 'lucide-react'

export function SettingsForm({
  settingKey, initialValue, placeholder, type = 'text',
}: {
  settingKey: string; initialValue: string; placeholder?: string; type?: string
}) {
  const [value, setValue] = useState(initialValue)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setSaving(true); setError(null); setSaved(false)
    const supabase = createClient()
    const { error } = await supabase
      .from('app_settings')
      .upsert({ key: settingKey, value }, { onConflict: 'key' })
    setSaving(false)
    if (error) setError(error.message)
    else {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Input type={type} value={value} onChange={e => setValue(e.target.value)} placeholder={placeholder} />
        <Button onClick={save} disabled={saving || !value}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Save
        </Button>
        {saved && <span className="inline-flex items-center gap-1 text-xs text-green-700"><Check className="h-3.5 w-3.5" /> Saved</span>}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
