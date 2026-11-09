import { eq } from "drizzle-orm";
import type { Route } from "./+types/property.$id.photo";
import { getDb, schema } from "../db";
import { requirePermission } from "../lib/session.server";

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  await requirePermission(request, env, "property:manage");
  const item = await getDb(env.DB).query.propertyItems.findFirst({ where: eq(schema.propertyItems.id, params.id), columns: { photoKey: true } });
  if (!item?.photoKey) throw new Response("Not found", { status: 404 });
  const obj = await env.MEDIA.get(item.photoKey);
  if (!obj) throw new Response("Not found", { status: 404 });
  return new Response(obj.body, {
    headers: { "Content-Type": obj.httpMetadata?.contentType ?? "image/webp", "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" },
  });
}
