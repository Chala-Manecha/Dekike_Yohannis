import { useRef, useState } from "react";
import { useRevalidator } from "react-router";
import { PHOTO_FULL_SIDE, PHOTO_THUMB_SIDE } from "../lib/photos";

async function toWebp(bitmap: ImageBitmap, maxSide: number, quality: number) {
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  // Some older phones can't encode WebP; fall back to JPEG.
  let blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", quality));
  if (!blob || blob.type !== "image/webp") blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality));
  if (!blob) throw new Error("encode");
  return { blob, width: canvas.width, height: canvas.height };
}

type Labels = { choose: string; hint: string; progress: (done: number, total: number) => string; failed: (n: number) => string };

/**
 * Picks several photos, resizes each in the browser (1600 px + 480 px thumbnail, WebP)
 * and uploads them one at a time, so each request stays small on the free plan.
 */
export function PhotoUploader({ uploadUrl, labels }: { uploadUrl: string; labels: Labels }) {
  const revalidator = useRevalidator();
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<{ done: number; total: number; failed: number } | null>(null);
  const busy = state !== null && state.done + state.failed < state.total;

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.currentTarget.files ?? []);
    if (files.length === 0) return;
    let done = 0;
    let failed = 0;
    setState({ done, total: files.length, failed });
    for (const file of files) {
      try {
        const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
        const full = await toWebp(bitmap, PHOTO_FULL_SIDE, 0.82);
        const thumb = await toWebp(bitmap, PHOTO_THUMB_SIDE, 0.75);
        bitmap.close();
        const fd = new FormData();
        fd.set("photo", new File([full.blob], "photo", { type: full.blob.type }));
        fd.set("thumb", new File([thumb.blob], "thumb", { type: thumb.blob.type }));
        fd.set("width", String(full.width));
        fd.set("height", String(full.height));
        const res = await fetch(uploadUrl, { method: "POST", body: fd });
        // A signed-out user gets redirected to /login (200 HTML), so require the JSON reply.
        const body = (await res.json().catch(() => null)) as { id?: string } | null;
        if (!res.ok || !body?.id) throw new Error(String(res.status));
        done++;
      } catch {
        failed++;
      }
      setState({ done, total: files.length, failed });
    }
    if (input.current) input.current.value = "";
    revalidator.revalidate();
  }

  return (
    <div className="photo-uploader">
      <label className="btn btn-primary">
        {labels.choose}
        <input ref={input} type="file" accept="image/*" multiple hidden disabled={busy} onChange={onChange} />
      </label>
      <p className="muted">{labels.hint}</p>
      {state && (
        <p role="status" className={state.failed ? "form-error" : "muted"}>
          {labels.progress(state.done, state.total)}
          {state.failed > 0 && ` · ${labels.failed(state.failed)}`}
        </p>
      )}
    </div>
  );
}
