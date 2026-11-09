import { describe, expect, it } from "vitest";
import { checkMonths, checkReceipt, contributionSchema, expectedAmount, payableMonths, reviewContributionTransition } from "../app/lib/contributions";

describe("expectedAmount", () => {
  it("multiplies the monthly rate", () => {
    expect(expectedAmount(30, 3)).toBe(90);
  });
});

describe("months", () => {
  const window = payableMonths({ year: 2018, month: 2 });
  it("allows 6 months back and 3 ahead, crossing the year without Pagume", () => {
    expect(window[0]).toEqual({ year: 2017, month: 8 });
    expect(window.at(-1)).toEqual({ year: 2018, month: 5 });
    expect(window).toHaveLength(10);
    expect(window.some((m) => m.month === 13)).toBe(false);
  });
  it("dedupes, sorts, and refuses months outside the window", () => {
    expect(checkMonths([{ year: 2018, month: 2 }, { year: 2017, month: 12 }, { year: 2018, month: 2 }], window)).toEqual([
      { year: 2017, month: 12 },
      { year: 2018, month: 2 },
    ]);
    expect(checkMonths([{ year: 2016, month: 1 }], window)).toBeNull();
  });
});

describe("contributionSchema", () => {
  it("parses month values and amount", () => {
    const r = contributionSchema.parse({ months: ["2018-2", "2017-12"], amount: "60", reason: "" });
    expect(r.months).toEqual([{ year: 2018, month: 2 }, { year: 2017, month: 12 }]);
    expect(r.amount).toBe(60);
    expect(r.reason).toBeNull();
  });
  it("rejects Pagume, empty months and bad amounts", () => {
    expect(contributionSchema.safeParse({ months: ["2017-13"], amount: "30" }).success).toBe(false);
    expect(contributionSchema.safeParse({ months: [], amount: "30" }).success).toBe(false);
    expect(contributionSchema.safeParse({ months: ["2018-1"], amount: "0" }).success).toBe(false);
    expect(contributionSchema.safeParse({ months: ["2018-1"], amount: "abc" }).success).toBe(false);
  });
});

describe("checkReceipt", () => {
  it("accepts small images only", () => {
    expect(checkReceipt(new File([new Uint8Array(10)], "r.webp", { type: "image/webp" })).ok).toBe(true);
    expect(checkReceipt(null)).toEqual({ ok: false, error: "receiptMissing" });
    expect(checkReceipt(new File([new Uint8Array(10)], "r.pdf", { type: "application/pdf" }))).toEqual({ ok: false, error: "receiptType" });
    expect(checkReceipt(new File([new Uint8Array(4 * 1024 * 1024)], "r.png", { type: "image/png" }))).toEqual({ ok: false, error: "receiptSize" });
  });
});

describe("reviewContributionTransition", () => {
  it("reviews pending only", () => {
    expect(reviewContributionTransition("pending", "approve")).toBe("approved");
    expect(reviewContributionTransition("approved", "reject")).toBeNull();
  });
});
