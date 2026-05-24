'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Send, Loader2, MessageCircle } from 'lucide-react'

export function SendReportButton() {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function send() {
    setBusy(true); setMsg(null)
    try {
      const res = await fetch('/api/jmr/weekly-report?send=true', { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed')
      if (json.sentTo?.length) setMsg(`Emailed to ${json.sentTo.length} recipient(s)`)
      else if (json.pdfUrl) {
        setMsg('PDF generated — opening…')
        window.open(json.pdfUrl, '_blank')
      } else setMsg(json.note || 'Generated')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Failed')
    }
    setBusy(false)
  }

  async function whatsapp() {
    setBusy(true); setMsg(null)
    try {
      // Generate (don't send via email) — just download the PDF locally.
      const res = await fetch('/api/jmr/weekly-report', { method: 'POST' })
      if (!res.ok) throw new Error('PDF generation failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `CT_HUB_JMR_Weekly_${new Date().toISOString().slice(0, 10)}.pdf`
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)
      const text = encodeURIComponent('CT HUB JMR — weekly snapshot attached.')
      window.open(`https://wa.me/?text=${text}`, '_blank')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Failed')
    }
    setBusy(false)
  }

  return (
    <div className="flex items-center gap-2">
      {msg && <span className="text-xs text-gray-600">{msg}</span>}
      <Button size="sm" variant="outline" onClick={whatsapp} disabled={busy} title="Download PDF + open WhatsApp">
        <MessageCircle className="h-4 w-4" /> WhatsApp
      </Button>
      <Button size="sm" variant="outline" onClick={send} disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        Send weekly report
      </Button>
    </div>
  )
}
