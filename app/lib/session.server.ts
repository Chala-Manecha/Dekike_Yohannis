import { redirect } from "react-router";
import { createAuth } from "./auth.server";
import { can, isRole, type Permission, type Role } from "./permissions";

export type SessionUser = {
  id: string;
  name: string;
  image: string | null;
  role: Role;
  telegramUsername: string | null;
};

export async function getUser(request: Request, env: Env): Promise<SessionUser | null> {
  const data = await createAuth(env).api.getSession({ headers: request.headers });
  if (!data) return null;
  const u = data.user;
  return {
    id: u.id,
    name: u.name,
    image: u.image ?? null,
    role: isRole(u.role) ? u.role : "member",
    telegramUsername: u.telegramUsername ?? null,
  };
}

export async function requireUser(request: Request, env: Env) {
  const user = await getUser(request, env);
  if (!user) {
    const url = new URL(request.url);
    throw redirect(`/login?next=${encodeURIComponent(url.pathname + url.search)}`);
  }
  return user;
}

export async function requirePermission(request: Request, env: Env, permission: Permission) {
  const user = await requireUser(request, env);
  if (!can(user.role, permission)) {
    throw new Response("You don't have access to this page.", { status: 403 });
  }
  return user;
}

/** Only same-site relative paths; blocks open redirects like //evil.com */
export function safeRedirect(to: FormDataEntryValue | string | null, fallback = "/") {
  if (typeof to !== "string" || !to.startsWith("/") || to.startsWith("//") || to.startsWith("/\\")) {
    return fallback;
  }
  return to;
}
