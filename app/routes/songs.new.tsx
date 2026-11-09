import { Link, redirect } from "react-router";
import type { Route } from "./+types/songs.new";
import { PageHead } from "../components/Layout";
import { SongForm } from "../components/SongForm";
import { getDb, schema } from "../db";
import { requirePermission } from "../lib/session.server";
import { songSchema } from "../lib/songs";
import { useT } from "../lib/use-t";

export async function loader({ request, context }: Route.LoaderArgs) {
  await requirePermission(request, context.cloudflare.env, "song:manage");
  return null;
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.cloudflare;
  const user = await requirePermission(request, env, "song:manage");
  const parsed = songSchema.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const i of parsed.error.issues) errors[String(i.path[0])] ??= i.message;
    return { errors };
  }
  const id = crypto.randomUUID();
  await getDb(env.DB).insert(schema.songs).values({ id, ...parsed.data, createdBy: user.id, updatedBy: user.id });
  throw redirect(`/songs/${id}`);
}

export default function NewSong({ actionData }: Route.ComponentProps) {
  const { tr } = useT();
  return (
    <section className="page narrow">
      <PageHead back={{ to: "/songs", label: tr.songs.title }} title={tr.songs.add} />
      <SongForm errors={actionData?.errors} />
    </section>
  );
}
