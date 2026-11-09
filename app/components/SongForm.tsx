import { Form, useNavigation } from "react-router";
import { SONG_LANGS } from "../lib/songs";
import { useT } from "../lib/use-t";
import { Field } from "./Field";

export function SongForm({ song, errors }: { song?: { title: string; lang: string; lyrics: string }; errors?: Record<string, string> }) {
  const { tr } = useT();
  const s = tr.songs;
  const busy = useNavigation().state !== "idle";
  const err = (k: string) => (errors?.[k] ? (tr.errors[errors[k] as keyof typeof tr.errors] as string) : undefined);
  return (
    <Form method="post" className="form">
      <Field label={s.titleLabel} name="title" defaultValue={song?.title} required maxLength={120} error={err("title")} />
      <label className="field">
        <span>{s.lang}</span>
        <select name="lang" defaultValue={song?.lang ?? "om"}>
          {SONG_LANGS.map((l) => <option key={l} value={l}>{s.langs[l]}</option>)}
        </select>
      </label>
      <label className="field">
        <span>{s.lyrics} <small>{s.lyricsHint}</small></span>
        <textarea name="lyrics" rows={16} defaultValue={song?.lyrics} required maxLength={10000} aria-invalid={Boolean(err("lyrics"))} />
        {err("lyrics") && <span className="field-error">{err("lyrics")}</span>}
      </label>
      <button className="btn btn-primary" name="intent" value="save" disabled={busy}>{tr.save}</button>
    </Form>
  );
}
