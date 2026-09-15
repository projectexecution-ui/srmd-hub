-- Material In & Out — let the bucket hold what the cameras actually produce.
--
-- The bucket was created for still photographs only: image/jpeg, image/png,
-- image/webp, capped at 5 MB. Two things now fall outside that.
--
-- VIDEO. The mind map asks for "Security to check the materials before loading
-- & Video Confirmation", and mio_photos has had a 'video' kind since 14 Sep.
-- The bucket would have rejected every one of them — a slot on the screen that
-- could never succeed.
--
-- HEIC. An iPhone shoots HEIC by default. The browser downscales photographs
-- to JPEG before upload, but that depends on createImageBitmap being able to
-- decode the file, and for HEIC it often cannot. The code then falls back to
-- uploading the original untouched, which is right — a photograph that is too
-- big beats no photograph — and the bucket would have thrown it out.
--
-- The size limit goes to 20 MB, which is what the capture screen already caps
-- video at. It is a backstop, not the real control: photographs are downscaled
-- to roughly 200 KB in the browser before they ever get here.

update storage.buckets
set
  file_size_limit = 20971520,          -- 20 MB
  allowed_mime_types = array[
    'image/jpeg', 'image/png', 'image/webp',
    'image/heic', 'image/heif',        -- what an iPhone hands over undecoded
    'video/mp4', 'video/quicktime', 'video/webm'
  ]
where id = 'mio-photos';
