import { eq } from "drizzle-orm";
import type { Route } from "./+types/materials.$id.file";
import { getDb, schema } from "../db";
import { canOpenMaterial, contentDisposition, materialKey, MATERIAL_TYPES } from "../lib/materials";
import { materialAccess } from "../lib/materials.server";

/** Members-only download. PDFs and images open in the browser; Office files download. */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const { user, reviewer, allowed } = await materialAccess(request, env);
  if (!allowed) throw new Response("Forbidden", { status: 403 });
  const m = await getDb(env.DB).query.materials.findFirst({ where: eq(schema.materials.id, params.id) });
  if (!m || m.status === "rejected" || !canOpenMaterial(m, user.id, reviewer)) throw new Response("Not found", { status: 404 });

  const obj = await env.MEDIA.get(materialKey(m.id));
  if (!obj) throw new Response("Not found", { status: 404 });
  // Only PDF and JPEG/PNG/WebP open inline (never HTML or SVG), and nosniff stops the
  // browser guessing another type. Downloads also get a sandbox CSP for extra safety
  // (not PDFs: Chrome refuses to show a PDF under a sandbox CSP).
  const inline = MATERIAL_TYPES[m.fileType]?.inline ?? false;
  const headers: Record<string, string> = {
    "Content-Type": m.fileType,
    "Content-Length": String(obj.size),
    "Content-Disposition": contentDisposition(m.fileName, inline),
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  };
  if (!inline) headers["Content-Security-Policy"] = "sandbox";
  return new Response(obj.body, { headers });
}
