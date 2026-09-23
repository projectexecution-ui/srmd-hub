'use client'
// The one action row at the top of a Working Sheet (Aksha, 23 Sep 2026).
//
// What THIS person does here sits outside: Download Excel for everyone;
// the owning engineer also gets Archive (when granted) — the return-and-fix
// step itself (Upload revised Excel) lives under the sheet, where it always
// was. Everything else — the source viewer, Internal Estimate, passbook,
// Start fresh chain — folds under one "More" menu. Eight buttons in five
// places became two and a menu.

import { useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Download, ChevronDown, GitBranch, Loader2 } from 'lucide-react'
import { confirm } from '@/components/ui/confirm-dialog'
import { setBreakChain } from './version-actions'

export interface MenuLink { label: string; href: string; external?: boolean }

export function HeaderActions({
  wsId, hasExcel, links, freshChain, children,
}: {
  wsId: string
  hasExcel: boolean
  /** Links for the More menu, in order. Empty = no menu. */
  links: MenuLink[]
  /** Owner/admin only: the Start fresh chain / Re-join chain toggle. */
  freshChain?: { breakChain: boolean } | null
  /** Extra buttons that belong OUTSIDE (Archive for the owner, etc.). */
  children?: React.ReactNode
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [err, setErr] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  async function toggleChain() {
    if (!freshChain) return
    const turningOn = !freshChain.breakChain
    const ok = await confirm({
      title: turningOn ? 'Start a new version chain?' : 'Re-join the previous chain?',
      message: turningOn
        ? 'Mark THIS Working Sheet as the first version of a fresh chain. Older sheets in the same sub-category stop being version-mates of this one. Nothing is deleted.'
        : 'Re-join this sheet to the chain it naturally belongs to (same sub-category and line type).',
      confirmLabel: turningOn ? 'Start fresh chain' : 'Re-join chain',
      danger: false,
    })
    if (!ok) return
    setErr(null); setOpen(false)
    startTransition(async () => {
      const res = await setBreakChain(wsId, turningOn)
      if (!res.ok) { setErr(res.error); return }
      router.refresh()
    })
  }

  const hasMenu = links.length > 0 || !!freshChain

  return (
    <div className="flex flex-wrap items-center gap-2">
      {hasExcel && (
        <a
          href={`/api/cost-control/working-sheets/${wsId}/download`}
          className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-[13px] font-semibold text-gray-800 hover:bg-gray-50"
        >
          <Download className="h-4 w-4" /> Download Excel
        </a>
      )}
      {children}
      {hasMenu && (
        <div className="relative" ref={ref}>
          <button
            type="button" onClick={() => setOpen(o => !o)} aria-haspopup="menu" aria-expanded={open}
            className="inline-flex min-h-[38px] items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 text-[13px] font-semibold text-gray-800 hover:bg-gray-50"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            More <ChevronDown className="h-4 w-4" />
          </button>
          {open && (
            <ul role="menu" className="absolute right-0 z-20 mt-1 min-w-[240px] rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg">
              {links.map(l => (
                <li key={l.href} role="none">
                  {l.external
                    ? <a role="menuitem" href={l.href} target="_blank" rel="noreferrer" className="block rounded-lg px-3 py-2 text-[13px] text-gray-800 hover:bg-gray-50" onClick={() => setOpen(false)}>{l.label}</a>
                    : <Link role="menuitem" href={l.href} className="block rounded-lg px-3 py-2 text-[13px] text-gray-800 hover:bg-gray-50" onClick={() => setOpen(false)}>{l.label}</Link>}
                </li>
              ))}
              {freshChain && (
                <li role="none" className={links.length ? 'mt-1 border-t border-gray-100 pt-1' : ''}>
                  <button role="menuitem" type="button" onClick={toggleChain} disabled={pending}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] text-gray-800 hover:bg-gray-50 disabled:opacity-50">
                    <GitBranch className="h-3.5 w-3.5 text-gray-500" />
                    {freshChain.breakChain ? 'Re-join previous chain' : 'Start fresh chain'}
                  </button>
                </li>
              )}
            </ul>
          )}
        </div>
      )}
      {err && <span className="text-[11px] text-rose-700">{err}</span>}
    </div>
  )
}
