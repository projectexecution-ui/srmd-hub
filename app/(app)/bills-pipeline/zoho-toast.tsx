'use client'

import { useEffect } from 'react'
import { toast } from 'sonner'

interface Props {
  zoho?:   string
  reason?: string
}

export default function ZohoToast({ zoho, reason }: Props) {
  useEffect(() => {
    if (zoho === 'connected') {
      toast.success('Zoho connected — refresh the card to fetch live data')
    } else if (zoho === 'error') {
      toast.error(`Zoho connection failed: ${reason ?? 'unknown error'}`)
    }
    // Only fires on mount (once per navigation to this page)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}
