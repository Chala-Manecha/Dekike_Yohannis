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
