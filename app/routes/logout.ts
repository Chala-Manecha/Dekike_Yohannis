import { redirect } from "react-router";
import type { Route } from "./+types/logout";
import { createAuth } from "../lib/auth.server";

export async function action({ request, context }: Route.ActionArgs) {
  const res = await createAuth(context.cloudflare.env).api.signOut({
    headers: request.headers,
    asResponse: true,
  });
  const headers = new Headers();
  for (const cookie of res.headers.getSetCookie()) headers.append("Set-Cookie", cookie);
  return redirect("/", { headers });
}

export function loader() {
  return redirect("/");
}
