import { describe, expect, it } from "vitest";
import { dutyAssignedNotice, planEventRelease, type PlanEvent } from "../app/lib/notify";

const zikr: PlanEvent = { id: "z1", type: "zikr", title: null, date: "2026-12-09", time: "8:00", place: null, dueYear: 2019, dueMonth: 3 };
const duties = [
  { duty: "teach" as const, memberId: "a", name: "Abebe" },
  { duty: "food" as const, memberId: "b", name: "Bontu" },
  { duty: "food" as const, memberId: "c", name: "Chaltu" },
];
const members = [
  { id: "a", telegramId: "1", lang: "om" as const },
  { id: "b", telegramId: "2", lang: "am" as const },
  { id: "x", telegramId: null, lang: "om" as const }, // no Telegram or turned off
];

describe("event duties", () => {
  it("tells the assignee privately, once per event date", () => {
    const [n] = dutyAssignedNotice({ telegramId: "1", lang: "am" }, zikr, { memberId: "a", name: "Abebe", duty: "teach" }, "https://x.dev");
    expect(n.chatId).toBe("1");
    expect(n.text).toContain("ማስተማር");
    expect(n.text).toContain("https://x.dev/me");
    expect(n.dedupeKey).toBe("duty:z1:teach:a:2026-12-09");
    expect(dutyAssignedNotice({ telegramId: null, lang: "am" }, zikr, { memberId: "a", name: "A", duty: "teach" }, "")).toEqual([]);
  });

  it("posts duties and songs to the group and messages each member with their own duty", () => {
    const out = planEventRelease({ event: zikr, duties, songs: ["Song one"], members, groupChatId: "-100", stamp: "2026-12-01T10:00" });
    expect(out.map((o) => o.chatId)).toEqual(["-100", "1", "2"]);
    const group = out[0].text;
    expect(group).toContain("Bontu, Chaltu");
    expect(group).toContain("1. Song one");
    expect(group).toContain("Barsiisuu"); // Oromo part
    expect(group).toContain("ማስተማር"); // Amharic part
    expect(out[1].text).toContain("👉");
    expect(out[2].text).toContain("ምግብ/መጠጥ መግዛት");
  });

  it("skips the group when no group id is set", () => {
    const out = planEventRelease({ event: zikr, duties: [], songs: [], members, groupChatId: null, stamp: "s" });
    expect(out.every((o) => o.chatId !== "-100")).toBe(true);
    expect(out).toHaveLength(2);
  });
});
