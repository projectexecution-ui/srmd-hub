// Downscale + re-encode an image File in the browser before upload.
// Site phones produce multi-MB photos; this keeps uploads small and fast and
// normalises to JPEG (the `site-reports` bucket only allows jpeg/png).
// Never throws — on any hiccup it returns the original file so an upload is
// never blocked by compression.

export interface CompressOpts {
  /** Longest edge in pixels after downscale. */
  maxDim?: number
  /** JPEG quality 0..1. */
  quality?: number
}

export async function compressImage(file: File, opts: CompressOpts = {}): Promise<File> {
  const maxDim = opts.maxDim ?? 1600
  const quality = opts.quality ?? 0.7

  if (typeof document === 'undefined') return file
  if (!file.type.startsWith('image/')) return file

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return file // e.g. HEIC that the browser can't decode — leave as-is
  }

  try {
    const { width, height } = bitmap
    const scale = Math.min(1, maxDim / Math.max(width, height))
    const w = Math.max(1, Math.round(width * scale))
    const h = Math.max(1, Math.round(height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, w, h)

    const blob = await new Promise<Blob | null>(res =>
      canvas.toBlob(res, 'image/jpeg', quality),
    )
    if (!blob || blob.size >= file.size) return file // don't inflate

    const name = file.name.replace(/\.[^.]+$/, '') + '.jpg'
    return new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified })
  } catch {
    return file
  } finally {
    bitmap.close?.()
  }
}
