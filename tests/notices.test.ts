import { describe, expect, it } from "vitest";
import { approvedNotice, newRegistrationNotices, paymentReviewedNotice, paymentSubmittedNotices, roleNotice, welcomeNotice } from "../app/lib/notices";

const om = { userId: "u1", telegramId: "111", lang: "om" as const };
const am = { userId: "u2", telegramId: "222", lang: "am" as const };
const noTg = { userId: "u3", telegramId: null, lang: "om" as const };
const site = "https://example.dev";

describe("notices", () => {
  it("welcomes and approves in the member's language", () => {
    expect(welcomeNotice(am, "m1", "Abebe")[0]).toMatchObject({ chatId: "222", dedupeKey: "welcome:m1" });
    expect(welcomeNotice(am, "m1", "Abebe")[0].text).toContain("Abebe");
    expect(approvedNotice(om, "m1", "Abebe", site)[0].text).toContain(site);
  });
  it("skips people without Telegram", () => {
    expect(welcomeNotice(noTg, "m1", "Abebe")).toEqual([]);
    expect(newRegistrationNotices([om, noTg, am], { id: "m1", name: "Abebe", department: "cs", graduate: false }, site)).toHaveLength(2);
  });
  it("tells coordinators about a new registration, once per coordinator", () => {
    const items = newRegistrationNotices([om, am], { id: "m9", name: "Hana", department: "ee", graduate: true }, site);
    expect(items.map((i) => i.dedupeKey)).toEqual(["newreg:m9:u1", "newreg:m9:u2"]);
    expect(items[0].text).toContain(`${site}/members`);
  });
  it("announces a department role, or its removal", () => {
    expect(roleNotice(om, "finance", site, 1)[0].text).toContain(`${site}/dashboard`);
    expect(roleNotice(om, "member", site, 1)[0].dedupeKey).toBe("role:u1:member:1");
  });
  it("tells Finance about a payment and thanks the member when approved", () => {
    const sub = paymentSubmittedNotices([om], { id: "c1", name: "Abebe", amount: 60, months: [[2019, 2], [2019, 3]] }, site);
    expect(sub[0].text).toContain("60");
    expect(sub[0].text).toContain("Onkoloolessa 2019");
    const ok = paymentReviewedNotice(am, { id: "c1", amount: 60, months: [[2019, 2]], approved: true, note: null }, site);
    expect(ok[0].dedupeKey).toBe("payrev:c1");
    const back = paymentReviewedNotice(om, { id: "c1", amount: 60, months: [[2019, 2]], approved: false, note: "Blurry photo" }, site);
    expect(back[0].text).toContain("Blurry photo");
  });
});
