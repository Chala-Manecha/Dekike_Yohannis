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

/** Song recordings: streamed straight into R2 (raw request body), members-only. */
export const AUDIO_MAX_BYTES = 15 * 1024 * 1024;
export const AUDIO_TYPES: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/ogg": "ogg",
  "audio/webm": "webm",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
};

export function checkAudio(type: string | null, size: number): "fileMissing" | "audioType" | "audioSize" | null {
  if (!Number.isFinite(size) || size <= 0) return "fileMissing";
  if (!type || !(type in AUDIO_TYPES)) return "audioType";
  if (size > AUDIO_MAX_BYTES) return "audioSize";
  return null;
}

/**
 * "bytes=START-END" → offset/length for R2, so phones can seek in a recording.
 * Returns null for no/invalid header (send the whole file) and "unsatisfiable" past the end.
 */
export function parseRange(header: string | null, size: number): { offset: number; length: number } | "unsatisfiable" | null {
  const m = header?.match(/^bytes=(\d*)-(\d*)$/);
  if (!m || (m[1] === "" && m[2] === "")) return null;
  let start: number, end: number;
  if (m[1] === "") {
    const suffix = Number(m[2]);
    if (suffix === 0) return "unsatisfiable";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || end < start) return "unsatisfiable";
  return { offset: start, length: end - start + 1 };
}
