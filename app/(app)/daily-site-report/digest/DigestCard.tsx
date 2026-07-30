'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Copy, Download, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

export function DigestCard({ defaultDate }: { defaultDate: string }) {
  const [date, setDate] = useState(defaultDate)
  const [loading, setLoading] = useState(false)
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const blobRef = useRef<Blob | null>(null)
  const urlRef = useRef<string | null>(null)

  const load = useCallback(async (d: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/daily-site-report/digest?date=${d}`, { cache: 'no-store' })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.reason || `HTTP ${res.status}`)
      }
      const b = await res.blob()
      blobRef.current = b
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
      const objUrl = URL.createObjectURL(b)
      urlRef.current = objUrl
      setUrl(objUrl)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to build card')
      setUrl(null)
      blobRef.current = null
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load(defaultDate)
    return () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function copyImage() {
    const b = blobRef.current
    if (!b) return
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })])
      toast.success('Card copied — paste it into the WhatsApp group')
    } catch {
      toast.error('Copy isn’t supported here — use Download instead')
    }
  }

  function download() {
    if (!urlRef.current) return
    const a = document.createElement('a')
    a.href = urlRef.current
    a.download = `site-report-${date}.png`
    a.click()
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label>Date</Label>
          <Input type="date" value={date} max={defaultDate} onChange={e => setDate(e.target.value || defaultDate)} className="mt-1" />
        </div>
        <Button variant="outline" onClick={() => load(date)} disabled={loading}>
          {loading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
          Generate
        </Button>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={copyImage} disabled={loading || !url}>
            <Copy className="mr-1.5 h-4 w-4" /> Copy image
          </Button>
          <Button variant="outline" onClick={download} disabled={loading || !url}>
            <Download className="mr-1.5 h-4 w-4" /> Download
          </Button>
        </div>
      </div>

      <Card className="p-3">
        {loading ? (
          <div className="flex h-64 items-center justify-center text-gray-400">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : error ? (
          <p className="py-12 text-center text-sm text-red-600">{error}</p>
        ) : url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="Daily site report card" className="mx-auto w-full max-w-full rounded" />
        ) : (
          <p className="py-12 text-center text-sm text-gray-400">No card yet.</p>
        )}
      </Card>
    </div>
  )
}
