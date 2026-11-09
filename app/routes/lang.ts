import { redirect } from "react-router";
import type { Route } from "./+types/lang";
import { langCookie, parseLang } from "../lib/lang";
import { safeRedirect } from "../lib/session.server";

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const lang = parseLang(form.get("lang"));
  return redirect(safeRedirect(form.get("redirectTo")), {
    headers: {
      "Set-Cookie": langCookie(lang),
    },
  });
}

export function loader() {
  return redirect("/");
}
