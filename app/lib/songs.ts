/** Songs (faarfannaa / መዝሙር): title + lyrics. Pure, tested in tests/songs.test.ts. */
import { z } from "zod";

export const SONG_LANGS = ["om", "am", "gez", "other"] as const;
export type SongLang = (typeof SONG_LANGS)[number];

export const songSchema = z.object({
  title: z.string().trim().min(2, "songTitle").max(120, "songTitle"),
  lang: z.enum(SONG_LANGS, { message: "choose" }),
  // Keep line breaks; normalise Windows line endings and trim trailing spaces per line
  lyrics: z
    .string()
    .transform((s) => s.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trimEnd()).join("\n").trim())
    .pipe(z.string().min(10, "lyrics").max(10_000, "lyrics")),
});

/** First non-empty line, shown under the title in the list. */
export function firstLine(lyrics: string, max = 80) {
  const line = lyrics.split("\n").find((l) => l.trim()) ?? "";
  return line.length > max ? line.slice(0, max - 1) + "…" : line;
}

/** LIKE pattern with %, _ and \ escaped (use with ESCAPE '\'). */
export function likePattern(q: string) {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
