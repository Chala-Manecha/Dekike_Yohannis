import { eq } from "drizzle-orm";
import { getDb, schema } from "../db";
import { canViewMaterials } from "./materials";
import { can } from "./permissions";
import { requireUser } from "./session.server";

/** Signed-in user + whether they may use the library and review submissions. */
export async function materialAccess(request: Request, env: Env) {
  const user = await requireUser(request, env);
  const reviewer = can(user.role, "education:manage");
  const member = await getDb(env.DB).query.members.findFirst({ where: eq(schema.members.userId, user.id), columns: { status: true } });
  return { user, reviewer, allowed: canViewMaterials(member?.status, reviewer) };
}
