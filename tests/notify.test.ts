import { describe, expect, it } from "vitest";
import { addDaysIso, daysBetween, ethToIso, isoToEth } from "../app/lib/dates";
import { defaultZikrIso, isVisibleOnHome, zikrMonthsToEnsure } from "../app/lib/events";
import { planDaily, planReschedule, type PlanEvent, type PlanMember } from "../app/lib/notify";

const zikr: PlanEvent = { id: "z1", type: "zikr", title: null, date: "2026-12-09", time: "8:00", place: null, dueYear: 2019, dueMonth: 3 };
const welcome: PlanEvent = { id: "w1", type: "welcome", title: "Simannaa", date: "2026-12-07", time: null, place: "Hall A", dueYear: null, dueMonth: null };
const member = (id: string, claimed: number[], telegramId: string | null = id): PlanMember => ({
  id,
  name: `Name ${id}`,
  telegramId,
  lang: "om",
  claimed: new Set(claimed),
  monthlyDue: 30,
});
const members = [member("paid", [201903]), member("unpaid", []), member("pending", [201903]), member("noTg", [], null)];
const plan = (today: string, events = [zikr]) => planDaily({ today, events, members, groupChatId: "-100", siteUrl: "https://x.dev" });
const keys = (items: { dedupeKey: string }[]) => items.map((i) => i.dedupeKey).sort();

describe("dates", () => {
  it("handles day maths and Ethiopian conversion", () => {
    expect(addDaysIso("2026-12-30", 3)).toBe("2027-01-02");
    expect(daysBetween("2026-12-06", "2026-12-09")).toBe(3);
    expect(isoToEth("2026-11-09")).toEqual({ year: 2019, month: 2, day: 30 });
    expect(ethToIso({ year: 2019, month: 3, day: 30 })).toBe("2026-12-09");
  });
  it("default zikr is the 30th", () => {
    expect(defaultZikrIso({ year: 2019, month: 3 })).toBe("2026-12-09");
  });
  it("ensures this and the next two months, never Pagume", () => {
    expect(zikrMonthsToEnsure({ year: 2018, month: 12, day: 5 })).toEqual([
      { year: 2018, month: 12 },
      { year: 2019, month: 1 },
      { year: 2019, month: 2 },
    ]);
    expect(zikrMonthsToEnsure({ year: 2018, month: 13, day: 2 })[0]).toEqual({ year: 2019, month: 1 });
  });
  it("homepage shows events from 3 days before", () => {
    expect(isVisibleOnHome("2026-12-09", "2026-12-06")).toBe(true);
    expect(isVisibleOnHome("2026-12-09", "2026-12-05")).toBe(false);
    expect(isVisibleOnHome("2026-12-09", "2026-12-10")).toBe(false);
  });
});

describe("planDaily", () => {
  it("does nothing more than 3 days before", () => {
    expect(plan("2026-12-05")).toEqual([]);
  });
  it("3 days before: announces in the group and reminds unpaid members privately", () => {
    const items = plan("2026-12-06");
    expect(keys(items)).toEqual(["announce:z1:2026-12-09", "remind:z1:unpaid:2026-12-06"]);
    const dm = items.find((i) => i.dedupeKey.startsWith("remind"))!;
    expect(dm.chatId).toBe("unpaid");
    expect(dm.text).toContain("Name unpaid");
    expect(dm.text).toContain("Sadaasa 2019");
    expect(dm.text).toContain("30");
  });
  it("reminds again each day, with a per-day key", () => {
    expect(keys(plan("2026-12-08"))).toContain("remind:z1:unpaid:2026-12-08");
  });
  it("on the day: lists unpaid in the group, no private reminder", () => {
    const items = plan("2026-12-09");
    expect(keys(items)).toEqual(["announce:z1:2026-12-09", "unpaidlist:z1:2026-12-09"]);
    const list = items.find((i) => i.dedupeKey.startsWith("unpaid"))!;
    expect(list.text).toContain("1. Name unpaid");
    expect(list.text).toContain("2. Name noTg");
    expect(list.text).not.toContain("Name paid");
    expect(list.text).not.toContain("Name pending");
  });
  it("other events are announced but never chase payments", () => {
    expect(keys(plan("2026-12-05", [welcome]))).toEqual(["announce:w1:2026-12-07"]);
  });
  it("skips past events and works without a group", () => {
    expect(plan("2026-12-10")).toEqual([]);
    const noGroup = planDaily({ today: "2026-12-06", events: [zikr], members, groupChatId: null, siteUrl: "x" });
    expect(keys(noGroup)).toEqual(["remind:z1:unpaid:2026-12-06"]);
  });
  it("group posts carry both languages", () => {
    const a = plan("2026-12-06").find((i) => i.dedupeKey.startsWith("announce"))!;
    expect(a.text).toContain("Xoofoo ji'aa");
    expect(a.text).toContain("ወርሃዊ ዝክር");
  });
});

describe("planReschedule", () => {
  it("tells the group and each member once per new date", () => {
    const items = planReschedule(zikr, members, "-100");
    expect(items).toHaveLength(4); // group + 3 members with Telegram
    expect(new Set(items.map((i) => i.dedupeKey)).size).toBe(4);
    expect(items.every((i) => i.dedupeKey.includes("2026-12-09"))).toBe(true);
  });
});
