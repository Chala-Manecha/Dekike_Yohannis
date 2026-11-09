import type { Route } from "./+types/api.auth";
import { createAuth } from "../lib/auth.server";

export async function loader({ request, context }: Route.LoaderArgs) {
  return createAuth(context.cloudflare.env).handler(request);
}

export async function action({ request, context }: Route.ActionArgs) {
  return createAuth(context.cloudflare.env).handler(request);
}
