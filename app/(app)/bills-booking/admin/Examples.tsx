'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { confirm } from '@/components/ui/confirm-dialog'
import { FlaskConical, Loader2, Plus, Trash2 } from 'lucide-react'
import { seedExamples, clearExamples } from '@/app/actions/bills-examples'
import { EXAMPLE_PLANS } from '@/lib/bills-booking/examples'

/** Ten bills to walk the flow on, and the button that takes them away.
 *
 *  Aksha, 14 Sep 2026: "make few 10 Live Examples - simple and complex in the
 *  Admin page which i can check and review and then we decide to remove."
 *
 *  The list below is the plan, not a screenshot: each line says what the
 *  example is for and what to look at when it opens, so reviewing them is a
 *  walk down this page rather than a hunt. */
export function Examples({ existing, live }: { existing: number; live: Array<{ id: string; billNo: string | null; title: string }> }) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  const byId = new Map(live.map(l => [l.billNo ?? '', l]))

  function make() {
    setErr(null)
    start(async () => {
      const r = await seedExamples()
      if (!r.ok) { setErr(r.error ?? 'Could not create the examples.'); return }
      toast.success(`${r.made} example bills created.${r.skipped ? ` ${r.skipped} skipped — not enough live work orders.` : ''}`)
      router.refresh()
    })
  }

  function remove() {
    setErr(null)
    start(async () => {
      const ok = await confirm({
        title: 'Remove the example bills?',
        message: `All ${existing} of them go, with their history. Nothing real is touched — only rows marked as examples.`,
        confirmLabel: 'Remove them',
      })
      if (!ok) return
      const r = await clearExamples()
      if (!r.ok) { setErr(r.error ?? 'Could not remove them.'); return }
      toast.success(`${r.removed} example bills removed.`)
      router.refresh()
    })
  }

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" />
          <div>
            <p className="text-sm font-semibold text-gray-800">Example bills</p>
            <p className="mt-0.5 text-[13px] text-gray-600">
              Ten bills to try the flow on, built from real IN4 work orders so the figures behave like real ones —
              the contractor, the ordered value, what has already been billed. They are badged everywhere
              and <b>left out of every money total</b>, so nothing on any screen counts them as real.
            </p>
          </div>
        </div>

        <div className="shrink-0">
          {existing > 0 ? (
            <Button variant="outline" onClick={remove} disabled={busy}
                    className="border-rose-200 text-rose-700 hover:bg-rose-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Remove all {existing}
            </Button>
          ) : (
            <Button onClick={make} disabled={busy} className="bg-indigo-600 hover:bg-indigo-700">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Create the ten
            </Button>
          )}
        </div>
      </div>

      {err && <p role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</p>}

      <ol className="mt-4 space-y-2">
        {EXAMPLE_PLANS.map(p => {
          const made = byId.get(`EX-${String(p.n).padStart(2, '0')}`)
          return (
            <li key={p.n} className="flex gap-3 rounded-lg border border-gray-100 p-2.5">
              <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-900 text-[11px] font-bold text-white">
                {p.n}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  {made
                    ? <Link href={`/bills-booking/${made.id}`} className="text-[13px] font-semibold text-indigo-700 hover:underline">{p.title}</Link>
                    : <span className="text-[13px] font-semibold text-gray-800">{p.title}</span>}
                  <span className={`rounded px-1.5 py-px text-[10px] font-semibold ${
                    p.complexity === 'simple' ? 'bg-gray-100 text-gray-600' : 'bg-amber-100 text-amber-800'}`}>
                    {p.complexity}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-gray-600">{p.check}</p>
              </div>
            </li>
          )
        })}
      </ol>

      {existing > 0 && (
        <p className="mt-3 text-xs text-gray-500">
          Open them from <Link href="/bills-booking" className="text-blue-600 hover:underline">the section</Link>,
          or find number 4 and number 9 waiting in{' '}
          <Link href="/approvals" className="text-blue-600 hover:underline">My Approvals</Link>.
        </p>
      )}
    </Card>
  )
}
