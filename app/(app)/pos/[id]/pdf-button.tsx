'use client'
import { Button } from '@/components/ui/button'
import { Download } from 'lucide-react'
import { generatePOPdf } from '@/lib/po-pdf'
import type { PurchaseOrder, POLine } from '@/lib/types'

interface Props {
  po: PurchaseOrder
  lines: POLine[]
}

export function PODownloadButton({ po, lines }: Props) {
  return (
    <Button
      onClick={() => generatePOPdf(po, lines)}
      variant="outline"
      size="sm"
    >
      <Download className="h-4 w-4" />
      Download PDF
    </Button>
  )
}
