import type { Route } from "./+types/photos.$file";
import { parsePhotoFile, photoKey } from "../lib/photos";

/**
 * Public event photos, straight from R2 (no database read). The file name is
 * validated, so only keys under photos/ can be reached; receipts stay private.
 * Files never change (a new upload gets a new id), so browsers cache them for a year.
 */
export async function loader({ params, context }: Route.LoaderArgs) {
  const parsed = parsePhotoFile(params.file);
  if (!parsed) throw new Response("Not found", { status: 404 });
  const obj = await context.cloudflare.env.MEDIA.get(photoKey(parsed.id, parsed.size));
  if (!obj) throw new Response("Not found", { status: 404 });
  return new Response(obj.body, {
    headers: {
      "Content-Type": obj.httpMetadata?.contentType ?? "image/webp",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      ETag: obj.httpEtag,
    },
  });
}
