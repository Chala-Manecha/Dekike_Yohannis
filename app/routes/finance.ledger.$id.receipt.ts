import { eq } from "drizzle-orm";
import type { Route } from "./+types/finance.ledger.$id.receipt";
import { getDb, schema } from "../db";
import { requirePermission } from "../lib/session.server";

/** Ledger receipts: Finance, leader and admins only. */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  await requirePermission(request, env, "finance:view");
  const row = await getDb(env.DB).query.ledgerEntries.findFirst({ where: eq(schema.ledgerEntries.id, params.id), columns: { receiptKey: true } });
  if (!row?.receiptKey) throw new Response("Not found", { status: 404 });
  const obj = await env.MEDIA.get(row.receiptKey);
  if (!obj) throw new Response("Not found", { status: 404 });
  return new Response(obj.body, {
    headers: {
      "Content-Type": obj.httpMetadata?.contentType ?? "application/octet-stream",
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
