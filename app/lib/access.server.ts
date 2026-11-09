import { eq } from "drizzle-orm";
import { getDb, schema } from "../db";
import { can, type Permission } from "./permissions";
import { requireUser } from "./session.server";

/** Signed-in user; `allowed` = active member or holds `staff` permission (staff may have no member record). */
export async function memberAccess(request: Request, env: Env, staff: Permission) {
  const user = await requireUser(request, env);
  const isStaff = can(user.role, staff);
  if (isStaff) return { user, staff: true, allowed: true };
  const m = await getDb(env.DB).query.members.findFirst({ where: eq(schema.members.userId, user.id), columns: { status: true } });
  return { user, staff: false, allowed: m?.status === "active" };
}
