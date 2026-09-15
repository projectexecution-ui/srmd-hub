'use client'

import { useEffect, useRef, useState } from 'react'
import { Camera, X, Video, AlertTriangle } from 'lucide-react'
import { MAX_EDGE, JPEG_QUALITY, type PhotoSlot } from '@/lib/stores/photos'

export interface Shot {
  kind: PhotoSlot['kind']
  file: File
  /** Object URL for the thumbnail. Revoked when the shot is dropped. */
  preview: string
}

/**
 * Taking the photographs the mind map asks for.
 *
 * `capture="environment"` opens the BACK camera straight away on a phone
 * rather than a file browser — the guard is standing in front of the lorry,
 * not looking for a file. On a laptop the same input is an ordinary file
 * picker, which is what Aksha needs when he is checking an entry at a desk.
 *
 * Photographs are downscaled in the browser BEFORE they are held, not on the
 * way out: a phone produces 3-5 MB and the bucket allows 5 MB a file on a free
 * 1 GB project. At 1600px/0.72 a challan is still readable at about 200 KB,
 * which is the difference between roughly 250 deliveries of headroom and
 * 5,000. Video is left alone — re-encoding it in a browser is not worth it —
 * and is capped instead.
 *
 * Nothing uploads here. The files are held and handed back, because at the
 * gate the entry does not exist yet: it is created on save and only then is
 * there an id to file the photographs under.
 */
export function PhotoCapture({
  slot, shots, onChange, disabled,
}: {
  slot: PhotoSlot
  shots: readonly Shot[]
  onChange: (next: Shot[]) => void
  disabled?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [tooBig, setTooBig] = useState<string | null>(null)
  const mine = shots.filter(s => s.kind === slot.kind)

  // Object URLs are a leak if nobody frees them, and a gate phone stays on
  // this screen all day.
  useEffect(() => () => { shots.forEach(s => URL.revokeObjectURL(s.preview)) }, [shots])

  const add = async (files: FileList | null) => {
    if (!files?.length) return
    setBusy(true); setTooBig(null)
    const next: Shot[] = [...shots]
    for (const f of Array.from(files)) {
      if (slot.video) {
        // 20 MB of video is about a minute on a phone, which is far more than
        // "a short video of the load" needs.
        if (f.size > 20 * 1024 * 1024) { setTooBig(f.name); continue }
        next.push({ kind: slot.kind, file: f, preview: URL.createObjectURL(f) })
      } else {
        const shrunk = await downscale(f)
        next.push({ kind: slot.kind, file: shrunk, preview: URL.createObjectURL(shrunk) })
      }
    }
    onChange(next)
    setBusy(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  const drop = (preview: string) => {
    URL.revokeObjectURL(preview)
    onChange(shots.filter(s => s.preview !== preview))
  }

  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500">
          {slot.label}
        </span>
        {slot.required && (
          <span className="text-[11px] font-bold uppercase tracking-wider text-rose-600">Needed</span>
        )}
      </div>
      <p className="text-[12.5px] text-gray-500 -mt-1">{slot.hint}</p>

      {mine.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {mine.map(s => (
            <li key={s.preview} className="relative">
              {slot.video ? (
                <video src={s.preview} className="h-20 w-20 rounded-xl object-cover border-2 border-gray-200" muted />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={s.preview} alt="" className="h-20 w-20 rounded-xl object-cover border-2 border-gray-200" />
              )}
              <button
                type="button" onClick={() => drop(s.preview)} aria-label="Remove this photo"
                className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full bg-gray-900 text-white shadow"
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={slot.video ? 'video/*' : 'image/*'}
        capture="environment"
        multiple={!slot.video}
        disabled={disabled || busy}
        onChange={e => void add(e.target.files)}
        className="sr-only"
        id={`cap-${slot.kind}`}
      />
      <label
        htmlFor={`cap-${slot.kind}`}
        className={`inline-flex items-center gap-2.5 rounded-xl border-2 px-4 min-h-[52px] text-[15px] font-semibold cursor-pointer
          ${mine.length > 0
            ? 'border-gray-300 bg-white text-gray-700 active:bg-gray-50'
            : slot.required
              ? 'border-rose-300 bg-rose-50 text-rose-800 active:bg-rose-100'
              : 'border-gray-300 bg-white text-gray-700 active:bg-gray-50'}
          ${disabled || busy ? 'pointer-events-none opacity-50' : ''}`}
      >
        {slot.video ? <Video className="h-5 w-5" /> : <Camera className="h-5 w-5" />}
        {busy ? 'Working…' : mine.length > 0 ? 'Add another' : slot.video ? 'Record' : 'Take photo'}
      </label>

      {tooBig && (
        <p className="flex items-start gap-1.5 text-[12.5px] text-rose-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {tooBig} is too long — keep the video under 20 MB, about a minute.
        </p>
      )}
    </div>
  )
}

/** Longest edge to MAX_EDGE, re-encoded as JPEG. Returns the original
 *  untouched if anything about the decode fails — a photograph that is too big
 *  is far better than no photograph. */
async function downscale(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    if (scale === 1 && file.size < 400_000) { bitmap.close(); return file }

    const w = Math.round(bitmap.width * scale)
    const h = Math.round(bitmap.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) { bitmap.close(); return file }
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close()

    const blob = await new Promise<Blob | null>(res =>
      canvas.toBlob(res, 'image/jpeg', JPEG_QUALITY))
    if (!blob || blob.size >= file.size) return file
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' })
  } catch {
    return file
  }
}
