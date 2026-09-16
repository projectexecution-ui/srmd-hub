/**
 * Photographs on a material entry.
 *
 * Every one of these is asked for by name in Aksha's mind map:
 *
 *   Security In (both registers)   "Pic of all Docs" — Delivery Challan,
 *                                  Bill/Invoice, E-Way Bill, Etc
 *   Store Keeper In / Vendor 1     "Item Pics" and "Storage Location Pics"
 *   SRM Out                        "Item Pics"
 *   Before loading                 "Security to check the materials before
 *                                  loading & Video Confirmation"
 *   Step 4 Returned Items          "Item Pics"  (returnables are switched off)
 *
 * And the line that prompted all of it, from the SRM Out branch: "Capture
 * where the materials are being stored."
 *
 * Kept pure and separate from the upload so the rules about what is required
 * can be tested without a browser or a bucket.
 */

/** Matches the check constraint on mio_photos.kind. */
export type PhotoKind = 'challan' | 'bill' | 'eway' | 'item' | 'location' | 'video' | 'other'

export interface PhotoSlot {
  kind: PhotoKind
  /** What the person is being asked to photograph, in their words. */
  label: string
  hint: string
  /** Blocking. The mind map asks for it and Aksha asked for it to be enforced. */
  required: boolean
  video?: boolean
}

/** Security's step, both registers — the papers that came with the lorry. */
export const GATE_SLOTS: readonly PhotoSlot[] = [
  {
    kind: 'challan',
    label: 'Photo of the papers',
    hint: 'Challan, bill or e-way bill — one photo of each is fine',
    required: true,
  },
]

/**
 * The storekeeper's step. Two different photographs doing two different jobs:
 * the material itself (what arrived, and what condition it was in) and the
 * place it was put down (so it can be found again, and so "where is it" has an
 * answer that is not somebody's memory).
 *
 * The location shot is dropped for vendor material, which goes straight to
 * site and never enters a store — there is no storage place to photograph.
 */
export function storekeeperSlots(makesStock: boolean): readonly PhotoSlot[] {
  const item: PhotoSlot = {
    kind: 'item',
    label: 'Photo of the material',
    hint: 'What came off the vehicle',
    required: true,
  }
  if (!makesStock) return [item]
  return [
    item,
    {
      kind: 'location',
      label: 'Photo of where you put it',
      hint: 'So the next person can find it',
      required: true,
    },
  ]
}

/** Issuing out. The mind map asks for the material, and for Security's video
 *  check before the vehicle is loaded. */
export const ISSUE_SLOTS: readonly PhotoSlot[] = [
  {
    kind: 'item',
    label: 'Photo of the material going out',
    hint: 'Before it is loaded',
    required: true,
  },
  {
    kind: 'video',
    // Compulsory as of 15 Sep 2026. It was optional only because nobody holds
    // the security role, and Aksha settled that: "Security to check the
    // materials before loading & Video Confirmation here comes (else the store
    // keeper to take a video if security unavailabel)". With a fallback taker
    // there is nobody left for it to be blocked on.
    label: 'Video of the load',
    hint: 'Security takes it before loading — or the storekeeper, if Security is not there',
    required: true,
    video: true,
  },
]

/** Which required slots have nothing in them yet, by label. */
export function missingPhotos(
  slots: readonly PhotoSlot[],
  counts: Readonly<Record<string, number>>,
): string[] {
  return slots.filter(s => s.required && !(counts[s.kind] > 0)).map(s => s.label)
}

/* ── What a phone camera produces, and what a 1 GB bucket can hold ───────── */

/** Longest edge, in pixels, after downscaling. */
export const MAX_EDGE = 1600
/** JPEG quality. 0.72 keeps a challan readable at a quarter of the bytes. */
export const JPEG_QUALITY = 0.72

/**
 * A modern phone takes a 3-5 MB photograph. The bucket is capped at 5 MB a
 * file and the project is on Supabase's free 1 GB, so uploading what the
 * camera produces would fill it in roughly 250 deliveries.
 *
 * Downscaled to 1600px at 0.72 that is nearer 200 KB, which is about 5,000
 * photographs — and a challan is still readable, which is the only thing the
 * photograph is for.
 */
export function photoPath(entryId: string, kind: PhotoKind, name: string): string {
  // The camera's filename is worth keeping only as a hint — the entry, the
  // kind and the timestamp are what identify a photograph. So the name is
  // reduced to letters and digits and the extension is taken from a list,
  // rather than sanitised: "../../etc/passwd" should not survive in ANY form,
  // and a dot that means nothing here is a dot that can mean something to
  // whatever reads the key next.
  const ext = (/\.([a-z0-9]{2,5})$/i.exec(name)?.[1] ?? 'jpg').toLowerCase()
  const safeExt = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'mp4', 'mov', 'webm'].includes(ext) ? ext : 'jpg'
  const stem = name.replace(/\.[^.]*$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(-32) || 'photo'
  return `entries/${entryId}/${kind}/${Date.now()}-${stem}.${safeExt}`
}

/**
 * Signing for material at the far end.
 *
 * The map's last two lines of SRM Out: "SRM Engg receives the materails &
 * checks & Signs" and "Capture where the materials are being stored". Aksha,
 * 16 Sep 2026, asking for the section: "the Site head recieving cycle (his pic
 * and confirmation and place where he kept)".
 *
 * One photograph, and it is the SAME question the storekeeper answers at the
 * other end — where did you put it. That is what makes "where is it" have an
 * answer at both ends of the journey rather than only at the store.
 */
export const RECEIPT_SLOTS: readonly PhotoSlot[] = [
  {
    kind: 'location',
    label: 'Photo of where you put it',
    hint: 'At the site — so the next person can find it',
    required: true,
  },
]
