import { ReactNode } from 'react'
import { JmrPWAInit } from '@/components/JmrPWAInit'

export default function JmrLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <JmrPWAInit />
      {children}
    </>
  )
}
