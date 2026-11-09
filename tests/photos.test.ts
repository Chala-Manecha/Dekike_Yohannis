import { describe, expect, it } from "vitest";
import { checkPhotoUpload, marqueeSeconds, parsePhotoFile, photoKey, photoUrl, PHOTO_FULL_MAX_BYTES, PHOTO_THUMB_MAX_BYTES } from "../app/lib/photos";

const ID = "3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b";
const file = (bytes: number, type = "image/webp") => new File([new Uint8Array(bytes)], "x.webp", { type });

describe("photo files", () => {
  it("builds full and thumbnail keys under photos/", () => {
    expect(photoKey(ID, "full")).toBe(`photos/${ID}.webp`);
    expect(photoKey(ID, "thumb")).toBe(`photos/${ID}-t.webp`);
    expect(photoUrl(ID, "thumb")).toBe(`/photos/${ID}-t.webp`);
  });

  it("parses only well-formed photo file names", () => {
    expect(parsePhotoFile(`${ID}.webp`)).toEqual({ id: ID, size: "full" });
    expect(parsePhotoFile(`${ID}-t.webp`)).toEqual({ id: ID, size: "thumb" });
    expect(parsePhotoFile("../receipts/abc.webp")).toBeNull();
    expect(parsePhotoFile(`${ID}.png`)).toBeNull();
    expect(parsePhotoFile(`${ID.toUpperCase()}.webp`)).toBeNull();
    expect(parsePhotoFile(undefined)).toBeNull();
  });
});

describe("checkPhotoUpload", () => {
  const good = { photo: file(1000), thumb: file(200), width: "1600", height: "1067", caption: "  Xoofoo  " };

  it("accepts a resized photo and its thumbnail", () => {
    const r = checkPhotoUpload(good);
    expect(r.ok && r.value.width).toBe(1600);
    expect(r.ok && r.value.caption).toBe("Xoofoo");
  });

  it("needs both files", () => {
    expect(checkPhotoUpload({ ...good, thumb: null })).toEqual({ ok: false, error: "photoMissing" });
    expect(checkPhotoUpload({ ...good, photo: file(0) })).toEqual({ ok: false, error: "photoMissing" });
  });

  it("rejects other types and oversized files", () => {
    expect(checkPhotoUpload({ ...good, photo: file(10, "image/svg+xml") })).toEqual({ ok: false, error: "photoType" });
    expect(checkPhotoUpload({ ...good, photo: file(PHOTO_FULL_MAX_BYTES + 1) })).toEqual({ ok: false, error: "photoSize" });
    expect(checkPhotoUpload({ ...good, thumb: file(PHOTO_THUMB_MAX_BYTES + 1) })).toEqual({ ok: false, error: "photoSize" });
  });

  it("rejects missing or impossible dimensions", () => {
    expect(checkPhotoUpload({ ...good, width: "0" }).ok).toBe(false);
    expect(checkPhotoUpload({ ...good, height: "5000" }).ok).toBe(false);
    expect(checkPhotoUpload({ ...good, width: "abc" }).ok).toBe(false);
  });

  it("treats an empty caption as none", () => {
    const r = checkPhotoUpload({ ...good, caption: "   " });
    expect(r.ok && r.value.caption).toBeNull();
  });
});

describe("marqueeSeconds", () => {
  it("never scrolls too fast", () => {
    expect(marqueeSeconds(1)).toBe(20);
    expect(marqueeSeconds(10)).toBe(40);
  });
});
