/**
 * Event photos: upload checks and storage keys (pure, tested in tests/photos.test.ts).
 * Photos are resized to WebP in the browser (PhotoUploader), so the Worker only
 * checks and stores them: no image processing on the free plan's CPU budget.
 */

export const PHOTO_FULL_SIDE = 1600;
export const PHOTO_THUMB_SIDE = 480;
export const PHOTO_FULL_MAX_BYTES = 2 * 1024 * 1024;
export const PHOTO_THUMB_MAX_BYTES = 300 * 1024;
export const PHOTO_TYPES = ["image/webp", "image/jpeg"] as const;
/** Homepage gallery shows at most this many featured photos. */
export const HOME_GALLERY_MAX = 24;

export type PhotoSize = "full" | "thumb";

export function photoKey(id: string, size: PhotoSize) {
  return `photos/${id}${size === "thumb" ? "-t" : ""}.webp`;
}

export function photoUrl(id: string, size: PhotoSize) {
  return `/${photoKey(id, size)}`;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const FILE_RE = new RegExp(`^(${UUID})(-t)?\\.webp$`);

/** Parses the public file name (e.g. "<uuid>-t.webp"). Anything else is rejected, so only photos/ keys are reachable. */
export function parsePhotoFile(file: string | undefined): { id: string; size: PhotoSize } | null {
  const m = file?.match(FILE_RE);
  return m ? { id: m[1], size: m[2] ? "thumb" : "full" } : null;
}

export type PhotoUploadError = "photoMissing" | "photoType" | "photoSize";

export type CheckedUpload = { full: File; thumb: File; width: number; height: number; caption: string | null };

export function checkPhotoUpload(form: {
  photo: unknown;
  thumb: unknown;
  width: unknown;
  height: unknown;
  caption?: unknown;
}): { ok: true; value: CheckedUpload } | { ok: false; error: PhotoUploadError } {
  const { photo, thumb } = form;
  if (!(photo instanceof File) || photo.size === 0 || !(thumb instanceof File) || thumb.size === 0) {
    return { ok: false, error: "photoMissing" };
  }
  const types = PHOTO_TYPES as readonly string[];
  if (!types.includes(photo.type) || !types.includes(thumb.type)) return { ok: false, error: "photoType" };
  if (photo.size > PHOTO_FULL_MAX_BYTES || thumb.size > PHOTO_THUMB_MAX_BYTES) return { ok: false, error: "photoSize" };
  const width = Number(form.width);
  const height = Number(form.height);
  const okSide = (n: number) => Number.isInteger(n) && n > 0 && n <= PHOTO_FULL_SIDE;
  if (!okSide(width) || !okSide(height)) return { ok: false, error: "photoType" };
  const caption = typeof form.caption === "string" ? form.caption.trim().slice(0, 140) || null : null;
  return { ok: true, value: { full: photo, thumb, width, height, caption } };
}

/** Seconds for one loop of the homepage marquee: about 4 s per photo, never too fast. */
export function marqueeSeconds(count: number) {
  return Math.max(20, count * 4);
}
