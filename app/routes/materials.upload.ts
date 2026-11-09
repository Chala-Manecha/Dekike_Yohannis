import type { Route } from "./+types/materials.upload";
import { getDb, schema } from "../db";
import { checkMaterialFile, cleanFileName, materialKey, materialMetaSchema } from "../lib/materials";
import { materialAccess } from "../lib/materials.server";

/**
 * One file per request, sent as the raw request body (not multipart) and streamed
 * straight into R2, so even a 20 MB PDF costs almost no Worker CPU.
 * Details come in the X-Material-Meta header (URI-encoded JSON).
 */
export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.cloudflare;
  const { user, reviewer, allowed } = await materialAccess(request, env);
  if (!allowed) return Response.json({ error: "forbidden" }, { status: 403 });

  let meta: unknown;
  try {
    meta = JSON.parse(decodeURIComponent(request.headers.get("X-Material-Meta") ?? ""));
  } catch {
    return Response.json({ error: "fixFields" }, { status: 400 });
  }
  const parsed = materialMetaSchema.safeParse(meta);
  if (!parsed.success) return Response.json({ error: "fixFields" }, { status: 400 });

  const type = request.headers.get("Content-Type");
  const size = Number(request.headers.get("Content-Length"));
  const fileError = checkMaterialFile(type, size);
  if (fileError || !request.body) return Response.json({ error: fileError ?? "fileMissing" }, { status: 400 });

  const id = crypto.randomUUID();
  const { fileName, ...fields } = parsed.data;
  await env.MEDIA.put(materialKey(id), request.body, { httpMetadata: { contentType: type! } });
  try {
    await getDb(env.DB).insert(schema.materials).values({
      id,
      ...fields,
      fileName: cleanFileName(fileName, type!),
      fileType: type!,
      fileSize: size,
      uploadedBy: user.id,
      // Education's own uploads need no second approval
      ...(reviewer ? { status: "approved" as const, reviewedBy: user.id, reviewedAt: new Date() } : {}),
    });
  } catch (e) {
    await env.MEDIA.delete(materialKey(id));
    throw e;
  }
  return Response.json({ id, approved: reviewer });
}

export function loader() {
  return new Response("Method not allowed", { status: 405 });
}
