import { eq } from "drizzle-orm";
import type { Route } from "./+types/receipts.$id";
import { getDb, schema } from "../db";
import { can } from "../lib/permissions";
import { requireUser } from "../lib/session.server";

/** Receipts are private: only the member who uploaded it, Finance and admins. */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const db = getDb(env.DB);
  const row = await db
    .select({ key: schema.contributions.receiptKey, ownerUserId: schema.members.userId })
    .from(schema.contributions)
    .innerJoin(schema.members, eq(schema.members.id, schema.contributions.memberId))
    .where(eq(schema.contributions.id, params.id))
    .get();
  if (!row) throw new Response("Not found", { status: 404 });
  if (row.ownerUserId !== user.id && !can(user.role, "receipt:view_any")) throw new Response("Forbidden", { status: 403 });

  const obj = await env.MEDIA.get(row.key);
  if (!obj) throw new Response("Not found", { status: 404 });
  return new Response(obj.body, {
    headers: {
      "Content-Type": obj.httpMetadata?.contentType ?? "application/octet-stream",
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
