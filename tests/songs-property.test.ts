import { describe, expect, it } from "vitest";
import { countByCondition, itemSchema } from "../app/lib/property";
import { firstLine, likePattern, songSchema } from "../app/lib/songs";

describe("songSchema", () => {
  it("keeps line breaks and cleans line endings", () => {
    const s = songSchema.parse({ title: " Yohaannis ", lang: "om", lyrics: "\r\nLine one   \r\nLine two\r\n\r\nChorus  " });
    expect(s.title).toBe("Yohaannis");
    expect(s.lyrics).toBe("Line one\nLine two\n\nChorus");
  });
  it("needs a title and real lyrics", () => {
    expect(songSchema.safeParse({ title: "A", lang: "om", lyrics: "long enough lyrics" }).success).toBe(false);
    expect(songSchema.safeParse({ title: "Song", lang: "om", lyrics: "   short  " }).success).toBe(false);
    expect(songSchema.safeParse({ title: "Song", lang: "fr", lyrics: "long enough lyrics" }).success).toBe(false);
  });
  it("shows the first line in lists", () => {
    expect(firstLine("\n  \nሃሌ ሉያ\nሁለተኛ")).toBe("ሃሌ ሉያ");
    expect(firstLine("x".repeat(100), 10)).toBe("xxxxxxxxx…");
  });
  it("escapes search wildcards", () => {
    expect(likePattern("50%_off\\")).toBe("%50\\%\\_off\\\\%");
  });
});

describe("property", () => {
  it("validates items", () => {
    expect(itemSchema.parse({ name: "Candle holder", quantity: "4", condition: "good", location: "", note: "" })).toEqual({
      name: "Candle holder", quantity: 4, condition: "good", location: null, note: null,
    });
    expect(itemSchema.safeParse({ name: "X", quantity: "1", condition: "good" }).success).toBe(false);
    expect(itemSchema.safeParse({ name: "Drum", quantity: "-1", condition: "good" }).success).toBe(false);
    expect(itemSchema.safeParse({ name: "Drum", quantity: "1", condition: "lost" }).success).toBe(false);
  });
  it("counts items, not rows, per condition", () => {
    expect(countByCondition([{ quantity: 4, condition: "good" }, { quantity: 2, condition: "worn" }, { quantity: 1, condition: "good" }])).toEqual({ good: 5, worn: 2, broken: 0 });
  });
});

import { checkAudio, parseRange, AUDIO_MAX_BYTES } from "../app/lib/songs";
import { isOverdue, loanSchema, outByItem } from "../app/lib/property";

describe("song audio", () => {
  it("accepts common phone recordings only", () => {
    expect(checkAudio("audio/mpeg", 1000)).toBeNull();
    expect(checkAudio("audio/mp4", 1000)).toBeNull();
    expect(checkAudio("video/mp4", 1000)).toBe("audioType");
    expect(checkAudio("audio/mpeg", 0)).toBe("fileMissing");
    expect(checkAudio("audio/mpeg", AUDIO_MAX_BYTES + 1)).toBe("audioSize");
  });
  it("reads byte ranges so players can seek", () => {
    expect(parseRange("bytes=0-99", 1000)).toEqual({ offset: 0, length: 100 });
    expect(parseRange("bytes=900-", 1000)).toEqual({ offset: 900, length: 100 });
    expect(parseRange("bytes=-200", 1000)).toEqual({ offset: 800, length: 200 });
    expect(parseRange("bytes=500-5000", 1000)).toEqual({ offset: 500, length: 500 });
    expect(parseRange("bytes=1000-", 1000)).toBe("unsatisfiable");
    expect(parseRange(null, 1000)).toBeNull();
    expect(parseRange("items=0-1", 1000)).toBeNull();
  });
});

describe("lending", () => {
  const loans = [
    { itemId: "a", quantity: 2, dueDate: "2026-11-01", returnedAt: null },
    { itemId: "a", quantity: 1, dueDate: null, returnedAt: null },
    { itemId: "a", quantity: 5, dueDate: "2026-10-01", returnedAt: new Date() },
    { itemId: "b", quantity: 1, dueDate: "2026-12-01", returnedAt: null },
  ];
  it("counts pieces still out, ignoring returned loans", () => {
    expect(Object.fromEntries(outByItem(loans))).toEqual({ a: 3, b: 1 });
  });
  it("is overdue only when not returned and past the due date", () => {
    expect(loans.map((l) => isOverdue(l, "2026-11-09"))).toEqual([true, false, false, false]);
  });
  it("validates a loan", () => {
    expect(loanSchema.parse({ borrower: "Abebe", quantity: "2", phone: "", note: "" })).toEqual({ borrower: "Abebe", phone: null, quantity: 2, note: null });
    expect(loanSchema.safeParse({ borrower: "A", quantity: "1" }).success).toBe(false);
    expect(loanSchema.safeParse({ borrower: "Abebe", quantity: "0" }).success).toBe(false);
  });
});
