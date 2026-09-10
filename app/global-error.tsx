'use client'

/**
 * The LAST error boundary — and until now the hub had none.
 *
 * `app/(app)/error.tsx` covers the pages inside the app, but by Next's own
 * rule an `error.tsx` never catches a failure in the `layout.tsx` of its own
 * segment. So anything that broke in `app/(app)/layout.tsx` or in the root
 * layout fell through to Next's built-in screen: a dark page reading "This
 * page couldn't load", with no message, no digest and nothing to report.
 *
 * That is exactly what a real failure looked like on 6 September 2026, and it
 * left nobody — including whoever has to fix it — any way to tell WHAT broke.
 * A `global-error.tsx` is the only thing that catches those, so this file
 * exists to make the worst case legible.
 *
 * It must render its own <html> and <body>: when this shows, the root layout
 * is the thing that failed, so nothing above it can be relied on. Everything
 * here is inline-styled for the same reason — the stylesheet may be the
 * casualty.
 */
export default function GlobalError({
  error, reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en">
      <body style={{
        margin: 0, minHeight: '100vh', display: 'grid', placeItems: 'center',
        padding: 24, background: '#F8FAFC', color: '#0F172A',
        font: '14px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif',
      }}>
        <div style={{ maxWidth: 620, width: '100%' }}>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 700, letterSpacing: '.06em', color: '#B91C1C' }}>
            CT HUB
          </p>
          <h1 style={{ margin: '6px 0 0', fontSize: 22, fontWeight: 600 }}>
            This screen hit an error and stopped
          </h1>
          <p style={{ margin: '8px 0 0', color: '#475569' }}>
            Nothing you did caused this and nothing was saved or changed. Reloading often
            works. If it does not, send the detail below — it is what identifies the fault.
          </p>

          <div style={{
            marginTop: 16, padding: '12px 14px', borderRadius: 10,
            border: '1px solid #FECACA', background: '#FEF2F2',
          }}>
            <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: '#7F1D1D' }}>
              What went wrong
            </p>
            <p style={{
              margin: '4px 0 0', fontSize: 12.5, color: '#7F1D1D',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', wordBreak: 'break-word',
            }}>
              {error?.message || 'No message was attached to the error.'}
            </p>
            {error?.digest && (
              <p style={{ margin: '8px 0 0', fontSize: 11.5, color: '#9A3412' }}>
                Reference: <b>{error.digest}</b>
              </p>
            )}
          </div>

          <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              onClick={() => reset()}
              style={{
                minHeight: 44, padding: '0 18px', borderRadius: 8, cursor: 'pointer',
                border: 0, background: '#4F46E5', color: '#fff', fontSize: 14, fontWeight: 600,
              }}
            >
              Try again
            </button>
            <a
              href="/dashboard"
              style={{
                minHeight: 44, padding: '0 18px', borderRadius: 8, display: 'inline-flex',
                alignItems: 'center', border: '1px solid #CBD5E1', background: '#fff',
                color: '#0F172A', fontSize: 14, fontWeight: 500, textDecoration: 'none',
              }}
            >
              Back to dashboard
            </a>
          </div>
        </div>
      </body>
    </html>
  )
}
